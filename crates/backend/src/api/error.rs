use actix_web::HttpResponse;
use actix_web::http::StatusCode;
use serde::Serialize;

#[derive(Serialize)]
struct ErrorBody {
    error: String,
    message: String,
    code: String,
}

pub fn json_error(
    status: StatusCode,
    error: impl Into<String>,
    message: impl Into<String>,
    code: impl Into<String>,
) -> HttpResponse {
    HttpResponse::build(status).json(ErrorBody {
        error: error.into(),
        message: message.into(),
        code: code.into(),
    })
}

pub fn bad_request(message: impl Into<String>, code: impl Into<String>) -> HttpResponse {
    json_error(StatusCode::BAD_REQUEST, "bad_request", message, code)
}

pub fn conflict(message: impl Into<String>, code: impl Into<String>) -> HttpResponse {
    json_error(StatusCode::CONFLICT, "conflict", message, code)
}

pub fn internal_server_error(message: impl Into<String>, code: impl Into<String>) -> HttpResponse {
    json_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal_server_error",
        message,
        code,
    )
}

pub fn not_found(message: impl Into<String>, code: impl Into<String>) -> HttpResponse {
    json_error(StatusCode::NOT_FOUND, "not_found", message, code)
}

pub fn service_unavailable(message: impl Into<String>, code: impl Into<String>) -> HttpResponse {
    json_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "service_unavailable",
        message,
        code,
    )
}

pub fn unauthorized(message: impl Into<String>, code: impl Into<String>) -> HttpResponse {
    json_error(StatusCode::UNAUTHORIZED, "unauthorized", message, code)
}

pub fn forbidden(message: impl Into<String>, code: impl Into<String>) -> HttpResponse {
    json_error(StatusCode::FORBIDDEN, "forbidden", message, code)
}

pub fn range_not_satisfiable(message: impl Into<String>, code: impl Into<String>) -> HttpResponse {
    json_error(
        StatusCode::RANGE_NOT_SATISFIABLE,
        "range_not_satisfiable",
        message,
        code,
    )
}

#[cfg(test)]
mod tests {
    use actix_web::{body::to_bytes, http::StatusCode};
    use serde_json::Value;

    use super::{
        bad_request, conflict, forbidden, internal_server_error, not_found, range_not_satisfiable,
        service_unavailable, unauthorized,
    };

    #[actix_web::test]
    async fn error_helpers_return_stable_status_and_machine_readable_bodies() {
        let cases = [
            (
                bad_request("bad", "bad_code"),
                StatusCode::BAD_REQUEST,
                "bad_request",
                "bad_code",
            ),
            (
                conflict("conflict", "conflict_code"),
                StatusCode::CONFLICT,
                "conflict",
                "conflict_code",
            ),
            (
                not_found("missing", "missing_code"),
                StatusCode::NOT_FOUND,
                "not_found",
                "missing_code",
            ),
            (
                unauthorized("login", "auth_code"),
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "auth_code",
            ),
            (
                forbidden("denied", "denied_code"),
                StatusCode::FORBIDDEN,
                "forbidden",
                "denied_code",
            ),
            (
                service_unavailable("later", "unavailable_code"),
                StatusCode::SERVICE_UNAVAILABLE,
                "service_unavailable",
                "unavailable_code",
            ),
            (
                range_not_satisfiable("range", "range_code"),
                StatusCode::RANGE_NOT_SATISFIABLE,
                "range_not_satisfiable",
                "range_code",
            ),
            (
                internal_server_error("failed", "internal_code"),
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_server_error",
                "internal_code",
            ),
        ];

        for (response, status, error, code) in cases {
            assert_eq!(response.status(), status);
            assert_eq!(
                response.headers().get("content-type").unwrap(),
                "application/json"
            );
            let body: Value =
                serde_json::from_slice(&to_bytes(response.into_body()).await.unwrap()).unwrap();
            assert_eq!(body["error"], error);
            assert_eq!(body["code"], code);
            assert!(
                body["message"]
                    .as_str()
                    .is_some_and(|message| !message.is_empty())
            );
        }
    }
}
