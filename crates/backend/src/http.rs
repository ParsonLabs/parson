use actix_cors::Cors;
use actix_web::body::MessageBody;
use actix_web::dev::{ServiceRequest, ServiceResponse};
use actix_web::http::header::HeaderValue;
use actix_web::http::{Method, header};
use actix_web::middleware::Next;
use actix_web::{Error, HttpMessage};
use std::time::Instant;

const REQUEST_ID_HEADER: &str = "x-request-id";
const CONTENT_SECURITY_POLICY: &str = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; media-src 'self' blob: http: https:; font-src 'self' data:; connect-src 'self' http: https: ws: wss:";

#[derive(Clone, Debug)]
pub struct RequestId(pub String);

fn valid_request_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn is_api_path(path: &str) -> bool {
    path.starts_with("/api/v1/")
        || path.starts_with("/api/music/v1/")
        || path.starts_with("/api/core/v1/")
}

pub async fn request_context<B: MessageBody>(
    req: ServiceRequest,
    next: Next<B>,
) -> Result<ServiceResponse<B>, Error> {
    let context = RequestId(
        req.headers()
            .get(REQUEST_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .filter(|value| valid_request_id(value))
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
    );
    let request_id = context.0.clone();
    let method = req.method().clone();
    let path = req.path().to_string();
    req.extensions_mut().insert(context);
    let started = Instant::now();
    let mut response = next.call(req).await?;
    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response
            .headers_mut()
            .insert(header::HeaderName::from_static(REQUEST_ID_HEADER), value);
    }
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(CONTENT_SECURITY_POLICY),
    );
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
        .headers_mut()
        .insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    response.headers_mut().insert(
        header::HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    if is_api_path(&path) {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store, private"),
        );
        response
            .headers_mut()
            .insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
    }
    let status = response.status();
    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    if status.is_server_error() {
        tracing::error!(%request_id, %method, %path, status = status.as_u16(), elapsed_ms, "request failed");
    } else if status.is_client_error() {
        tracing::warn!(%request_id, %method, %path, status = status.as_u16(), elapsed_ms, "request rejected");
    } else {
        tracing::info!(%request_id, %method, %path, status = status.as_u16(), elapsed_ms, "request completed");
    }
    Ok(response)
}

pub fn cors() -> Cors {
    let allowed_origins = crate::settings::allowed_origins();
    Cors::default()
        .allowed_origin_fn(move |origin, request| {
            origin.to_str().is_ok_and(|origin| {
                allowed_origins
                    .iter()
                    .any(|allowed| allowed.as_str() == origin)
                    || request
                        .headers
                        .get(header::HOST)
                        .and_then(|host| host.to_str().ok())
                        .is_some_and(|host| origin_matches_host(origin, host))
            })
        })
        .allowed_methods(vec![
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allowed_headers(vec![
            header::AUTHORIZATION,
            header::ACCEPT,
            header::CONTENT_TYPE,
            header::HeaderName::from_static(REQUEST_ID_HEADER),
            header::HeaderName::from_static("x-parson-client"),
        ])
        .expose_headers([header::HeaderName::from_static(REQUEST_ID_HEADER)])
        .supports_credentials()
        .max_age(3600)
}

fn origin_matches_host(origin: &str, host: &str) -> bool {
    origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .is_some_and(|authority| authority == host)
}

#[cfg(test)]
mod tests {
    use actix_web::http::header;
    use actix_web::{
        App, HttpMessage, HttpRequest, HttpResponse, middleware, test as actix_test, web,
    };

    use super::{REQUEST_ID_HEADER, RequestId, origin_matches_host, request_context};

    #[test]
    fn same_origin_lan_hosts_are_allowed_without_opening_cross_origin_access() {
        assert!(origin_matches_host(
            "http://192.168.1.25:1993",
            "192.168.1.25:1993"
        ));
        assert!(origin_matches_host("https://parson.dev", "parson.dev"));
        assert!(!origin_matches_host(
            "http://attacker.example",
            "192.168.1.25:1993"
        ));
    }

    async fn request_id(req: HttpRequest) -> HttpResponse {
        let id = req
            .extensions()
            .get::<RequestId>()
            .map(|id| id.0.clone())
            .unwrap_or_default();
        HttpResponse::Ok().body(id)
    }

    #[actix_web::test]
    async fn valid_request_ids_are_preserved_end_to_end() {
        let app = actix_test::init_service(
            App::new()
                .wrap(middleware::from_fn(request_context))
                .route("/", web::get().to(request_id)),
        )
        .await;
        let request = actix_test::TestRequest::get()
            .uri("/")
            .insert_header((REQUEST_ID_HEADER, "client-request_42"))
            .to_request();
        let response = actix_test::call_service(&app, request).await;
        assert_eq!(
            response.headers().get(REQUEST_ID_HEADER).unwrap(),
            "client-request_42"
        );
        assert_eq!(actix_test::read_body(response).await, "client-request_42");
    }

    #[actix_web::test]
    async fn unsafe_request_ids_are_replaced() {
        let app = actix_test::init_service(
            App::new()
                .wrap(middleware::from_fn(request_context))
                .route("/", web::get().to(request_id)),
        )
        .await;
        let request = actix_test::TestRequest::get()
            .uri("/")
            .insert_header((REQUEST_ID_HEADER, "x".repeat(65)))
            .to_request();
        let response = actix_test::call_service(&app, request).await;
        let generated = response
            .headers()
            .get(REQUEST_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .expect("generated request ID")
            .to_string();
        assert!(uuid::Uuid::parse_str(&generated).is_ok());
        assert_eq!(actix_test::read_body(response).await, generated);
    }

    #[actix_web::test]
    async fn api_responses_cannot_be_cached() {
        let app =
            actix_test::init_service(App::new().wrap(middleware::from_fn(request_context)).route(
                "/{path:.*}",
                web::get().to(|| async { HttpResponse::Ok().finish() }),
            ))
            .await;
        for path in [
            "/api/v1/auth/session",
            "/api/music/v1/library/catalog",
            "/api/core/v1/accounts/session",
        ] {
            let response = actix_test::call_service(
                &app,
                actix_test::TestRequest::get().uri(path).to_request(),
            )
            .await;
            assert_eq!(
                response.headers().get(header::CACHE_CONTROL).unwrap(),
                "no-store, private",
                "{path}"
            );
            assert_eq!(response.headers().get(header::PRAGMA).unwrap(), "no-cache");
            assert_eq!(
                response
                    .headers()
                    .get(header::X_CONTENT_TYPE_OPTIONS)
                    .unwrap(),
                "nosniff"
            );
            assert_eq!(
                response.headers().get(header::X_FRAME_OPTIONS).unwrap(),
                "DENY"
            );
            assert!(
                response
                    .headers()
                    .contains_key(header::CONTENT_SECURITY_POLICY)
            );
        }
    }
}
