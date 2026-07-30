use std::collections::HashMap;
use std::convert::TryInto;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock};

use ::image::{ImageReader, imageops::FilterType};
use actix_web::http::header::{CacheControl, CacheDirective, ETAG, IF_NONE_MATCH};
use actix_web::{Error, HttpRequest, HttpResponse, Responder, Result, get, web};
use mime_guess::from_path;
use ravif::{Encoder, Img, RGBA8};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::fs;
use tokio::io::AsyncReadExt;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::task::spawn_blocking;
use webp::Encoder as WebpEncoder;

use crate::api::auth::current_image_session_claims;
use crate::api::library::read_library_paths;
use crate::library::state::LibraryLifecycle;
use crate::library::storage::{get_cover_art_path, get_icon_art_path, get_profile_picture_path};
use crate::persistence::connection::DbPool;

const MAX_CONCURRENT_IMAGE_TRANSFORMS: usize = 4;
const MAX_RAW_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
static IMAGE_TRANSFORM_SLOTS: OnceLock<Arc<Semaphore>> = OnceLock::new();
const SIGNED_IMAGE_MAX_LIFETIME_SECONDS: i64 = 12 * 60 * 60;
const LOCK_SCREEN_IMAGE_LIFETIME_SECONDS: i64 = 6 * 60 * 60;

#[derive(Deserialize)]
pub struct SignedImageRequest {
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedImageResponse {
    expires_at: i64,
    signature: String,
}

fn image_transform_slots() -> Arc<Semaphore> {
    IMAGE_TRANSFORM_SLOTS
        .get_or_init(|| Arc::new(Semaphore::new(MAX_CONCURRENT_IMAGE_TRANSFORMS)))
        .clone()
}

async fn acquire_image_transform_slot(slots: Arc<Semaphore>) -> Option<OwnedSemaphorePermit> {
    slots.acquire_owned().await.ok()
}

#[get("/media/images/{path:.*}")]
pub async fn image(
    req: HttpRequest,
    path: web::Path<String>,
    lifecycle: web::Data<LibraryLifecycle>,
    pool: web::Data<DbPool>,
) -> Result<impl Responder, Error> {
    let requested_path = path.into_inner();
    if !authorized_image_request(&req, &requested_path, pool.get_ref().clone()).await {
        return Ok(HttpResponse::Unauthorized().json(serde_json::json!({
            "error": "image_session_required",
            "message": "A valid session or signed image URL is required."
        })));
    }
    let file_path = match resolve_image_path(&requested_path, &lifecycle).await {
        Ok(path) => path,
        Err(response) => return Ok(response),
    };

    let query = req.query_string();
    let query_params: HashMap<String, String> =
        web::Query::<HashMap<String, String>>::from_query(query)?.into_inner();
    let raw = query_params.get("raw").is_some_and(|v| v == "true");
    let requested_format = query_params
        .get("format")
        .map(|s| s.as_str())
        .unwrap_or("webp");

    // Check metadata ETags before decoding or transforming images.
    let metadata = fs::metadata(&file_path).await.ok();
    let etag = metadata.as_ref().and_then(|metadata| {
        let modified = metadata
            .modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_nanos();
        Some(format!(
            "\"{:x}-{:x}-{}-{}\"",
            metadata.len(),
            modified,
            requested_format,
            u8::from(raw)
        ))
    });

    let if_none_match = req
        .headers()
        .get(IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    if etag
        .as_ref()
        .is_some_and(|etag| Some(etag) == if_none_match.as_ref())
    {
        return Ok(HttpResponse::NotModified().finish());
    }

    if raw {
        if metadata
            .as_ref()
            .is_some_and(|metadata| metadata.len() > MAX_RAW_IMAGE_BYTES)
        {
            return Ok(HttpResponse::PayloadTooLarge().body("Image is too large"));
        }
        match read_file_bounded(&file_path, MAX_RAW_IMAGE_BYTES).await {
            Ok(data) => {
                let mime = from_path(&file_path)
                    .first_or_octet_stream()
                    .essence_str()
                    .to_string();
                let mut response = HttpResponse::Ok();
                if let Some(etag) = etag.as_deref() {
                    response.insert_header((ETAG, etag));
                }
                Ok(response
                    .content_type(mime)
                    .insert_header(CacheControl(vec![
                        CacheDirective::Private,
                        CacheDirective::NoCache,
                    ]))
                    .body(data))
            }
            Err(error) if error.kind() == std::io::ErrorKind::FileTooLarge => {
                Ok(HttpResponse::PayloadTooLarge().body("Image is too large"))
            }
            Err(_) => Ok(HttpResponse::NoContent().body("Image not found")),
        }
    } else {
        serve_transformed_image(file_path, requested_format, etag).await
    }
}

fn signed_image_payload(path: &str, expires: i64) -> String {
    format!("{expires}\n{path}")
}

fn signed_image_bytes(path: &str, expires: i64) -> [u8; 32] {
    const BLOCK_BYTES: usize = 64;
    let secret = crate::settings::session_secret().as_bytes();
    let mut key = [0_u8; BLOCK_BYTES];
    if secret.len() > BLOCK_BYTES {
        key[..32].copy_from_slice(&Sha256::digest(secret));
    } else {
        key[..secret.len()].copy_from_slice(secret);
    }
    let mut inner_pad = [0x36_u8; BLOCK_BYTES];
    let mut outer_pad = [0x5c_u8; BLOCK_BYTES];
    for index in 0..BLOCK_BYTES {
        inner_pad[index] ^= key[index];
        outer_pad[index] ^= key[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(signed_image_payload(path, expires));
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner);
    outer.finalize().into()
}

pub(crate) fn sign_image_path(path: &str, expires: i64) -> String {
    signed_image_bytes(path, expires)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[actix_web::post("/media/images/sign")]
pub async fn create_signed_image_url(request: web::Json<SignedImageRequest>) -> impl Responder {
    let path = request.path.trim();
    if path.is_empty() || path.len() > 4_096 || path.chars().any(char::is_control) {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "status": false,
            "message": "Invalid image path."
        }));
    }
    let expires_at = chrono::Utc::now()
        .timestamp()
        .saturating_add(LOCK_SCREEN_IMAGE_LIFETIME_SECONDS);
    HttpResponse::Ok().json(SignedImageResponse {
        expires_at,
        signature: sign_image_path(path, expires_at),
    })
}

fn signed_image_request_is_valid(req: &HttpRequest, path: &str) -> bool {
    let Ok(query) = web::Query::<HashMap<String, String>>::from_query(req.query_string()) else {
        return false;
    };
    let Some(expires) = query
        .get("expires")
        .and_then(|value| value.parse::<i64>().ok())
    else {
        return false;
    };
    let Some(signature) = query.get("image_signature") else {
        return false;
    };
    let now = chrono::Utc::now().timestamp();
    if expires < now || expires > now.saturating_add(SIGNED_IMAGE_MAX_LIFETIME_SECONDS) {
        return false;
    }
    let Ok(candidate) = hex_signature(signature) else {
        return false;
    };
    candidate
        .iter()
        .zip(signed_image_bytes(path, expires))
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn hex_signature(value: &str) -> Result<[u8; 32], ()> {
    if value.len() != 64 {
        return Err(());
    }
    let mut decoded = [0_u8; 32];
    for (index, byte) in decoded.iter_mut().enumerate() {
        let offset = index * 2;
        let high = hex_value(value.as_bytes()[offset]).ok_or(())?;
        let low = hex_value(value.as_bytes()[offset + 1]).ok_or(())?;
        *byte = (high << 4) | low;
    }
    Ok(decoded)
}

async fn authorized_image_request(req: &HttpRequest, path: &str, pool: DbPool) -> bool {
    if signed_image_request_is_valid(req, path) {
        return true;
    }
    current_image_session_claims(req, pool)
        .await
        .is_ok_and(|claims| claims.is_some())
}

async fn serve_transformed_image(
    file_path: PathBuf,
    requested_format: &str,
    etag: Option<String>,
) -> Result<HttpResponse, Error> {
    // Queue for bounded workers because browsers may not retry image 503s.
    let permit = match acquire_image_transform_slot(image_transform_slots()).await {
        Some(permit) => permit,
        None => return serve_raw_image(&file_path).await,
    };
    let file_path_clone = file_path.clone();
    let fmt = requested_format.to_string();
    let result = spawn_blocking(move || -> Result<(Vec<u8>, String), std::io::Error> {
        let _permit = permit;
        let mut reader = ImageReader::open(&file_path_clone)?;
        let mut limits = ::image::Limits::default();
        limits.max_image_width = Some(16_384);
        limits.max_image_height = Some(16_384);
        limits.max_alloc = Some(256 * 1024 * 1024);
        reader.limits(limits);
        let img = reader.decode().map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Failed to decode image {:?}: {}", file_path_clone, e),
            )
        })?;
        let resized = img.resize(400, 400, FilterType::CatmullRom);

        match fmt.as_str() {
            "avif" => {
                let pixels: Vec<RGBA8> = resized
                    .to_rgba8()
                    .pixels()
                    .map(|p| RGBA8::new(p[0], p[1], p[2], p[3]))
                    .collect();
                let width: usize = resized.width().try_into().map_err(|e| {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!(
                            "Image width could not be converted for AVIF encoding: {}",
                            e
                        ),
                    )
                })?;
                let height: usize = resized.height().try_into().map_err(|e| {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!(
                            "Image height could not be converted for AVIF encoding: {}",
                            e
                        ),
                    )
                })?;
                let img = Img::new(&pixels[..], width, height);
                let avif = Encoder::new()
                    .with_quality(50.0)
                    .with_speed(6)
                    .encode_rgba(img)
                    .map_err(|e| {
                        std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            format!("Failed to encode AVIF image: {}", e),
                        )
                    })?;
                Ok((avif.avif_file, "image/avif".to_string()))
            }
            _ => {
                let encoder = WebpEncoder::from_image(&resized).map_err(|e| {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!("Failed to prepare WebP encoder: {}", e),
                    )
                })?;
                let webp_data = encoder.encode(75.0);
                Ok((webp_data.to_vec(), "image/webp".to_string()))
            }
        }
    })
    .await;

    match result {
        Ok(Ok((bytes, content_type))) => {
            let mut response = HttpResponse::Ok();
            if let Some(etag) = etag.as_deref() {
                response.insert_header((ETAG, etag));
            }
            Ok(response
                .content_type(content_type)
                .insert_header(CacheControl(vec![
                    CacheDirective::Private,
                    CacheDirective::NoCache,
                ]))
                .body(bytes))
        }
        Ok(Err(e)) => {
            tracing::error!("image processing failed: {:?}", e);
            serve_raw_image(&file_path).await
        }
        Err(join_err) => {
            tracing::error!("spawn_blocking join error: {:?}", join_err);
            serve_raw_image(&file_path).await
        }
    }
}

async fn resolve_image_path(
    requested_path: &str,
    lifecycle: &LibraryLifecycle,
) -> Result<PathBuf, HttpResponse> {
    // Actix's Path extractor has already percent-decoded this route segment.
    // Decoding it again would reinterpret legitimate filenames containing
    // strings such as "%2F" or "%2e%2e".
    let candidate = image_candidate(requested_path)
        .map_err(|message| HttpResponse::BadRequest().body(message))?;

    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("data")
            .join(candidate)
    };

    let canonical_file = fs::canonicalize(&candidate)
        .await
        .map_err(|_| HttpResponse::NoContent().body("Image not found"))?;
    let metadata = fs::metadata(&canonical_file)
        .await
        .map_err(|_| HttpResponse::NoContent().body("Image not found"))?;
    if !metadata.is_file() {
        return Err(HttpResponse::NoContent().body("Image not found"));
    }

    for root in allowed_image_roots().await {
        if let Ok(canonical_root) = fs::canonicalize(root).await
            && canonical_file.starts_with(canonical_root)
        {
            return Ok(canonical_file);
        }
    }

    if lifecycle
        .cache()
        .await
        .is_ok_and(|cache| cache.image_paths.contains(&canonical_file))
    {
        return Ok(canonical_file);
    }

    Err(HttpResponse::Forbidden().body("Image path is outside allowed directories"))
}

fn image_candidate(requested_path: &str) -> Result<PathBuf, &'static str> {
    if requested_path.is_empty()
        || requested_path.contains('\0')
        || requested_path.starts_with("http://")
        || requested_path.starts_with("https://")
        || has_parent_component(requested_path)
    {
        return Err("Invalid path");
    }
    Ok(PathBuf::from(requested_path))
}

fn has_parent_component(path: &str) -> bool {
    Path::new(path)
        .components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

async fn allowed_image_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        get_cover_art_path(),
        get_icon_art_path(),
        get_profile_picture_path(),
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("data"),
    ];

    roots.extend(read_library_paths().await.into_iter().map(PathBuf::from));
    roots
}

pub(crate) async fn read_file_bounded(path: &Path, max_bytes: u64) -> std::io::Result<Vec<u8>> {
    let file = fs::File::open(path).await?;
    let capacity = usize::try_from(max_bytes.min(1024 * 1024)).unwrap_or(1024 * 1024);
    let mut data = Vec::with_capacity(capacity);
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut data)
        .await?;
    if data.len() as u64 > max_bytes {
        return Err(std::io::Error::new(
            std::io::ErrorKind::FileTooLarge,
            "image exceeds the configured byte limit",
        ));
    }
    Ok(data)
}

async fn serve_raw_image(file_path: &Path) -> Result<HttpResponse, Error> {
    match read_file_bounded(file_path, MAX_RAW_IMAGE_BYTES).await {
        Ok(data) => Ok(HttpResponse::Ok()
            .content_type(
                from_path(file_path)
                    .first_or_octet_stream()
                    .essence_str()
                    .to_string(),
            )
            .insert_header(CacheControl(vec![
                CacheDirective::Private,
                CacheDirective::NoCache,
            ]))
            .body(data)),
        Err(error) if error.kind() == std::io::ErrorKind::FileTooLarge => {
            Ok(HttpResponse::PayloadTooLarge().body("Image is too large"))
        }
        Err(_) => Ok(HttpResponse::NoContent().body("Image not found")),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use actix_web::{App, http::StatusCode, test as actix_test, web};
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel::sqlite::SqliteConnection;
    use tokio::sync::Semaphore;

    use super::{
        acquire_image_transform_slot, image, image_candidate, read_file_bounded, sign_image_path,
        signed_image_request_is_valid,
    };

    #[actix_web::test]
    async fn image_transform_requests_wait_for_capacity() {
        let slots = Arc::new(Semaphore::new(1));
        let occupied = slots
            .clone()
            .acquire_owned()
            .await
            .expect("initial image transform slot");
        let waiting_slots = slots.clone();
        let waiter = tokio::spawn(async move { acquire_image_transform_slot(waiting_slots).await });

        tokio::task::yield_now().await;
        assert!(
            !waiter.is_finished(),
            "request should wait while capacity is full"
        );

        drop(occupied);
        let permit = waiter
            .await
            .expect("waiting task should complete")
            .expect("waiting request should acquire the released slot");
        assert_eq!(slots.available_permits(), 0);
        drop(permit);
        assert_eq!(slots.available_permits(), 1);
    }

    #[test]
    fn signed_image_urls_are_path_bound_and_expire() {
        let path = "%2Fmusic%2FArtist%2FAlbum%2Fcover.jpg";
        let expires = chrono::Utc::now().timestamp() + 300;
        let signature = sign_image_path(path, expires);
        let request = actix_test::TestRequest::get()
            .uri(&format!(
                "/media/images/{path}?raw=true&expires={expires}&image_signature={signature}"
            ))
            .to_http_request();
        assert!(signed_image_request_is_valid(&request, path));
        assert!(!signed_image_request_is_valid(
            &request,
            "%2Fmusic%2FArtist%2FOther%2Fcover.jpg"
        ));

        let expired = chrono::Utc::now().timestamp() - 1;
        let expired_signature = sign_image_path(path, expired);
        let expired_request = actix_test::TestRequest::get()
            .uri(&format!(
                "/media/images/{path}?expires={expired}&image_signature={expired_signature}"
            ))
            .to_http_request();
        assert!(!signed_image_request_is_valid(&expired_request, path));
    }

    #[test]
    fn route_decoding_is_not_repeated_for_literal_percent_sequences() {
        let candidate = image_candidate("/music/100%2Fpure/cover%2e%2ejpg")
            .expect("literal percent sequences are valid filename text");
        assert_eq!(
            candidate,
            std::path::PathBuf::from("/music/100%2Fpure/cover%2e%2ejpg")
        );
        assert!(image_candidate("/music/../private/cover.jpg").is_err());
    }

    #[actix_web::test]
    async fn image_route_rejects_anonymous_requests_before_path_resolution() {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("image auth test pool");
        let app = actix_test::init_service(
            App::new()
                .app_data(web::Data::new(Arc::new(pool)))
                .app_data(web::Data::new(
                    crate::library::state::LibraryLifecycle::new(),
                ))
                .service(image),
        )
        .await;
        let request = actix_test::TestRequest::get()
            .uri("/media/images/%2Fprivate%2Fcover.jpg")
            .to_request();

        let response = actix_test::call_service(&app, request).await;

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn image_route_accepts_a_path_bound_cast_signature() {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("signed image test pool");
        let app = actix_test::init_service(
            App::new()
                .app_data(web::Data::new(Arc::new(pool)))
                .app_data(web::Data::new(
                    crate::library::state::LibraryLifecycle::new(),
                ))
                .service(image),
        )
        .await;
        let path = "/private/cover.jpg";
        let encoded_path = "%2Fprivate%2Fcover.jpg";
        let expires = chrono::Utc::now().timestamp() + 300;
        let signature = sign_image_path(path, expires);
        let request = actix_test::TestRequest::get()
            .uri(&format!(
                "/media/images/{encoded_path}?expires={expires}&image_signature={signature}"
            ))
            .to_request();

        let response = actix_test::call_service(&app, request).await;

        assert_ne!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn bounded_reads_reject_the_first_byte_over_the_limit() {
        let directory =
            std::env::temp_dir().join(format!("music-image-read-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("image read fixture directory");
        let path = directory.join("image.bin");
        std::fs::write(&path, [1_u8, 2, 3, 4]).expect("image read fixture");

        assert_eq!(
            read_file_bounded(&path, 4).await.expect("bounded read"),
            [1, 2, 3, 4]
        );
        let error = read_file_bounded(&path, 3)
            .await
            .expect_err("oversized read should fail");
        assert_eq!(error.kind(), std::io::ErrorKind::FileTooLarge);

        std::fs::remove_dir_all(directory).expect("image read fixture cleanup");
    }
}
