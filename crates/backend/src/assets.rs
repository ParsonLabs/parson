use std::borrow::Cow;
use std::error::Error;

use actix_web::http::{
    StatusCode,
    header::{CacheControl, CacheDirective},
};
use actix_web::{HttpResponse, web};
use bytes::Bytes;
#[cfg(all(not(debug_assertions), not(test)))]
use rust_embed::RustEmbed;

#[cfg(all(not(debug_assertions), not(test)))]
#[derive(RustEmbed)]
#[folder = "../../apps/web/out"]
struct ReleaseAssets;

struct AssetFile {
    data: Cow<'static, [u8]>,
}

#[cfg(all(not(debug_assertions), not(test)))]
fn get_asset(path: &str) -> Option<AssetFile> {
    ReleaseAssets::get(path).map(|asset| AssetFile { data: asset.data })
}

#[cfg(all(debug_assertions, not(test)))]
fn get_asset(path: &str) -> Option<AssetFile> {
    let export = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/web/out")
        .join(path);
    std::fs::read(export).ok().map(|data| AssetFile {
        data: Cow::Owned(data),
    })
}

#[cfg(test)]
fn get_asset(path: &str) -> Option<AssetFile> {
    const HTML: &[u8] = b"<!DOCTYPE html><html><body>Parson test export</body></html>";
    const NOT_FOUND_HTML: &[u8] =
        b"<!DOCTYPE html><html><body><h1>Page not found</h1><p>Parson</p></body></html>";
    let data: &'static [u8] = match path {
        "404.html" => NOT_FOUND_HTML,
        "index.html"
        | "login.html"
        | "setup.html"
        | "library/__next.!KGFwcCk/library.txt"
        | "library/__next.!KGFwcCk/library/__PAGE__.txt" => HTML,
        "favicon.ico" => b"test-icon",
        _ => return None,
    };
    Some(AssetFile {
        data: Cow::Borrowed(data),
    })
}

fn asset_bytes(data: Cow<'static, [u8]>) -> Bytes {
    match data {
        Cow::Borrowed(data) => Bytes::from_static(data),
        Cow::Owned(data) => Bytes::from(data),
    }
}

fn asset_response_with_status(
    file_path: &str,
    content: AssetFile,
    status: StatusCode,
) -> HttpResponse {
    let mime_type = mime_guess::from_path(file_path).first_or_octet_stream();
    // HTML and RSC payloads are build-specific despite stable filenames.
    let route_document = file_path.ends_with(".html") || file_path.ends_with(".txt");
    let cache_control = if route_document {
        // Route documents reference build-specific chunks.
        CacheControl(vec![CacheDirective::NoStore])
    } else {
        CacheControl(vec![CacheDirective::Public, CacheDirective::MaxAge(86_400)])
    };
    HttpResponse::build(status)
        .content_type(mime_type.as_ref())
        .insert_header(cache_control)
        .body(asset_bytes(content.data))
}

fn asset_response(file_path: &str, content: AssetFile) -> HttpResponse {
    asset_response_with_status(file_path, content, StatusCode::OK)
}

fn not_found_response() -> HttpResponse {
    match get_asset("404.html") {
        Some(content) => asset_response_with_status("404.html", content, StatusCode::NOT_FOUND),
        None => HttpResponse::NotFound()
            .content_type("text/html; charset=utf-8")
            .insert_header(CacheControl(vec![CacheDirective::NoStore]))
            .body("<!DOCTYPE html><html><body><h1>Parson — Page not found</h1></body></html>"),
    }
}

fn stale_bundle_response() -> HttpResponse {
    const RECOVER: &str = r#"(()=>{const k="parson:stale-bundle-reload";if(!sessionStorage.getItem(k)){sessionStorage.setItem(k,"1");location.reload()}else{console.error("Parson could not load the current application bundle")}})();"#;
    HttpResponse::Ok()
        .content_type("application/javascript; charset=utf-8")
        .insert_header(CacheControl(vec![CacheDirective::NoStore]))
        .body(RECOVER)
}

pub async fn serve_embedded_file(path: web::Path<String>) -> Result<HttpResponse, Box<dyn Error>> {
    let file_path = path.into_inner();

    if let Some(content) = get_asset(&file_path) {
        return Ok(asset_response(&file_path, content));
    }

    if file_path.is_empty() {
        return Ok(match get_asset("index.html") {
            Some(content) => asset_response("index.html", content),
            None => not_found_response(),
        });
    }

    // Translate dot-delimited RSC URLs to Next's nested export paths.
    if let Some(export_path) = next_export_rsc_path(&file_path)
        && let Some(content) = get_asset(&export_path)
    {
        return Ok(asset_response(&export_path, content));
    }

    // Reload tabs that still reference the previous embedded build.
    if file_path.starts_with("_next/static/chunks/") && file_path.ends_with(".js") {
        return Ok(stale_bundle_response());
    }

    // Support both `login.html` and `login/index.html` exports.
    let route_path = file_path.trim_end_matches('/');
    if std::path::Path::new(route_path).extension().is_none() {
        let html_path = format!("{route_path}.html");
        if let Some(content) = get_asset(&html_path) {
            return Ok(asset_response(&html_path, content));
        }
    }

    let index_path = format!("{route_path}/index.html");
    match get_asset(&index_path) {
        Some(content) => Ok(asset_response(&index_path, content)),
        None => Ok(not_found_response()),
    }
}

fn next_export_rsc_path(request_path: &str) -> Option<String> {
    let (directory, filename) = request_path
        .rsplit_once('/')
        .map_or(("", request_path), |(directory, filename)| {
            (directory, filename)
        });
    let stem = filename.strip_suffix(".txt")?;
    let parts = stem.split('.').collect::<Vec<_>>();
    if parts.len() < 3 || parts[0] != "__next" || !parts[1].starts_with('!') {
        return None;
    }
    let nested = parts[2..]
        .iter()
        .map(|part| {
            if *part == "**PAGE**" {
                "__PAGE__"
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join("/");
    let prefix = if directory.is_empty() {
        String::new()
    } else {
        format!("{directory}/")
    };
    Some(format!("{prefix}{}.{}/{nested}.txt", parts[0], parts[1]))
}

#[cfg(test)]
mod tests {
    use actix_web::{body::to_bytes, http::StatusCode, web};

    use super::{next_export_rsc_path, serve_embedded_file};

    #[actix_web::test]
    async fn root_and_extensionless_exported_routes_serve_html() {
        for path in ["", "login", "login/", "setup"] {
            let response = serve_embedded_file(web::Path::from(path.to_string()))
                .await
                .expect("embedded route response");
            assert_eq!(response.status(), StatusCode::OK, "route {path}");
            assert!(
                response
                    .headers()
                    .get("content-type")
                    .and_then(|value| value.to_str().ok())
                    .is_some_and(|value| value.starts_with("text/html"))
            );
            assert_eq!(
                response
                    .headers()
                    .get("cache-control")
                    .and_then(|value| value.to_str().ok()),
                Some("no-store")
            );
            let body = to_bytes(response.into_body()).await.unwrap();
            assert!(body.starts_with(b"<!DOCTYPE html>"));
        }
    }

    #[actix_web::test]
    async fn static_assets_are_cacheable_but_missing_routes_serve_the_parson_404() {
        let asset = serve_embedded_file(web::Path::from("favicon.ico".to_string()))
            .await
            .unwrap();
        assert_eq!(asset.status(), StatusCode::OK);
        assert_eq!(
            asset
                .headers()
                .get("cache-control")
                .and_then(|value| value.to_str().ok()),
            Some("public, max-age=86400")
        );

        let missing = serve_embedded_file(web::Path::from("route-that-does-not-exist".to_string()))
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            missing
                .headers()
                .get("content-type")
                .and_then(|value| value.to_str().ok()),
            Some("text/html")
        );
        assert_eq!(
            missing
                .headers()
                .get("cache-control")
                .and_then(|value| value.to_str().ok()),
            Some("no-store")
        );
        let body = to_bytes(missing.into_body()).await.unwrap();
        assert!(body.starts_with(b"<!DOCTYPE html>"));
        assert!(
            body.windows(b"Parson".len())
                .any(|window| window == b"Parson")
        );
        assert!(
            body.windows(b"Page not found".len())
                .any(|window| window == b"Page not found")
        );
    }

    #[actix_web::test]
    async fn route_payloads_revalidate_to_preserve_client_navigation_across_builds() {
        let payload = serve_embedded_file(web::Path::from(
            "library/__next.!KGFwcCk.library.txt".to_string(),
        ))
        .await
        .unwrap();
        assert_eq!(
            payload
                .headers()
                .get("cache-control")
                .and_then(|value| value.to_str().ok()),
            Some("no-store")
        );
    }

    #[actix_web::test]
    async fn stale_chunk_requests_trigger_one_uncached_client_recovery() {
        let response = serve_embedded_file(web::Path::from(
            "_next/static/chunks/removed-build.js".to_string(),
        ))
        .await
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get("cache-control")
                .and_then(|value| value.to_str().ok()),
            Some("no-store")
        );
        assert!(
            response
                .headers()
                .get("content-type")
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value.starts_with("application/javascript"))
        );
        let body = to_bytes(response.into_body()).await.unwrap();
        let script = String::from_utf8(body.to_vec()).unwrap();
        assert!(!script.contains("location.href"));
        assert!(script.contains("sessionStorage.getItem(k)"));
    }

    #[actix_web::test]
    async fn app_router_rsc_urls_map_to_static_export_files() {
        assert_eq!(
            next_export_rsc_path("library/__next.!KGFwcCk.library.**PAGE**.txt"),
            Some("library/__next.!KGFwcCk/library/__PAGE__.txt".to_string())
        );
        for path in [
            "library/__next.!KGFwcCk.library.txt",
            "library/__next.!KGFwcCk.library.**PAGE**.txt",
        ] {
            let response = serve_embedded_file(web::Path::from(path.to_string()))
                .await
                .expect("RSC asset response");
            assert_eq!(response.status(), StatusCode::OK, "route {path}");
        }
    }
}
