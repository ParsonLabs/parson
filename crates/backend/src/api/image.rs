use std::collections::HashMap;
use std::convert::TryInto;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock};

use ::image::{ImageReader, imageops::FilterType};
use actix_web::http::header::{CacheControl, CacheDirective, ETAG, IF_NONE_MATCH};
use actix_web::{Error, HttpRequest, HttpResponse, Responder, Result, get, web};
use mime_guess::from_path;
use ravif::{Encoder, Img, RGBA8};
use tokio::fs;
use tokio::io::AsyncReadExt;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::task::spawn_blocking;
use webp::Encoder as WebpEncoder;

use crate::api::library::read_library_paths;
use crate::library::state::LibraryLifecycle;
use crate::library::storage::{get_cover_art_path, get_icon_art_path, get_profile_picture_path};

const MAX_CONCURRENT_IMAGE_TRANSFORMS: usize = 4;
const MAX_RAW_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
static IMAGE_TRANSFORM_SLOTS: OnceLock<Arc<Semaphore>> = OnceLock::new();

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
) -> Result<impl Responder, Error> {
    let requested_path = path.into_inner();
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
                        CacheDirective::Public,
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
                    CacheDirective::Public,
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
    let decoded_path = percent_decode_path(requested_path)
        .map_err(|message| HttpResponse::BadRequest().body(message))?;

    if decoded_path.is_empty()
        || decoded_path.contains('\0')
        || decoded_path.starts_with("http://")
        || decoded_path.starts_with("https://")
        || has_parent_component(&decoded_path)
    {
        return Err(HttpResponse::BadRequest().body("Invalid path"));
    }

    let candidate = PathBuf::from(&decoded_path);
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

fn has_parent_component(path: &str) -> bool {
    Path::new(path)
        .components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn percent_decode_path(path: &str) -> Result<String, String> {
    let bytes = path.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err("Invalid image path: incomplete percent-encoded sequence.".to_string());
            }

            let high = hex_value(bytes[index + 1]).ok_or_else(|| {
                "Invalid image path: malformed percent-encoded sequence.".to_string()
            })?;
            let low = hex_value(bytes[index + 2]).ok_or_else(|| {
                "Invalid image path: malformed percent-encoded sequence.".to_string()
            })?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }

    String::from_utf8(decoded)
        .map_err(|_| "Invalid image path: percent-decoded path is not UTF-8.".to_string())
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
                CacheDirective::Public,
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

    use tokio::sync::Semaphore;

    use super::{acquire_image_transform_slot, percent_decode_path, read_file_bounded};

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
    fn percent_decode_path_decodes_windows_drive_paths() {
        let decoded = match percent_decode_path("C%3A%2FUsers%2Flistener%2FMusic%2Fcover.jpg") {
            Ok(path) => path,
            Err(e) => panic!("path should decode: {}", e),
        };

        assert_eq!(decoded, "C:/Users/listener/Music/cover.jpg");
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

    #[test]
    fn percent_decode_path_decodes_rooted_library_paths() {
        let decoded = match percent_decode_path("%2FUsers%5Clistener%5CMusic%5Ccover.jpg") {
            Ok(path) => path,
            Err(e) => panic!("path should decode: {}", e),
        };

        assert_eq!(decoded, "/Users\\listener\\Music\\cover.jpg");
    }

    #[test]
    fn percent_decode_path_rejects_malformed_sequences() {
        assert!(percent_decode_path("%2FUsers%ZZcover.jpg").is_err());
    }
}
