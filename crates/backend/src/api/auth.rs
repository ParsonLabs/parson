use std::{
    collections::{HashMap, VecDeque},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
    time::{SystemTime, UNIX_EPOCH},
};

use actix_web::{
    HttpMessage, HttpRequest, HttpResponse, Responder,
    cookie::{self, Cookie, SameSite},
    dev::ServiceRequest,
    get,
    http::{header, header::HeaderValue},
    post, web,
};
use actix_web_httpauth::extractors::bearer::BearerAuth;
use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use chrono::Utc;
use diesel::{ExpressionMethods, OptionalExtension, QueryDsl, RunQueryDsl};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::persistence::{connection::DbPool, models::NewUser};
use crate::settings::session_secret;

const ACCESS_TOKEN_COOKIE: &str = "plm_accessToken";
const REFRESH_TOKEN_COOKIE: &str = "plm_refreshToken";
const ACCESS_TOKEN_DAYS: i64 = 7;
const REFRESH_TOKEN_DAYS: i64 = 30;
const MEDIA_TOKEN_HOURS: i64 = 6;
const LOGIN_ATTEMPTS_PER_MINUTE: usize = 10;
const REGISTRATION_ATTEMPTS_PER_MINUTE: usize = 5;
static AUTH_ATTEMPTS: OnceLock<Mutex<HashMap<String, VecDeque<Instant>>>> = OnceLock::new();
static DUMMY_PASSWORD_HASH: OnceLock<String> = OnceLock::new();

fn auth_attempts() -> &'static Mutex<HashMap<String, VecDeque<Instant>>> {
    AUTH_ATTEMPTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn client_attempt_key(request: &HttpRequest, scope: &str) -> String {
    let client = request
        .peer_addr()
        .map(|address| address.ip().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    format!("{scope}:{client}")
}

fn record_auth_attempt(
    request: &HttpRequest,
    scope: &str,
    maximum: usize,
) -> Result<String, HttpResponse> {
    let key = client_attempt_key(request, scope);
    let now = Instant::now();
    let cutoff = now.checked_sub(Duration::from_secs(60)).unwrap_or(now);
    let mut attempts = auth_attempts()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let entries = attempts.entry(key.clone()).or_default();
    while entries.front().is_some_and(|attempt| *attempt < cutoff) {
        entries.pop_front();
    }
    if entries.len() >= maximum {
        return Err(HttpResponse::TooManyRequests()
            .insert_header(("Retry-After", "60"))
            .json(auth_error(
                "Too many authentication attempts. Retry in one minute.",
            )));
    }
    entries.push_back(now);
    if attempts.len() > 10_000 {
        attempts.retain(|_, entries| entries.back().is_some_and(|attempt| *attempt >= cutoff));
    }
    Ok(key)
}

fn clear_auth_attempts(key: &str) {
    auth_attempts()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(key);
}

fn valid_username(value: &str) -> bool {
    let length = value.chars().count();
    (1..=64).contains(&length) && value.trim() == value
}

pub(crate) fn valid_password(value: &str) -> bool {
    (8..=256).contains(&value.len())
}

fn dummy_password_hash() -> &'static str {
    DUMMY_PASSWORD_HASH.get_or_init(|| {
        hash_password("not-a-real-user-password").unwrap_or_else(|error| {
            tracing::error!(%error, "could not initialize dummy password hash");
            "invalid-dummy-password-hash".to_string()
        })
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
    pub username: String,
    pub bitrate: i32,
    pub token_type: String,
    pub role: String,
    #[serde(default)]
    pub token_version: i32,
}

#[derive(Serialize, Deserialize)]
pub struct AuthData {
    pub username: String,
    pub password: String,
}

#[derive(Serialize, Deserialize)]
pub struct ResponseAuthData {
    pub status: bool,
    pub access_token: String,
    pub refresh_token: String,
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claims: Option<Claims>,
}

#[derive(Serialize)]
pub struct MediaTokenResponse {
    status: bool,
    media_token: String,
    expires_at: i64,
}

fn auth_response(status: bool, message: Option<impl Into<String>>) -> ResponseAuthData {
    ResponseAuthData {
        status,
        access_token: String::new(),
        refresh_token: String::new(),
        message: message.map(Into::into),
        claims: None,
    }
}

fn auth_error(message: impl Into<String>) -> ResponseAuthData {
    auth_response(false, Some(message))
}

fn build_token_cookie(
    name: &'static str,
    token: String,
    http_only: bool,
    max_age_days: i64,
) -> Cookie<'static> {
    Cookie::build(name, token)
        .http_only(http_only)
        .secure(crate::settings::secure_cookies())
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(cookie::time::Duration::days(max_age_days))
        .finish()
}

fn expired_cookie(name: &'static str) -> Cookie<'static> {
    Cookie::build(name, "")
        .path("/")
        .http_only(true)
        .secure(crate::settings::secure_cookies())
        .same_site(SameSite::Lax)
        .max_age(cookie::time::Duration::seconds(0))
        .finish()
}

fn token_from_cookie_header(
    cookie_header: Option<&HeaderValue>,
    cookie_name: &str,
) -> Option<String> {
    cookie_header
        .and_then(|cookie_header| cookie_header.to_str().ok())
        .and_then(|cookie_str| {
            cookie_str
                .split(';')
                .filter_map(|cookie| Cookie::parse_encoded(cookie.trim()).ok())
                .find(|cookie| cookie.name() == cookie_name)
                .map(|cookie| cookie.value().to_string())
        })
}

fn media_token_from_query(query: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next()?;
        let value = parts.next().unwrap_or_default();

        if key == "media_token" && !value.is_empty() {
            Some(value.to_string())
        } else {
            None
        }
    })
}

fn token_from_request(req: &HttpRequest, cookie_name: &str) -> Option<String> {
    token_from_cookie_header(req.headers().get(header::COOKIE), cookie_name).or_else(|| {
        req.cookie(cookie_name)
            .map(|cookie| cookie.value().to_string())
    })
}

pub async fn request_has_current_admin(req: &HttpRequest, pool: DbPool) -> Result<bool, String> {
    let Some(token) = token_from_request(req, ACCESS_TOKEN_COOKIE) else {
        return Ok(false);
    };
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    validation.leeway = 60;
    let claims = match decode::<Claims>(
        &token,
        &DecodingKey::from_secret(session_secret().as_bytes()),
        &validation,
    ) {
        Ok(data) if data.claims.token_type == "access" && data.claims.role == "admin" => {
            data.claims
        }
        _ => return Ok(false),
    };
    token_generation_is_current(pool, &claims).await
}

fn token_from_service_request(
    req: &ServiceRequest,
    credentials: Option<BearerAuth>,
    cookie_name: &str,
) -> Option<String> {
    token_from_cookie_header(req.headers().get(header::COOKIE), cookie_name)
        .or_else(|| credentials.map(|creds| creds.token().to_string()))
}

fn is_song_stream_path(path: &str) -> bool {
    (path.starts_with("/api/v1/media/songs/") || path.starts_with("/api/music/v1/media/songs/"))
        && path.ends_with("/stream")
}

fn media_token_from_service_request(req: &ServiceRequest) -> Option<String> {
    is_song_stream_path(req.path())
        .then(|| media_token_from_query(req.query_string()))
        .flatten()
}

fn generate_access_token(
    user_id: i32,
    username: &str,
    bitrate: i32,
    role: &str,
    token_version: i32,
) -> Result<String, String> {
    let expiration = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::days(ACCESS_TOKEN_DAYS))
        .ok_or_else(|| {
            "Failed to generate access token: expiration timestamp overflowed.".to_string()
        })?
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id.to_string(),
        exp: expiration,
        username: username.to_string(),
        bitrate,
        token_type: "access".to_string(),
        role: role.to_string(),
        token_version,
    };

    let secret = session_secret();
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| format!("Failed to encode access token: {}", e))
}

fn generate_media_token(claims: &Claims) -> Result<(String, i64), String> {
    let expires_at = Utc::now()
        .checked_add_signed(chrono::Duration::hours(MEDIA_TOKEN_HOURS))
        .ok_or_else(|| {
            "Failed to generate media token: expiration timestamp overflowed.".to_string()
        })?
        .timestamp();
    let media_claims = Claims {
        exp: expires_at as usize,
        token_type: "media".to_string(),
        ..claims.clone()
    };
    let token = encode(
        &Header::default(),
        &media_claims,
        &EncodingKey::from_secret(session_secret().as_bytes()),
    )
    .map_err(|error| format!("Failed to encode media token: {error}"))?;
    Ok((token, expires_at))
}

#[post("/media/stream-token")]
pub async fn create_media_stream_token(request: HttpRequest) -> HttpResponse {
    let Some(claims) = request.extensions().get::<Claims>().cloned() else {
        return crate::api::error::unauthorized("Session required.", "session_required");
    };
    match generate_media_token(&claims) {
        Ok((media_token, expires_at)) => HttpResponse::Ok().json(MediaTokenResponse {
            status: true,
            media_token,
            expires_at,
        }),
        Err(error) => {
            tracing::error!(%error, "could not create media token");
            HttpResponse::InternalServerError().json(json!({
                "status": false,
                "error": "media_token_failed"
            }))
        }
    }
}

fn access_token_claims(token: &str) -> Option<Claims> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 60;
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(session_secret().as_bytes()),
        &validation,
    )
    .ok()
    .map(|data| data.claims)
}

fn generate_refresh_token(
    user_id: i32,
    username: &str,
    role: &str,
    token_version: i32,
) -> Result<String, String> {
    let expiration = Utc::now()
        .checked_add_signed(chrono::Duration::days(REFRESH_TOKEN_DAYS))
        .ok_or_else(|| {
            "Failed to generate refresh token: expiration timestamp overflowed.".to_string()
        })?
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id.to_string(),
        exp: expiration,
        username: username.to_string(),
        bitrate: 0,
        token_type: "refresh".to_string(),
        role: role.to_string(),
        token_version,
    };

    let secret = session_secret();
    let header = Header {
        alg: jsonwebtoken::Algorithm::HS256,
        ..Header::default()
    };

    encode(
        &header,
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| format!("Failed to encode refresh token: {}", e))
}

#[get("/session")]
pub async fn is_valid(req: HttpRequest, pool: Option<web::Data<DbPool>>) -> impl Responder {
    let token = match token_from_request(&req, ACCESS_TOKEN_COOKIE) {
        Some(t) => t,
        None => {
            return HttpResponse::Unauthorized().json(json!({
                "status": false,
                "message": "No token found in cookies"
            }));
        }
    };

    let secret = session_secret();
    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 60;
    validation.validate_exp = true;

    match decode::<Claims>(
        &token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    ) {
        Ok(token_data) => {
            let current_time = match SystemTime::now().duration_since(UNIX_EPOCH) {
                Ok(duration) => duration.as_secs() as usize,
                Err(e) => {
                    return HttpResponse::InternalServerError().json(json!({
                        "status": false,
                        "message": format!("System clock is before the Unix epoch: {}", e)
                    }));
                }
            };

            if token_data.claims.exp < current_time {
                return HttpResponse::Unauthorized().json(json!({
                    "status": false,
                    "message": "Token expired",
                    "token_type": token_data.claims.token_type
                }));
            }
            if let Some(pool) = pool {
                match token_generation_is_current(pool.get_ref().clone(), &token_data.claims).await
                {
                    Ok(true) => {}
                    Ok(false) => {
                        return HttpResponse::Unauthorized().json(json!({
                            "status": false,
                            "message": "Session has been revoked"
                        }));
                    }
                    Err(error) => {
                        tracing::error!(%error, "session endpoint generation lookup failed");
                        return HttpResponse::ServiceUnavailable().json(json!({
                            "status": false,
                            "message": "Session validation is temporarily unavailable"
                        }));
                    }
                }
            }

            HttpResponse::Ok().json(json!({
                "status": true,
                "token_type": token_data.claims.token_type,
                "claims": token_data.claims
            }))
        }
        Err(e) => HttpResponse::Unauthorized().json(json!({
            "status": false,
            "message": format!("Invalid token: {}", e)
        })),
    }
}

#[post("/login")]
pub async fn login(
    form: web::Json<AuthData>,
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> impl Responder {
    use crate::persistence::schema::user::dsl::*;
    if !valid_username(&form.username) || !valid_password(&form.password) {
        return HttpResponse::Unauthorized().json(auth_error("Invalid username or password"));
    }
    let login_scope = format!("login:{}", form.username.to_lowercase());
    let attempt_key = match record_auth_attempt(&request, &login_scope, LOGIN_ATTEMPTS_PER_MINUTE) {
        Ok(key) => key,
        Err(response) => return response,
    };

    let login_pool = pool.get_ref().clone();
    let login_username = form.username.clone();
    let login_password = form.password.clone();
    let result = web::block(move || -> Result<Option<(i32, i32, String, i32)>, String> {
        let mut connection = login_pool.get().map_err(|error| error.to_string())?;
        let stored = user
            .filter(username.eq(&login_username))
            .select((password, id, bitrate, role, token_version))
            .first::<(String, i32, i32, String, i32)>(&mut connection)
            .optional()
            .map_err(|error| error.to_string())?;
        let verified = match stored.as_ref() {
            Some((hash, _, _, _, _)) => verify_password(&login_password, hash),
            None => verify_password(&login_password, dummy_password_hash()),
        };
        Ok(
            stored.and_then(|(_, user_id, user_bitrate, user_role, version)| {
                verified.then_some((user_id, user_bitrate, user_role, version))
            }),
        )
    })
    .await;

    match result {
        Ok(Ok(Some((user_id, user_bitrate, user_role, version)))) => {
            clear_auth_attempts(&attempt_key);
            let generated_access_token = match generate_access_token(
                user_id,
                &form.username,
                user_bitrate,
                &user_role,
                version,
            ) {
                Ok(token) => token,
                Err(message) => {
                    return HttpResponse::InternalServerError().json(auth_error(message));
                }
            };
            let generated_refresh_token =
                match generate_refresh_token(user_id, &form.username, &user_role, version) {
                    Ok(token) => token,
                    Err(message) => {
                        return HttpResponse::InternalServerError().json(auth_error(message));
                    }
                };

            let access_cookie = build_token_cookie(
                ACCESS_TOKEN_COOKIE,
                generated_access_token.clone(),
                false,
                ACCESS_TOKEN_DAYS,
            );

            let refresh_cookie = build_token_cookie(
                REFRESH_TOKEN_COOKIE,
                generated_refresh_token,
                true,
                REFRESH_TOKEN_DAYS,
            );

            HttpResponse::Ok()
                .cookie(access_cookie)
                .cookie(refresh_cookie)
                .json(ResponseAuthData {
                    status: true,
                    claims: access_token_claims(&generated_access_token),
                    access_token: generated_access_token,
                    refresh_token: String::new(),
                    message: None,
                })
        }
        Ok(Ok(None)) => {
            HttpResponse::Unauthorized().json(auth_error("Invalid username or password"))
        }
        Ok(Err(error)) => {
            tracing::error!(%error, "login database operation failed");
            HttpResponse::InternalServerError()
                .json(auth_error("Authentication is temporarily unavailable"))
        }
        Err(error) => {
            tracing::error!(%error, "login worker failed");
            HttpResponse::InternalServerError()
                .json(auth_error("Authentication is temporarily unavailable"))
        }
    }
}

#[derive(Deserialize)]
pub struct RegisterData {
    pub username: String,
    pub password: String,
    pub role: String,
    #[serde(default)]
    pub setup_code: Option<String>,
}

fn setup_code_matches(provided: Option<&str>) -> bool {
    let expected = crate::settings::initial_setup_code();
    let Some(provided) = provided.map(str::trim) else {
        return false;
    };
    provided.len() == expected.len()
        && provided
            .bytes()
            .zip(expected.bytes())
            .fold(0_u8, |difference, (left, right)| {
                difference | (left ^ right)
            })
            == 0
}

#[post("/register")]
pub async fn register(
    form: web::Json<RegisterData>,
    req: HttpRequest,
    pool: web::Data<DbPool>,
) -> impl Responder {
    use crate::persistence::schema::user::dsl::*;
    if !valid_username(&form.username) {
        return HttpResponse::BadRequest().json(auth_error(
            "Username must contain 1 to 64 characters without surrounding whitespace",
        ));
    }
    if !valid_password(&form.password) {
        return HttpResponse::BadRequest().json(auth_error("Password must contain 8 to 256 bytes"));
    }
    if !matches!(form.role.as_str(), "user" | "admin") {
        return HttpResponse::BadRequest().json(auth_error("Role must be user or admin"));
    }
    let registration_scope = format!("register:{}", form.username.to_lowercase());
    let attempt_key =
        match record_auth_attempt(&req, &registration_scope, REGISTRATION_ATTEMPTS_PER_MINUTE) {
            Ok(key) => key,
            Err(response) => return response,
        };
    let authorized_role = match request_has_current_admin(&req, pool.get_ref().clone()).await {
        Ok(true) => Some(form.role.clone()),
        Ok(false) => None,
        Err(error) => {
            tracing::error!(%error, "registration authorization lookup failed");
            return HttpResponse::ServiceUnavailable().json(auth_error(
                "Registration authorization is temporarily unavailable",
            ));
        }
    };
    let initial_registration_authorized = crate::http::request_is_local_loopback(&req)
        || setup_code_matches(form.setup_code.as_deref());
    let registration_pool = pool.get_ref().clone();
    let registration_username = form.username.clone();
    let registration_password = form.password.clone();
    let result = web::block(move || -> Result<Result<(), &'static str>, String> {
        let hashed_password = hash_password(&registration_password)
            .map_err(|error| format!("Failed to hash password: {error}"))?;
        let mut connection = registration_pool.get().map_err(|error| error.to_string())?;
        connection
            .immediate_transaction::<_, diesel::result::Error, _>(|connection| {
                let existing_users_count: i64 = user.count().get_result(connection)?;
                let new_user_role = if existing_users_count == 0 {
                    if !initial_registration_authorized {
                        return Ok(Err("setup_code_required"));
                    }
                    "admin".to_string()
                } else if let Some(requested_role) = authorized_role.as_ref() {
                    requested_role.clone()
                } else {
                    return Ok(Err("admin_authorization_required"));
                };
                let new_user = NewUser {
                    username: registration_username.clone(),
                    password: hashed_password.clone(),
                    role: new_user_role,
                };
                diesel::insert_into(user)
                    .values(&new_user)
                    .execute(connection)?;
                Ok(Ok(()))
            })
            .map_err(|error| error.to_string())
    })
    .await;

    match result {
        Ok(Ok(Ok(()))) => {
            clear_auth_attempts(&attempt_key);
            HttpResponse::Ok().json(auth_response(true, Some("User registered successfully")))
        }
        Ok(Ok(Err("setup_code_required"))) => HttpResponse::Unauthorized().json(auth_error(
            "Enter the setup code shown in the Parson server log.",
        )),
        Ok(Ok(Err(_))) => HttpResponse::Unauthorized()
            .json(auth_error("A valid administrator session is required")),
        Ok(Err(error)) => {
            tracing::error!(%error, "registration failed");
            HttpResponse::InternalServerError()
                .json(auth_error("Registration could not be completed"))
        }
        Err(error) => {
            tracing::error!(%error, "registration worker failed");
            HttpResponse::InternalServerError()
                .json(auth_error("Registration could not be completed"))
        }
    }
}

#[post("/refresh")]
pub async fn refresh(req: HttpRequest, pool: Option<web::Data<DbPool>>) -> impl Responder {
    let secret = session_secret();

    let refresh_token = match req.cookie(REFRESH_TOKEN_COOKIE) {
        Some(cookie) => cookie.value().to_string(),
        None => {
            return HttpResponse::Unauthorized().json(auth_error("Refresh token not found"));
        }
    };

    let token_data = decode::<Claims>(
        &refresh_token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    );

    match token_data {
        Ok(data) => {
            if data.claims.token_type == "refresh" {
                let user_id = match data.claims.sub.parse() {
                    Ok(user_id) => user_id,
                    Err(e) => {
                        return HttpResponse::Unauthorized().json(auth_error(format!(
                            "Refresh token subject is not a valid user id: {}",
                            e
                        )));
                    }
                };
                use crate::persistence::schema::user::dsl::{
                    bitrate, id, role, token_version, user, username,
                };
                let Some(pool) = pool else {
                    tracing::error!("database pool missing from refresh handler");
                    return HttpResponse::InternalServerError()
                        .json(auth_error("Session refresh is temporarily unavailable"));
                };
                let refresh_pool = pool.get_ref().clone();
                let current_user = match web::block(
                    move || -> Result<Option<(String, i32, String, i32)>, String> {
                        let mut connection =
                            refresh_pool.get().map_err(|error| error.to_string())?;
                        user.filter(id.eq(user_id))
                            .select((username, bitrate, role, token_version))
                            .first::<(String, i32, String, i32)>(&mut connection)
                            .optional()
                            .map_err(|error| error.to_string())
                    },
                )
                .await
                {
                    Ok(Ok(Some(found_user))) => found_user,
                    Ok(Ok(None)) => {
                        return HttpResponse::Unauthorized()
                            .cookie(expired_cookie(ACCESS_TOKEN_COOKIE))
                            .cookie(expired_cookie(REFRESH_TOKEN_COOKIE))
                            .json(auth_error("Session user no longer exists"));
                    }
                    Ok(Err(error)) => {
                        tracing::error!(%error, "refresh user lookup failed");
                        return HttpResponse::InternalServerError()
                            .json(auth_error("Session refresh is temporarily unavailable"));
                    }
                    Err(error) => {
                        tracing::error!(%error, "refresh user lookup worker failed");
                        return HttpResponse::InternalServerError()
                            .json(auth_error("Session refresh is temporarily unavailable"));
                    }
                };
                let (current_username, current_bitrate, current_role, current_version) =
                    current_user;
                if data.claims.token_version != current_version {
                    return HttpResponse::Unauthorized()
                        .cookie(expired_cookie(ACCESS_TOKEN_COOKIE))
                        .cookie(expired_cookie(REFRESH_TOKEN_COOKIE))
                        .json(auth_error("Session has been revoked"));
                }
                let new_access_token = match generate_access_token(
                    user_id,
                    &current_username,
                    current_bitrate,
                    &current_role,
                    current_version,
                ) {
                    Ok(token) => token,
                    Err(message) => {
                        return HttpResponse::InternalServerError().json(auth_error(message));
                    }
                };

                let access_cookie = build_token_cookie(
                    ACCESS_TOKEN_COOKIE,
                    new_access_token.clone(),
                    false,
                    ACCESS_TOKEN_DAYS,
                );
                let new_refresh_token = match generate_refresh_token(
                    user_id,
                    &current_username,
                    &current_role,
                    current_version,
                ) {
                    Ok(token) => token,
                    Err(message) => {
                        return HttpResponse::InternalServerError().json(auth_error(message));
                    }
                };
                let refresh_cookie = build_token_cookie(
                    REFRESH_TOKEN_COOKIE,
                    new_refresh_token,
                    true,
                    REFRESH_TOKEN_DAYS,
                );

                HttpResponse::Ok()
                    .cookie(access_cookie)
                    .cookie(refresh_cookie)
                    .json(ResponseAuthData {
                        status: true,
                        claims: access_token_claims(&new_access_token),
                        access_token: new_access_token,
                        refresh_token: String::new(),
                        message: None,
                    })
            } else {
                HttpResponse::Unauthorized().json(auth_error("Invalid token type"))
            }
        }
        Err(_) => {
            let expired_cookie = expired_cookie(ACCESS_TOKEN_COOKIE);

            HttpResponse::Unauthorized()
                .cookie(expired_cookie)
                .json(auth_error("Invalid token"))
        }
    }
}

#[post("/logout")]
pub async fn logout(req: HttpRequest, pool: Option<web::Data<DbPool>>) -> impl Responder {
    let token = token_from_request(&req, ACCESS_TOKEN_COOKIE)
        .or_else(|| token_from_request(&req, REFRESH_TOKEN_COOKIE));
    if let Some(token) = token {
        let secret = session_secret();
        if let Ok(data) = decode::<Claims>(
            &token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &Validation::new(Algorithm::HS256),
        ) && let (Ok(user_id), Some(pool)) = (data.claims.sub.parse::<i32>(), pool)
        {
            use crate::persistence::schema::user::dsl::{id, token_version, user};
            let logout_pool = pool.get_ref().clone();
            match web::block(move || -> Result<(), String> {
                let mut connection = logout_pool.get().map_err(|error| error.to_string())?;
                diesel::update(user.filter(id.eq(user_id)))
                    .set(token_version.eq(token_version + 1))
                    .execute(&mut connection)
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            })
            .await
            {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    tracing::error!(%error, "logout revocation failed");
                    return HttpResponse::ServiceUnavailable().json(auth_error(
                        "Logout could not revoke the session. Retry shortly.",
                    ));
                }
                Err(error) => {
                    tracing::error!(%error, "logout revocation worker failed");
                    return HttpResponse::ServiceUnavailable().json(auth_error(
                        "Logout could not revoke the session. Retry shortly.",
                    ));
                }
            }
        }
    }
    let access_cookie = expired_cookie(ACCESS_TOKEN_COOKIE);
    let refresh_cookie = expired_cookie(REFRESH_TOKEN_COOKIE);

    HttpResponse::Ok()
        .cookie(access_cookie)
        .cookie(refresh_cookie)
        .json(json!({
            "status": true,
            "message": "Logged out successfully"
        }))
}

async fn claims_are_current(
    req: &ServiceRequest,
    claims: &Claims,
) -> Result<bool, actix_web::Error> {
    let pool = req
        .app_data::<web::Data<DbPool>>()
        .ok_or_else(|| actix_web::error::ErrorServiceUnavailable("Database unavailable"))?
        .get_ref()
        .clone();
    token_generation_is_current(pool, claims)
        .await
        .map_err(|error| {
            tracing::error!(%error, "session generation lookup failed");
            actix_web::error::ErrorServiceUnavailable("Session validation unavailable")
        })
}

async fn token_generation_is_current(pool: DbPool, claims: &Claims) -> Result<bool, String> {
    use crate::persistence::schema::user::dsl::{id, token_version, user};
    let user_id = claims
        .sub
        .parse::<i32>()
        .map_err(|_| "invalid token subject".to_string())?;
    let expected_version = claims.token_version;
    let current = web::block(move || -> Result<Option<i32>, String> {
        let mut connection = pool.get().map_err(|error| error.to_string())?;
        user.filter(id.eq(user_id))
            .select(token_version)
            .first::<i32>(&mut connection)
            .optional()
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(current.is_some_and(|version| version == expected_version))
}

pub(crate) async fn current_session_claims(
    request: &HttpRequest,
    pool: DbPool,
) -> Result<Option<Claims>, String> {
    let Some(token) = token_from_request(request, ACCESS_TOKEN_COOKIE) else {
        return Ok(None);
    };
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    validation.leeway = 60;
    validation.required_spec_claims.clear();
    let claims = match decode::<Claims>(
        &token,
        &DecodingKey::from_secret(session_secret().as_bytes()),
        &validation,
    ) {
        Ok(data) if data.claims.token_type == "access" => data.claims,
        _ => return Ok(None),
    };
    if token_generation_is_current(pool, &claims).await? {
        Ok(Some(claims))
    } else {
        Ok(None)
    }
}

pub async fn validator(
    req: ServiceRequest,
    credentials: Option<BearerAuth>,
) -> Result<ServiceRequest, (actix_web::Error, ServiceRequest)> {
    let media_token = media_token_from_service_request(&req);
    let expected_token_type = if media_token.is_some() {
        "media"
    } else {
        "access"
    };
    let token =
        media_token.or_else(|| token_from_service_request(&req, credentials, ACCESS_TOKEN_COOKIE));

    let token = match token {
        Some(t) => t,
        None => {
            let actix_err = actix_web::error::ErrorUnauthorized("Access denied: No token");
            return Err((actix_err, req));
        }
    };

    let secret = session_secret();

    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    validation.leeway = 60;
    validation.required_spec_claims.clear();

    match decode::<Claims>(
        &token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    ) {
        Ok(data) if data.claims.token_type == expected_token_type => {
            match claims_are_current(&req, &data.claims).await {
                Ok(true) => {
                    req.extensions_mut().insert(data.claims);
                    Ok(req)
                }
                Ok(false) => Err((actix_web::error::ErrorUnauthorized("Session revoked"), req)),
                Err(error) => Err((error, req)),
            }
        }
        Ok(_) => Err((
            actix_web::error::ErrorUnauthorized("Invalid token type"),
            req,
        )),
        Err(e) => {
            let actix_err = actix_web::error::ErrorUnauthorized(format!("Invalid token: {}", e));
            Err((actix_err, req))
        }
    }
}

pub async fn admin_guard(
    req: ServiceRequest,
    credentials: Option<BearerAuth>,
) -> Result<ServiceRequest, (actix_web::Error, ServiceRequest)> {
    const ADMIN_ROLE: &str = "admin";

    let token = token_from_service_request(&req, credentials, ACCESS_TOKEN_COOKIE);

    let Some(token) = token else {
        let actix_err =
            actix_web::error::ErrorUnauthorized("Access denied: No valid authentication provided");
        return Err((actix_err, req));
    };

    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 60;
    validation.validate_exp = true;

    let secret = session_secret();
    match decode::<Claims>(
        &token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    ) {
        Ok(data) if data.claims.token_type == "access" && data.claims.role == ADMIN_ROLE => {
            match claims_are_current(&req, &data.claims).await {
                Ok(true) => {
                    req.extensions_mut().insert(data.claims);
                    Ok(req)
                }
                Ok(false) => Err((actix_web::error::ErrorUnauthorized("Session revoked"), req)),
                Err(error) => Err((error, req)),
            }
        }
        Ok(data) if data.claims.token_type != "access" => Err((
            actix_web::error::ErrorUnauthorized("Invalid token type"),
            req,
        )),
        Ok(_) => Err((
            actix_web::error::ErrorUnauthorized("Insufficient permissions"),
            req,
        )),
        Err(_) => {
            let actix_err = actix_web::error::ErrorUnauthorized("Invalid token");
            Err((actix_err, req))
        }
    }
}

pub fn authenticated_user_id(request: &HttpRequest) -> Result<i32, HttpResponse> {
    request
        .extensions()
        .get::<Claims>()
        .and_then(|claims| claims.sub.parse().ok())
        .ok_or_else(|| crate::api::error::unauthorized("Session required.", "session_required"))
}

pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let mut salt_bytes = [0u8; 16];
    rand::fill(&mut salt_bytes);
    let salt = SaltString::encode_b64(&salt_bytes)?;
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)?
        .to_string();
    Ok(password_hash)
}

pub fn verify_password(password: &str, password_hash: &str) -> bool {
    let parsed_hash = match PasswordHash::new(password_hash) {
        Ok(hash) => hash,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::{
        ACCESS_TOKEN_COOKIE, Claims, REFRESH_TOKEN_COOKIE, claims_are_current, clear_auth_attempts,
        client_attempt_key, generate_access_token, generate_media_token, hash_password, is_valid,
        media_token_from_service_request, record_auth_attempt, refresh, request_has_current_admin,
        setup_code_matches, token_from_service_request, valid_password, valid_username,
        verify_password,
    };
    use actix_web::{App, HttpResponse, cookie::Cookie, http::StatusCode, test as actix_test, web};
    use actix_web_httpauth::middleware::HttpAuthentication;
    use diesel::connection::SimpleConnection;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel::sqlite::SqliteConnection;
    use serde_json::Value;

    fn session_pool(
        user_id: i32,
        token_version: i32,
    ) -> web::Data<crate::persistence::connection::DbPool> {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("test pool");
        pool.get()
            .expect("test connection")
            .batch_execute(&format!(
                "CREATE TABLE user (id INTEGER PRIMARY KEY, token_version INTEGER NOT NULL);\
                 INSERT INTO user VALUES ({user_id}, {token_version});"
            ))
            .expect("session fixture");
        web::Data::new(std::sync::Arc::new(pool))
    }

    async fn protected_probe() -> HttpResponse {
        HttpResponse::NoContent().finish()
    }

    #[test]
    fn setup_codes_are_exact_and_allow_pasted_whitespace() {
        let expected = crate::settings::initial_setup_code();
        assert_eq!(expected.len(), 12);
        assert!(setup_code_matches(Some(&format!(" {expected}\n"))));
        assert!(!setup_code_matches(None));
        assert!(!setup_code_matches(Some(&expected.to_lowercase())));
    }

    #[actix_web::test]
    async fn is_valid_rejects_requests_without_access_token_cookie() {
        let app = actix_test::init_service(App::new().service(is_valid)).await;
        let req = actix_test::TestRequest::get().uri("/session").to_request();

        let response = actix_test::call_service(&app, req).await;

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn is_valid_accepts_access_token_cookie() {
        let role = "admin".to_string();
        let token = match generate_access_token(42, "alice", 320, &role, 0) {
            Ok(token) => token,
            Err(e) => panic!("test setup failed to generate access token: {}", e),
        };
        let app = actix_test::init_service(App::new().service(is_valid)).await;
        let req = actix_test::TestRequest::get()
            .uri("/session")
            .cookie(Cookie::new(ACCESS_TOKEN_COOKIE, token))
            .to_request();

        let response = actix_test::call_service(&app, req).await;

        assert_eq!(response.status(), StatusCode::OK);

        let body: Value = actix_test::read_body_json(response).await;
        assert_eq!(body["status"], true);
        assert_eq!(body["token_type"], "access");
        assert_eq!(body["claims"]["username"], "alice");
        assert_eq!(body["claims"]["bitrate"], 320);
        assert_eq!(body["claims"]["role"], "admin");
    }

    #[actix_web::test]
    async fn refresh_rejects_requests_without_refresh_token_cookie() {
        let app = actix_test::init_service(App::new().service(refresh)).await;
        let req = actix_test::TestRequest::post().uri("/refresh").to_request();

        let response = actix_test::call_service(&app, req).await;

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn refresh_rejects_access_tokens_in_refresh_cookie() {
        let role = "user".to_string();
        let access_token = match generate_access_token(7, "bob", 256, &role, 0) {
            Ok(token) => token,
            Err(e) => panic!("test setup failed to generate access token: {}", e),
        };
        let app = actix_test::init_service(App::new().service(refresh)).await;
        let req = actix_test::TestRequest::post()
            .uri("/refresh")
            .cookie(Cookie::new(REFRESH_TOKEN_COOKIE, access_token))
            .to_request();

        let response = actix_test::call_service(&app, req).await;

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn hash_password_verifies_original_password() {
        let password_hash = match hash_password("correct horse battery staple") {
            Ok(hash) => hash,
            Err(e) => panic!("test setup failed to hash password: {}", e),
        };

        assert!(verify_password(
            "correct horse battery staple",
            &password_hash
        ));
    }

    #[test]
    fn verify_password_rejects_wrong_or_malformed_hashes() {
        let password_hash = match hash_password("correct horse battery staple") {
            Ok(hash) => hash,
            Err(e) => panic!("test setup failed to hash password: {}", e),
        };

        assert!(!verify_password("wrong password", &password_hash));
        assert!(!verify_password(
            "correct horse battery staple",
            "not-a-valid-hash"
        ));
    }

    #[actix_web::test]
    async fn logout_clears_access_and_refresh_cookies() {
        let app = actix_test::init_service(App::new().service(super::logout)).await;
        let req = actix_test::TestRequest::post().uri("/logout").to_request();

        let response = actix_test::call_service(&app, req).await;

        assert_eq!(response.status(), StatusCode::OK);

        let cookies: Vec<_> = response.response().cookies().collect();
        assert!(
            cookies
                .iter()
                .any(|cookie| cookie.name() == ACCESS_TOKEN_COOKIE)
        );
        assert!(
            cookies
                .iter()
                .any(|cookie| cookie.name() == REFRESH_TOKEN_COOKIE)
        );
    }

    #[test]
    fn authentication_attempts_are_bounded_per_client_and_scope() {
        let request = actix_test::TestRequest::default()
            .peer_addr("192.0.2.44:41000".parse().expect("peer address"))
            .to_http_request();
        let key = client_attempt_key(&request, "test-login");
        clear_auth_attempts(&key);
        assert!(record_auth_attempt(&request, "test-login", 2).is_ok());
        assert!(record_auth_attempt(&request, "test-login", 2).is_ok());
        let response = record_auth_attempt(&request, "test-login", 2)
            .expect_err("third attempt should be limited");
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            response
                .headers()
                .get("Retry-After")
                .and_then(|value| value.to_str().ok()),
            Some("60")
        );
        clear_auth_attempts(&key);
    }

    #[test]
    fn authentication_throttles_do_not_lock_unrelated_accounts_behind_one_proxy() {
        let request = actix_test::TestRequest::default()
            .peer_addr("192.0.2.45:41000".parse().expect("peer address"))
            .to_http_request();
        let alice_key = client_attempt_key(&request, "login:alice");
        let bob_key = client_attempt_key(&request, "login:bob");
        clear_auth_attempts(&alice_key);
        clear_auth_attempts(&bob_key);
        assert!(record_auth_attempt(&request, "login:alice", 1).is_ok());
        assert!(record_auth_attempt(&request, "login:alice", 1).is_err());
        assert!(record_auth_attempt(&request, "login:bob", 1).is_ok());
        clear_auth_attempts(&alice_key);
        clear_auth_attempts(&bob_key);
    }

    #[test]
    fn authentication_inputs_are_bounded_before_hashing() {
        assert!(valid_username("alice"));
        assert!(!valid_username(" alice"));
        assert!(!valid_username(&"a".repeat(65)));
        assert!(valid_password("correct horse battery staple"));
        assert!(!valid_password("short"));
        assert!(!valid_password(&"x".repeat(257)));
    }

    #[actix_web::test]
    async fn stale_token_generations_are_rejected() {
        let database = session_pool(42, 3);
        let request = actix_test::TestRequest::default()
            .app_data(database)
            .to_srv_request();
        let claims = Claims {
            sub: "42".into(),
            exp: usize::MAX,
            username: "alice".into(),
            bitrate: 320,
            token_type: "access".into(),
            role: "admin".into(),
            token_version: 2,
        };

        assert!(
            !claims_are_current(&request, &claims)
                .await
                .expect("generation lookup")
        );
        let current = Claims {
            token_version: 3,
            ..claims
        };
        assert!(
            claims_are_current(&request, &current)
                .await
                .expect("generation lookup")
        );
    }

    #[actix_web::test]
    async fn protected_middleware_rejects_revoked_sessions() {
        let role = "user".to_string();
        let token = generate_access_token(42, "alice", 320, &role, 2).expect("test access token");
        let app = actix_test::init_service(
            App::new().app_data(session_pool(42, 3)).service(
                web::scope("/protected")
                    .wrap(HttpAuthentication::with_fn(super::validator))
                    .route("/probe", web::get().to(protected_probe)),
            ),
        )
        .await;
        let request = actix_test::TestRequest::get()
            .uri("/protected/probe")
            .cookie(Cookie::new(ACCESS_TOKEN_COOKIE, token))
            .to_request();

        let response = actix_test::call_service(&app, request).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn protected_middleware_accepts_current_sessions() {
        let role = "user".to_string();
        let token = generate_access_token(42, "alice", 320, &role, 3).expect("test access token");
        let app = actix_test::init_service(
            App::new().app_data(session_pool(42, 3)).service(
                web::scope("/protected")
                    .wrap(HttpAuthentication::with_fn(super::validator))
                    .route("/probe", web::get().to(protected_probe)),
            ),
        )
        .await;
        let request = actix_test::TestRequest::get()
            .uri("/protected/probe")
            .cookie(Cookie::new(ACCESS_TOKEN_COOKIE, token))
            .to_request();

        let response = actix_test::call_service(&app, request).await;
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    #[actix_web::test]
    async fn protected_middleware_never_grants_an_implicit_local_admin() {
        let app = actix_test::init_service(
            App::new().app_data(session_pool(42, 3)).service(
                web::scope("/protected")
                    .wrap(HttpAuthentication::with_fn(super::validator))
                    .route("/probe", web::get().to(protected_probe)),
            ),
        )
        .await;
        let request = actix_test::TestRequest::get()
            .uri("/protected/probe")
            .to_request();

        let response = actix_test::call_service(&app, request).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn protected_middleware_rejects_malformed_sessions() {
        let app = actix_test::init_service(
            App::new().app_data(session_pool(42, 3)).service(
                web::scope("/protected")
                    .wrap(HttpAuthentication::with_fn(super::validator))
                    .route("/probe", web::get().to(protected_probe)),
            ),
        )
        .await;
        let request = actix_test::TestRequest::get()
            .uri("/protected/probe")
            .cookie(Cookie::new(ACCESS_TOKEN_COOKIE, "not-a-jwt"))
            .to_request();

        let response = actix_test::call_service(&app, request).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn protected_middleware_rejects_expired_sessions() {
        let claims = Claims {
            sub: "42".into(),
            exp: 1,
            username: "alice".into(),
            bitrate: 320,
            token_type: "access".into(),
            role: "user".into(),
            token_version: 3,
        };
        let token = jsonwebtoken::encode(
            &jsonwebtoken::Header::default(),
            &claims,
            &jsonwebtoken::EncodingKey::from_secret(super::session_secret().as_bytes()),
        )
        .expect("expired test token");
        let app = actix_test::init_service(
            App::new().app_data(session_pool(42, 3)).service(
                web::scope("/protected")
                    .wrap(HttpAuthentication::with_fn(super::validator))
                    .route("/probe", web::get().to(protected_probe)),
            ),
        )
        .await;
        let request = actix_test::TestRequest::get()
            .uri("/protected/probe")
            .cookie(Cookie::new(ACCESS_TOKEN_COOKIE, token))
            .to_request();

        let response = actix_test::call_service(&app, request).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn current_admin_check_rejects_revoked_and_non_admin_tokens() {
        let database = session_pool(42, 3);
        let revoked =
            generate_access_token(42, "alice", 320, "admin", 2).expect("revoked admin token");
        let revoked_request = actix_test::TestRequest::default()
            .cookie(Cookie::new(ACCESS_TOKEN_COOKIE, revoked))
            .to_http_request();
        assert!(
            !request_has_current_admin(&revoked_request, database.get_ref().clone())
                .await
                .expect("revoked generation lookup")
        );

        let user = generate_access_token(42, "alice", 320, "user", 3).expect("current user token");
        let user_request = actix_test::TestRequest::default()
            .cookie(Cookie::new(ACCESS_TOKEN_COOKIE, user))
            .to_http_request();
        assert!(
            !request_has_current_admin(&user_request, database.get_ref().clone())
                .await
                .expect("user role lookup")
        );

        let admin =
            generate_access_token(42, "alice", 320, "admin", 3).expect("current admin token");
        let admin_request = actix_test::TestRequest::default()
            .cookie(Cookie::new(ACCESS_TOKEN_COOKIE, admin))
            .to_http_request();
        assert!(
            request_has_current_admin(&admin_request, database.get_ref().clone())
                .await
                .expect("current admin lookup")
        );
    }

    #[test]
    fn access_tokens_are_never_accepted_from_query_strings() {
        let ordinary = actix_test::TestRequest::get()
            .uri("/api/v1/users/me?access_token=secret")
            .to_srv_request();
        assert_eq!(
            token_from_service_request(&ordinary, None, ACCESS_TOKEN_COOKIE),
            None
        );

        let stream = actix_test::TestRequest::get()
            .uri("/api/v1/media/songs/1/stream?access_token=secret")
            .to_srv_request();
        assert_eq!(
            token_from_service_request(&stream, None, ACCESS_TOKEN_COOKIE),
            None
        );
    }

    #[test]
    fn media_tokens_are_scoped_to_song_stream_routes() {
        let claims = Claims {
            sub: "42".into(),
            exp: usize::MAX,
            username: "alice".into(),
            bitrate: 320,
            token_type: "access".into(),
            role: "user".into(),
            token_version: 3,
        };
        let (token, _) = generate_media_token(&claims).expect("media token");
        let ordinary = actix_test::TestRequest::get()
            .uri(&format!("/api/v1/users/me?media_token={token}"))
            .to_srv_request();
        assert_eq!(media_token_from_service_request(&ordinary), None);

        let stream = actix_test::TestRequest::get()
            .uri(&format!("/api/v1/media/songs/1/stream?media_token={token}"))
            .to_srv_request();
        assert_eq!(
            media_token_from_service_request(&stream).as_deref(),
            Some(token.as_str())
        );
    }
}
