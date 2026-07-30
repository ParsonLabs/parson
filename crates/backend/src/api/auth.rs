use std::{
    collections::{HashMap, VecDeque},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
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
use sha2::{Digest, Sha256};
use tokio::sync::Mutex as AsyncMutex;

use crate::persistence::{connection::DbPool, models::NewUser};
use crate::settings::session_secret;

const ACCESS_TOKEN_COOKIE: &str = "plm_accessToken";
const REFRESH_TOKEN_COOKIE: &str = "plm_refreshToken";
const ACCESS_TOKEN_DAYS: i64 = 7;
const REFRESH_TOKEN_DAYS: i64 = 30;
const MEDIA_TOKEN_HOURS: i64 = 6;
const NATIVE_CLIENT_HEADER: &str = "x-parson-client";
const LOGIN_ATTEMPTS_PER_MINUTE: usize = 10;
const REGISTRATION_ATTEMPTS_PER_MINUTE: usize = 5;
const PAIRING_ATTEMPTS_PER_MINUTE: usize = 10;
const PAIRING_LIFETIME: Duration = Duration::from_secs(3 * 60);
const MAX_PENDING_PAIRINGS: usize = 64;
static AUTH_ATTEMPTS: OnceLock<Mutex<HashMap<String, VecDeque<Instant>>>> = OnceLock::new();
static PAIRING_REQUESTS: OnceLock<Mutex<HashMap<String, PairingRequest>>> = OnceLock::new();
static DUMMY_PASSWORD_HASH: OnceLock<String> = OnceLock::new();
static IMAGE_SESSION_GENERATIONS: OnceLock<AsyncMutex<HashMap<i32, CachedTokenGeneration>>> =
    OnceLock::new();
static IMAGE_SESSION_LOOKUPS: OnceLock<AsyncMutex<HashMap<i32, std::sync::Arc<AsyncMutex<()>>>>> =
    OnceLock::new();
const IMAGE_SESSION_GENERATION_TTL: Duration = Duration::from_secs(5);
const MAX_IMAGE_SESSION_CACHE_ENTRIES: usize = 4_096;

#[derive(Clone, Copy)]
struct CachedTokenGeneration {
    version: Option<i32>,
    checked_at: Instant,
}

fn image_session_generations() -> &'static AsyncMutex<HashMap<i32, CachedTokenGeneration>> {
    IMAGE_SESSION_GENERATIONS.get_or_init(|| AsyncMutex::new(HashMap::new()))
}

fn image_session_lookups() -> &'static AsyncMutex<HashMap<i32, std::sync::Arc<AsyncMutex<()>>>> {
    IMAGE_SESSION_LOOKUPS.get_or_init(|| AsyncMutex::new(HashMap::new()))
}

fn auth_attempts() -> &'static Mutex<HashMap<String, VecDeque<Instant>>> {
    AUTH_ATTEMPTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn pairing_requests() -> &'static Mutex<HashMap<String, PairingRequest>> {
    PAIRING_REQUESTS.get_or_init(|| Mutex::new(HashMap::new()))
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

pub(crate) fn valid_username(value: &str) -> bool {
    let length = value.chars().count();
    (1..=64).contains(&length)
        && value.trim() == value
        && value.chars().all(|character| !character.is_control())
}

pub(crate) fn valid_password(value: &str) -> bool {
    (8..=256).contains(&value.chars().count())
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct AuthData {
    pub username: String,
    pub password: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ResponseAuthData {
    pub status: bool,
    pub access_token: String,
    pub refresh_token: String,
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claims: Option<Claims>,
}

#[derive(Clone)]
struct PairingRequest {
    approving: bool,
    code: String,
    device_name: String,
    expires_at: Instant,
    secret_fingerprint: String,
    approved: Option<ResponseAuthData>,
}

#[derive(Deserialize)]
pub struct PairingStartData {
    device_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingStartResponse {
    pairing_id: String,
    secret: String,
    code: String,
    expires_in: u64,
}

#[derive(Deserialize)]
pub struct PairingStatusData {
    pairing_id: String,
    secret: String,
}

#[derive(Deserialize)]
pub struct PairingApprovalData {
    code: String,
}

fn cleanup_pairing_requests(requests: &mut HashMap<String, PairingRequest>, now: Instant) {
    requests.retain(|_, request| request.expires_at > now);
}

fn normalized_pairing_code(value: &str) -> Option<String> {
    let code = value
        .chars()
        .filter(|character| character.is_ascii_digit())
        .collect::<String>();
    (code.len() == 6).then_some(code)
}

fn pairing_code(id: &uuid::Uuid) -> String {
    let bytes = id.as_bytes();
    let value = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) % 1_000_000;
    format!("{value:06}")
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

fn expired_auth_response(message: impl Into<String>) -> HttpResponse {
    HttpResponse::Unauthorized()
        .cookie(expired_cookie(ACCESS_TOKEN_COOKIE))
        .cookie(expired_cookie(REFRESH_TOKEN_COOKIE))
        .json(auth_error(message))
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

fn bearer_token_from_request(req: &HttpRequest) -> Option<String> {
    let value = req.headers().get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    (scheme.eq_ignore_ascii_case("bearer") && !token.trim().is_empty())
        .then(|| token.trim().to_string())
}

fn access_token_from_request(req: &HttpRequest) -> Option<String> {
    bearer_token_from_request(req).or_else(|| token_from_request(req, ACCESS_TOKEN_COOKIE))
}

fn native_token_response_requested(req: &HttpRequest) -> bool {
    // Browsers always attach Origin to credentialed POSTs and cannot suppress
    // it. Requiring its absence keeps refresh credentials out of browser JS
    // while allowing native fetch clients to rotate a SecureStore token.
    !req.headers().contains_key(header::ORIGIN)
        && req
            .headers()
            .get(NATIVE_CLIENT_HEADER)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.eq_ignore_ascii_case("native"))
}

pub async fn request_has_current_admin(req: &HttpRequest, pool: DbPool) -> Result<bool, String> {
    let Some(token) = access_token_from_request(req) else {
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

#[cfg(test)]
fn generate_access_token(
    user_id: i32,
    username: &str,
    bitrate: i32,
    role: &str,
    token_version: i32,
) -> Result<String, String> {
    generate_session_access_token(user_id, username, bitrate, role, token_version, None)
}

fn generate_session_access_token(
    user_id: i32,
    username: &str,
    bitrate: i32,
    role: &str,
    token_version: i32,
    session_id: Option<&str>,
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
        session_id: session_id.map(str::to_string),
    };

    let secret = session_secret();
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| format!("Failed to encode access token: {}", e))
}

pub(crate) fn renewed_access_session_response(
    request: &HttpRequest,
    user_id: i32,
    username: &str,
    bitrate: i32,
    role: &str,
    token_version: i32,
    session_id: Option<&str>,
) -> Result<HttpResponse, String> {
    let access_token =
        generate_session_access_token(user_id, username, bitrate, role, token_version, session_id)?;
    let claims = access_token_claims(&access_token)
        .ok_or_else(|| "Could not decode the renewed access token.".to_string())?;
    let response_access_token = if native_token_response_requested(request) {
        access_token.clone()
    } else {
        String::new()
    };
    Ok(HttpResponse::Ok()
        .cookie(build_token_cookie(
            ACCESS_TOKEN_COOKIE,
            access_token,
            true,
            ACCESS_TOKEN_DAYS,
        ))
        .json(ResponseAuthData {
            status: true,
            access_token: response_access_token,
            refresh_token: String::new(),
            message: None,
            claims: Some(claims),
        }))
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
    session_id: &str,
) -> Result<(String, i64), String> {
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
        session_id: Some(session_id.to_string()),
    };

    let secret = session_secret();
    let header = Header {
        alg: jsonwebtoken::Algorithm::HS256,
        ..Header::default()
    };

    let token = encode(
        &header,
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| format!("Failed to encode refresh token: {}", e))?;
    Ok((token, expiration as i64))
}

fn token_fingerprint(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn insert_refresh_session(
    connection: &mut diesel::sqlite::SqliteConnection,
    session_id: &str,
    user_id: i32,
    token: &str,
    expires_at: i64,
) -> Result<(), diesel::result::Error> {
    diesel::sql_query("DELETE FROM refresh_session WHERE user_id = ? AND expires_at < ?")
        .bind::<diesel::sql_types::Integer, _>(user_id)
        .bind::<diesel::sql_types::BigInt, _>(Utc::now().timestamp())
        .execute(connection)?;
    diesel::sql_query(
        "INSERT INTO refresh_session (id, user_id, token_hash, expires_at)
         VALUES (?, ?, ?, ?)",
    )
    .bind::<diesel::sql_types::Text, _>(session_id)
    .bind::<diesel::sql_types::Integer, _>(user_id)
    .bind::<diesel::sql_types::Text, _>(token_fingerprint(token))
    .bind::<diesel::sql_types::BigInt, _>(expires_at)
    .execute(connection)
    .map(|_| ())
}

struct RefreshRotation<'a> {
    user_id: i32,
    previous_session_id: &'a str,
    previous_token: &'a str,
    next_session_id: &'a str,
    next_token: &'a str,
    next_expires_at: i64,
}

fn rotate_refresh_session(
    connection: &mut diesel::sqlite::SqliteConnection,
    rotation: RefreshRotation<'_>,
) -> Result<bool, diesel::result::Error> {
    connection.immediate_transaction(|connection| {
        let consumed = diesel::sql_query(
            "DELETE FROM refresh_session
             WHERE id = ? AND user_id = ? AND token_hash = ? AND expires_at >= ?",
        )
        .bind::<diesel::sql_types::Text, _>(rotation.previous_session_id)
        .bind::<diesel::sql_types::Integer, _>(rotation.user_id)
        .bind::<diesel::sql_types::Text, _>(token_fingerprint(rotation.previous_token))
        .bind::<diesel::sql_types::BigInt, _>(Utc::now().timestamp())
        .execute(connection)?;
        if consumed != 1 {
            return Ok(false);
        }
        insert_refresh_session(
            connection,
            rotation.next_session_id,
            rotation.user_id,
            rotation.next_token,
            rotation.next_expires_at,
        )?;
        Ok(true)
    })
}

fn revoke_refresh_sessions(
    connection: &mut diesel::sqlite::SqliteConnection,
    user_id: i32,
    session_ids: &[String],
) -> Result<usize, diesel::result::Error> {
    let mut removed = 0;
    for session_id in session_ids {
        removed += diesel::sql_query("DELETE FROM refresh_session WHERE id = ? AND user_id = ?")
            .bind::<diesel::sql_types::Text, _>(session_id)
            .bind::<diesel::sql_types::Integer, _>(user_id)
            .execute(connection)?;
    }
    Ok(removed)
}

#[get("/session")]
pub async fn is_valid(req: HttpRequest, pool: Option<web::Data<DbPool>>) -> impl Responder {
    let token = match access_token_from_request(&req) {
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

#[post("/pairing/start")]
pub async fn start_pairing(
    form: web::Json<PairingStartData>,
    request: HttpRequest,
) -> impl Responder {
    let device_name = form.device_name.trim();
    if device_name.is_empty()
        || device_name.chars().count() > 80
        || device_name.chars().any(char::is_control)
    {
        return HttpResponse::BadRequest().json(json!({
            "status": false,
            "message": "Enter a valid device name."
        }));
    }
    if let Err(response) =
        record_auth_attempt(&request, "pairing:start", PAIRING_ATTEMPTS_PER_MINUTE)
    {
        return response;
    }

    let now = Instant::now();
    let pairing_id = uuid::Uuid::new_v4();
    let secret = uuid::Uuid::new_v4().to_string();
    let mut requests = pairing_requests()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cleanup_pairing_requests(&mut requests, now);
    if requests.len() >= MAX_PENDING_PAIRINGS {
        return HttpResponse::ServiceUnavailable().json(json!({
            "status": false,
            "message": "Too many devices are waiting to pair. Try again shortly."
        }));
    }
    let mut code = pairing_code(&pairing_id);
    while requests.values().any(|request| request.code == code) {
        code = pairing_code(&uuid::Uuid::new_v4());
    }
    requests.insert(
        pairing_id.to_string(),
        PairingRequest {
            approving: false,
            code: code.clone(),
            device_name: device_name.to_string(),
            expires_at: now + PAIRING_LIFETIME,
            secret_fingerprint: token_fingerprint(&secret),
            approved: None,
        },
    );
    HttpResponse::Ok().json(PairingStartResponse {
        pairing_id: pairing_id.to_string(),
        secret,
        code,
        expires_in: PAIRING_LIFETIME.as_secs(),
    })
}

#[post("/pairing/status")]
pub async fn pairing_status(form: web::Json<PairingStatusData>) -> impl Responder {
    let now = Instant::now();
    let mut requests = pairing_requests()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cleanup_pairing_requests(&mut requests, now);
    let Some(request) = requests.get(&form.pairing_id) else {
        return HttpResponse::NotFound().json(json!({
            "status": false,
            "expired": true,
            "message": "This pairing request expired."
        }));
    };
    if request.secret_fingerprint != token_fingerprint(&form.secret) {
        return HttpResponse::NotFound().json(json!({
            "status": false,
            "message": "Pairing request not found."
        }));
    }
    match request.approved.clone() {
        Some(response) => HttpResponse::Ok().json(response),
        None => HttpResponse::Accepted().json(json!({
            "status": false,
            "pending": true,
            "deviceName": request.device_name
        })),
    }
}

async fn issue_paired_session(pool: DbPool, claims: &Claims) -> Result<ResponseAuthData, String> {
    let user_id = claims
        .sub
        .parse::<i32>()
        .map_err(|_| "The current account is invalid.".to_string())?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let access_token = generate_session_access_token(
        user_id,
        &claims.username,
        claims.bitrate,
        &claims.role,
        claims.token_version,
        Some(&session_id),
    )?;
    let (refresh_token, expires_at) = generate_refresh_token(
        user_id,
        &claims.username,
        &claims.role,
        claims.token_version,
        &session_id,
    )?;
    let stored_session_id = session_id;
    let stored_refresh_token = refresh_token.clone();
    web::block(move || -> Result<(), String> {
        let mut connection = pool.get().map_err(|error| error.to_string())?;
        insert_refresh_session(
            &mut connection,
            &stored_session_id,
            user_id,
            &stored_refresh_token,
            expires_at,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(ResponseAuthData {
        status: true,
        claims: access_token_claims(&access_token),
        access_token,
        refresh_token,
        message: None,
    })
}

#[post("/pairing/approve")]
pub async fn approve_pairing(
    form: web::Json<PairingApprovalData>,
    request: HttpRequest,
    pool: web::Data<DbPool>,
) -> impl Responder {
    let Some(claims) = request.extensions().get::<Claims>().cloned() else {
        return HttpResponse::Unauthorized().json(auth_error("Session required"));
    };
    if let Err(response) =
        record_auth_attempt(&request, "pairing:approve", PAIRING_ATTEMPTS_PER_MINUTE)
    {
        return response;
    }
    let Some(code) = normalized_pairing_code(&form.code) else {
        return HttpResponse::BadRequest().json(auth_error("Enter the six-digit pairing code"));
    };

    let pairing_id = {
        let now = Instant::now();
        let mut requests = pairing_requests()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cleanup_pairing_requests(&mut requests, now);
        requests.iter_mut().find_map(|(id, request)| {
            if request.code != code || request.approved.is_some() || request.approving {
                return None;
            }
            request.approving = true;
            Some(id.clone())
        })
    };
    let Some(pairing_id) = pairing_id else {
        return HttpResponse::NotFound().json(auth_error("Pairing code not found or expired"));
    };
    let response = match issue_paired_session(pool.get_ref().clone(), &claims).await {
        Ok(response) => response,
        Err(error) => {
            let mut requests = pairing_requests()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(request) = requests.get_mut(&pairing_id) {
                request.approving = false;
            }
            tracing::error!(%error, "pairing session creation failed");
            return HttpResponse::InternalServerError()
                .json(auth_error("Could not approve this device"));
        }
    };
    let device_name = {
        let mut requests = pairing_requests()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(request) = requests.get_mut(&pairing_id) else {
            return HttpResponse::Gone().json(auth_error("Pairing request expired"));
        };
        request.approving = false;
        request.approved = Some(response);
        request.device_name.clone()
    };
    HttpResponse::Ok().json(json!({
        "status": true,
        "deviceName": device_name,
        "username": claims.username
    }))
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
            let session_id = uuid::Uuid::new_v4().to_string();
            let generated_access_token = match generate_session_access_token(
                user_id,
                &form.username,
                user_bitrate,
                &user_role,
                version,
                Some(&session_id),
            ) {
                Ok(token) => token,
                Err(message) => {
                    return HttpResponse::InternalServerError().json(auth_error(message));
                }
            };
            let (generated_refresh_token, refresh_expires_at) = match generate_refresh_token(
                user_id,
                &form.username,
                &user_role,
                version,
                &session_id,
            ) {
                Ok(token) => token,
                Err(message) => {
                    return HttpResponse::InternalServerError().json(auth_error(message));
                }
            };
            let session_pool = pool.get_ref().clone();
            let stored_session_id = session_id.clone();
            let stored_refresh_token = generated_refresh_token.clone();
            match web::block(move || -> Result<(), String> {
                let mut connection = session_pool.get().map_err(|error| error.to_string())?;
                insert_refresh_session(
                    &mut connection,
                    &stored_session_id,
                    user_id,
                    &stored_refresh_token,
                    refresh_expires_at,
                )
                .map_err(|error| error.to_string())
            })
            .await
            {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    tracing::error!(%error, "login refresh session creation failed");
                    return HttpResponse::InternalServerError()
                        .json(auth_error("Authentication is temporarily unavailable"));
                }
                Err(error) => {
                    tracing::error!(%error, "login refresh session worker failed");
                    return HttpResponse::InternalServerError()
                        .json(auth_error("Authentication is temporarily unavailable"));
                }
            }
            let response_refresh_token = if native_token_response_requested(&request) {
                generated_refresh_token.clone()
            } else {
                String::new()
            };
            let response_access_token = if native_token_response_requested(&request) {
                generated_access_token.clone()
            } else {
                String::new()
            };

            let access_cookie = build_token_cookie(
                ACCESS_TOKEN_COOKIE,
                generated_access_token.clone(),
                true,
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
                    access_token: response_access_token,
                    refresh_token: response_refresh_token,
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
}

fn registration_role(
    existing_users_count: i64,
    authorized_role: Option<&str>,
) -> Result<String, &'static str> {
    if existing_users_count == 0 {
        return Ok("admin".to_string());
    }
    authorized_role
        .map(str::to_string)
        .ok_or("admin_authorization_required")
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
            "Username must contain 1 to 64 printable characters without surrounding whitespace",
        ));
    }
    if !valid_password(&form.password) {
        return HttpResponse::BadRequest()
            .json(auth_error("Password must contain 8 to 256 characters"));
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
                let new_user_role =
                    match registration_role(existing_users_count, authorized_role.as_deref()) {
                        Ok(selected_role) => selected_role,
                        Err(error) => return Ok(Err(error)),
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

    let refresh_token = match bearer_token_from_request(&req).or_else(|| {
        req.cookie(REFRESH_TOKEN_COOKIE)
            .map(|cookie| cookie.value().to_string())
    }) {
        Some(token) => token,
        None => {
            return expired_auth_response("Refresh token not found");
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
                        return expired_auth_response(format!(
                            "Refresh token subject is not a valid user id: {}",
                            e
                        ));
                    }
                };
                let Some(previous_session_id) = data.claims.session_id.as_deref() else {
                    return expired_auth_response("Refresh session is invalid");
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
                        return expired_auth_response("Session user no longer exists");
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
                    return expired_auth_response("Session has been revoked");
                }
                let next_session_id = uuid::Uuid::new_v4().to_string();
                let new_access_token = match generate_session_access_token(
                    user_id,
                    &current_username,
                    current_bitrate,
                    &current_role,
                    current_version,
                    Some(&next_session_id),
                ) {
                    Ok(token) => token,
                    Err(message) => {
                        return HttpResponse::InternalServerError().json(auth_error(message));
                    }
                };

                let access_cookie = build_token_cookie(
                    ACCESS_TOKEN_COOKIE,
                    new_access_token.clone(),
                    true,
                    ACCESS_TOKEN_DAYS,
                );
                let (new_refresh_token, next_expires_at) = match generate_refresh_token(
                    user_id,
                    &current_username,
                    &current_role,
                    current_version,
                    &next_session_id,
                ) {
                    Ok(token) => token,
                    Err(message) => {
                        return HttpResponse::InternalServerError().json(auth_error(message));
                    }
                };
                let rotation_pool = pool.get_ref().clone();
                let previous_session_id = previous_session_id.to_string();
                let previous_refresh_token = refresh_token.clone();
                let stored_next_session_id = next_session_id.clone();
                let stored_next_token = new_refresh_token.clone();
                let rotated = web::block(move || -> Result<bool, String> {
                    let mut connection = rotation_pool.get().map_err(|error| error.to_string())?;
                    rotate_refresh_session(
                        &mut connection,
                        RefreshRotation {
                            user_id,
                            previous_session_id: &previous_session_id,
                            previous_token: &previous_refresh_token,
                            next_session_id: &stored_next_session_id,
                            next_token: &stored_next_token,
                            next_expires_at,
                        },
                    )
                    .map_err(|error| error.to_string())
                })
                .await;
                match rotated {
                    Ok(Ok(true)) => {}
                    Ok(Ok(false)) => {
                        return expired_auth_response(
                            "Refresh session has already been used or revoked",
                        );
                    }
                    Ok(Err(error)) => {
                        tracing::error!(%error, "refresh session rotation failed");
                        return HttpResponse::InternalServerError()
                            .json(auth_error("Session refresh is temporarily unavailable"));
                    }
                    Err(error) => {
                        tracing::error!(%error, "refresh session rotation worker failed");
                        return HttpResponse::InternalServerError()
                            .json(auth_error("Session refresh is temporarily unavailable"));
                    }
                }
                let response_refresh_token = if native_token_response_requested(&req) {
                    new_refresh_token.clone()
                } else {
                    String::new()
                };
                let response_access_token = if native_token_response_requested(&req) {
                    new_access_token.clone()
                } else {
                    String::new()
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
                        access_token: response_access_token,
                        refresh_token: response_refresh_token,
                        message: None,
                    })
            } else {
                expired_auth_response("Invalid token type")
            }
        }
        Err(_) => expired_auth_response("Invalid token"),
    }
}

#[post("/logout")]
pub async fn logout(req: HttpRequest, pool: Option<web::Data<DbPool>>) -> impl Responder {
    let mut tokens = [
        bearer_token_from_request(&req),
        token_from_request(&req, ACCESS_TOKEN_COOKIE),
        token_from_request(&req, REFRESH_TOKEN_COOKIE),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    tokens.sort_unstable();
    tokens.dedup();
    let mut sessions = tokens
        .iter()
        .filter_map(|token| {
            let mut validation = Validation::new(Algorithm::HS256);
            validation.validate_exp = false;
            decode::<Claims>(
                token,
                &DecodingKey::from_secret(session_secret().as_bytes()),
                &validation,
            )
            .ok()
            .and_then(|data| {
                let user_id = data.claims.sub.parse::<i32>().ok()?;
                let session_id = data.claims.session_id?;
                matches!(data.claims.token_type.as_str(), "access" | "refresh")
                    .then_some((user_id, session_id))
            })
        })
        .collect::<Vec<_>>();
    sessions.sort_unstable();
    sessions.dedup();
    if !sessions.is_empty() {
        let Some(pool) = pool else {
            return HttpResponse::ServiceUnavailable().json(auth_error(
                "Logout could not revoke the session. Retry shortly.",
            ));
        };
        let logout_pool = pool.get_ref().clone();
        match web::block(move || -> Result<(), String> {
            let mut connection = logout_pool.get().map_err(|error| error.to_string())?;
            connection
                .immediate_transaction(|connection| {
                    for (user_id, session_id) in sessions {
                        revoke_refresh_sessions(connection, user_id, &[session_id])?;
                    }
                    Ok::<_, diesel::result::Error>(())
                })
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

async fn lookup_token_generation(
    pool: DbPool,
    user_id: i32,
    session_id: Option<String>,
) -> Result<Option<i32>, String> {
    use crate::persistence::schema::user::dsl::{id, token_version, user};
    web::block(move || -> Result<Option<i32>, String> {
        let mut connection = pool.get().map_err(|error| error.to_string())?;
        let version = user
            .filter(id.eq(user_id))
            .select(token_version)
            .first::<i32>(&mut connection)
            .optional()
            .map_err(|error| error.to_string())?;
        let Some(session_id) = session_id else {
            return Ok(version);
        };
        let active = diesel::sql_query(
            "SELECT CAST(COUNT(*) AS BIGINT) AS count
             FROM refresh_session WHERE id = ? AND user_id = ? AND expires_at >= ?",
        )
        .bind::<diesel::sql_types::Text, _>(session_id)
        .bind::<diesel::sql_types::Integer, _>(user_id)
        .bind::<diesel::sql_types::BigInt, _>(Utc::now().timestamp())
        .get_result::<SessionCount>(&mut connection)
        .map_err(|error| error.to_string())?
        .count
            == 1;
        Ok(active.then_some(version).flatten())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(diesel::QueryableByName)]
struct SessionCount {
    #[diesel(sql_type = diesel::sql_types::BigInt)]
    count: i64,
}

async fn token_generation_is_current(pool: DbPool, claims: &Claims) -> Result<bool, String> {
    let user_id = claims
        .sub
        .parse::<i32>()
        .map_err(|_| "invalid token subject".to_string())?;
    let expected_version = claims.token_version;
    let current = lookup_token_generation(pool, user_id, claims.session_id.clone()).await?;
    Ok(current.is_some_and(|version| version == expected_version))
}

fn decoded_access_claims(request: &HttpRequest) -> Option<Claims> {
    let token = access_token_from_request(request)?;
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
        _ => return None,
    };
    Some(claims)
}

pub(crate) async fn current_session_claims(
    request: &HttpRequest,
    pool: DbPool,
) -> Result<Option<Claims>, String> {
    let Some(claims) = decoded_access_claims(request) else {
        return Ok(None);
    };
    if token_generation_is_current(pool, &claims).await? {
        Ok(Some(claims))
    } else {
        Ok(None)
    }
}

/// Validates image bursts without consuming one database connection per
/// artwork request. The cache lock collapses concurrent misses, while the
/// short TTL bounds revocation delay if another process changes the user.
pub(crate) async fn current_image_session_claims(
    request: &HttpRequest,
    pool: DbPool,
) -> Result<Option<Claims>, String> {
    let Some(claims) = decoded_access_claims(request) else {
        return Ok(None);
    };
    let user_id = claims
        .sub
        .parse::<i32>()
        .map_err(|_| "invalid token subject".to_string())?;
    let now = Instant::now();
    if let Some(current) = image_session_generations()
        .lock()
        .await
        .get(&user_id)
        .copied()
        .filter(|cached| {
            now.saturating_duration_since(cached.checked_at) <= IMAGE_SESSION_GENERATION_TTL
        })
        .map(|cached| cached.version)
    {
        return Ok(current
            .is_some_and(|version| version == claims.token_version)
            .then_some(claims));
    }
    let lookup = {
        let mut lookups = image_session_lookups().lock().await;
        if lookups.len() >= MAX_IMAGE_SESSION_CACHE_ENTRIES {
            lookups.retain(|_, lock| std::sync::Arc::strong_count(lock) > 1);
        }
        lookups
            .entry(user_id)
            .or_insert_with(|| std::sync::Arc::new(AsyncMutex::new(())))
            .clone()
    };
    let lookup_guard = lookup.lock().await;
    let now = Instant::now();
    let cached = image_session_generations()
        .lock()
        .await
        .get(&user_id)
        .copied()
        .filter(|cached| {
            now.saturating_duration_since(cached.checked_at) <= IMAGE_SESSION_GENERATION_TTL
        });
    let current = if let Some(cached) = cached {
        cached.version
    } else {
        let version = lookup_token_generation(pool, user_id, claims.session_id.clone()).await?;
        let mut cache = image_session_generations().lock().await;
        if cache.len() >= MAX_IMAGE_SESSION_CACHE_ENTRIES {
            cache.retain(|_, cached| {
                now.saturating_duration_since(cached.checked_at) <= IMAGE_SESSION_GENERATION_TTL
            });
        }
        if cache.len() >= MAX_IMAGE_SESSION_CACHE_ENTRIES {
            let mut oldest = cache
                .iter()
                .map(|(id, cached)| (*id, cached.checked_at))
                .collect::<Vec<_>>();
            oldest.sort_unstable_by_key(|(_, checked_at)| *checked_at);
            for (id, _) in oldest
                .into_iter()
                .take(cache.len() - MAX_IMAGE_SESSION_CACHE_ENTRIES + 1)
            {
                cache.remove(&id);
            }
        }
        cache.insert(
            user_id,
            CachedTokenGeneration {
                version,
                checked_at: now,
            },
        );
        version
    };
    drop(lookup_guard);
    let mut lookups = image_session_lookups().lock().await;
    if lookups
        .get(&user_id)
        .is_some_and(|stored| std::sync::Arc::ptr_eq(stored, &lookup))
        && std::sync::Arc::strong_count(&lookup) == 2
    {
        lookups.remove(&user_id);
    }
    Ok(current
        .is_some_and(|version| version == claims.token_version)
        .then_some(claims))
}

pub(crate) async fn invalidate_image_session(user_id: i32) {
    if let Some(cache) = IMAGE_SESSION_GENERATIONS.get() {
        cache.lock().await.remove(&user_id);
    }
    if let Some(lookups) = IMAGE_SESSION_LOOKUPS.get() {
        lookups.lock().await.remove(&user_id);
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
        ACCESS_TOKEN_COOKIE, Claims, NATIVE_CLIENT_HEADER, REFRESH_TOKEN_COOKIE, approve_pairing,
        claims_are_current, clear_auth_attempts, client_attempt_key, generate_access_token,
        generate_media_token, generate_refresh_token, hash_password, invalidate_image_session,
        is_valid, media_token_from_service_request, normalized_pairing_code, pairing_status,
        record_auth_attempt, refresh, registration_role, request_has_current_admin, start_pairing,
        token_from_service_request, valid_password, valid_username, verify_password,
    };
    use actix_web::{
        App, HttpResponse,
        cookie::Cookie,
        http::{StatusCode, header},
        test as actix_test, web,
    };
    use actix_web_httpauth::middleware::HttpAuthentication;
    use diesel::RunQueryDsl;
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
                "CREATE TABLE user (\
                    id INTEGER PRIMARY KEY,\
                    username TEXT NOT NULL,\
                    bitrate INTEGER NOT NULL,\
                    role TEXT NOT NULL,\
                    token_version INTEGER NOT NULL\
                 );\
                 CREATE TABLE refresh_session (\
                    id TEXT PRIMARY KEY,\
                    user_id INTEGER NOT NULL,\
                    token_hash TEXT NOT NULL UNIQUE,\
                    expires_at BIGINT NOT NULL\
                 );\
                 INSERT INTO user VALUES ({user_id}, 'alice', 320, 'admin', {token_version});"
            ))
            .expect("session fixture");
        web::Data::new(std::sync::Arc::new(pool))
    }

    fn refresh_token_fixture(
        database: &web::Data<crate::persistence::connection::DbPool>,
        user_id: i32,
        token_version: i32,
    ) -> String {
        session_tokens_fixture(database, user_id, token_version).1
    }

    fn session_tokens_fixture(
        database: &web::Data<crate::persistence::connection::DbPool>,
        user_id: i32,
        token_version: i32,
    ) -> (String, String) {
        let session_id = uuid::Uuid::new_v4().to_string();
        let (token, expires_at) =
            generate_refresh_token(user_id, "alice", "admin", token_version, &session_id)
                .expect("test refresh token");
        let access = super::generate_session_access_token(
            user_id,
            "alice",
            320,
            "admin",
            token_version,
            Some(&session_id),
        )
        .expect("test access token");
        super::insert_refresh_session(
            &mut database.get().expect("refresh fixture connection"),
            &session_id,
            user_id,
            &token,
            expires_at,
        )
        .expect("store refresh fixture");
        (access, token)
    }

    async fn protected_probe() -> HttpResponse {
        HttpResponse::NoContent().finish()
    }

    #[test]
    fn first_registration_is_admin_without_bootstrap_credentials() {
        assert_eq!(registration_role(0, None), Ok("admin".to_string()));
        assert_eq!(
            registration_role(1, None),
            Err("admin_authorization_required")
        );
        assert_eq!(registration_role(1, Some("user")), Ok("user".to_string()));
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
    async fn is_valid_accepts_access_token_bearer_header() {
        let role = "admin".to_string();
        let token = match generate_access_token(42, "alice", 320, &role, 0) {
            Ok(token) => token,
            Err(e) => panic!("test setup failed to generate access token: {}", e),
        };
        let app = actix_test::init_service(App::new().service(is_valid)).await;
        let req = actix_test::TestRequest::get()
            .uri("/session")
            .insert_header((header::AUTHORIZATION, format!("Bearer {token}")))
            .to_request();

        let response = actix_test::call_service(&app, req).await;

        assert_eq!(response.status(), StatusCode::OK);
        let body: Value = actix_test::read_body_json(response).await;
        assert_eq!(body["status"], true);
        assert_eq!(body["claims"]["username"], "alice");
    }

    #[actix_web::test]
    async fn refresh_rejects_requests_without_refresh_token_cookie() {
        let app = actix_test::init_service(App::new().service(refresh)).await;
        let req = actix_test::TestRequest::post().uri("/refresh").to_request();

        let response = actix_test::call_service(&app, req).await;

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let expired = response
            .headers()
            .get_all(header::SET_COOKIE)
            .filter_map(|value| value.to_str().ok())
            .collect::<Vec<_>>();
        assert!(
            expired
                .iter()
                .any(|value| value.starts_with("plm_accessToken=") && value.contains("Max-Age=0"))
        );
        assert!(
            expired
                .iter()
                .any(|value| value.starts_with("plm_refreshToken=") && value.contains("Max-Age=0"))
        );
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

    #[actix_web::test]
    async fn native_refresh_rotates_bearer_credentials_without_an_origin() {
        let database = session_pool(42, 3);
        let refresh_token = refresh_token_fixture(&database, 42, 3);
        let app = actix_test::init_service(App::new().app_data(database).service(refresh)).await;
        let req = actix_test::TestRequest::post()
            .uri("/refresh")
            .insert_header((header::AUTHORIZATION, format!("Bearer {refresh_token}")))
            .insert_header((NATIVE_CLIENT_HEADER, "native"))
            .to_request();

        let response = actix_test::call_service(&app, req).await;

        assert_eq!(response.status(), StatusCode::OK);
        let access_cookie = response
            .headers()
            .get_all(header::SET_COOKIE)
            .filter_map(|value| value.to_str().ok())
            .find(|value| value.starts_with("plm_accessToken="))
            .expect("rotated access cookie");
        assert!(access_cookie.contains("HttpOnly"));
        let body: Value = actix_test::read_body_json(response).await;
        assert_eq!(body["status"], true);
        assert!(
            body["access_token"]
                .as_str()
                .is_some_and(|value| !value.is_empty())
        );
        assert!(
            body["refresh_token"]
                .as_str()
                .is_some_and(|value| !value.is_empty())
        );
    }

    #[actix_web::test]
    async fn refresh_uses_the_current_database_username() {
        let database = session_pool(42, 3);
        let refresh_token = refresh_token_fixture(&database, 42, 3);
        diesel::sql_query("UPDATE user SET username = 'new-handle' WHERE id = 42")
            .execute(&mut database.get().expect("rename fixture connection"))
            .expect("rename fixture user");
        let app = actix_test::init_service(App::new().app_data(database).service(refresh)).await;
        let request = actix_test::TestRequest::post()
            .uri("/refresh")
            .insert_header((header::AUTHORIZATION, format!("Bearer {refresh_token}")))
            .insert_header((NATIVE_CLIENT_HEADER, "native"))
            .to_request();

        let response = actix_test::call_service(&app, request).await;

        assert_eq!(response.status(), StatusCode::OK);
        let body: Value = actix_test::read_body_json(response).await;
        assert_eq!(body["claims"]["username"], "new-handle");
    }

    #[actix_web::test]
    async fn browser_origin_never_receives_refresh_credentials_in_json() {
        let database = session_pool(42, 3);
        let refresh_token = refresh_token_fixture(&database, 42, 3);
        let app = actix_test::init_service(App::new().app_data(database).service(refresh)).await;
        let req = actix_test::TestRequest::post()
            .uri("/refresh")
            .insert_header((header::AUTHORIZATION, format!("Bearer {refresh_token}")))
            .insert_header((NATIVE_CLIENT_HEADER, "native"))
            .insert_header((header::ORIGIN, "https://music.example"))
            .to_request();

        let response = actix_test::call_service(&app, req).await;

        assert_eq!(response.status(), StatusCode::OK);
        let access_cookie = response
            .headers()
            .get_all(header::SET_COOKIE)
            .filter_map(|value| value.to_str().ok())
            .find(|value| value.starts_with("plm_accessToken="))
            .expect("rotated browser access cookie");
        assert!(access_cookie.contains("HttpOnly"));
        let body: Value = actix_test::read_body_json(response).await;
        assert_eq!(body["status"], true);
        assert_eq!(body["access_token"], "");
        assert_eq!(body["refresh_token"], "");
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

    #[actix_web::test]
    async fn native_logout_revokes_only_its_refresh_session() {
        let database = session_pool(42, 3);
        let (token, _) = session_tokens_fixture(&database, 42, 3);
        let (other_token, _) = session_tokens_fixture(&database, 42, 3);
        let app =
            actix_test::init_service(App::new().app_data(database.clone()).service(super::logout))
                .await;
        let req = actix_test::TestRequest::post()
            .uri("/logout")
            .insert_header((header::AUTHORIZATION, format!("Bearer {token}")))
            .to_request();

        let response = actix_test::call_service(&app, req).await;

        assert_eq!(response.status(), StatusCode::OK);
        let validation_request = actix_test::TestRequest::get()
            .insert_header((header::AUTHORIZATION, format!("Bearer {token}")))
            .to_http_request();
        assert!(
            !request_has_current_admin(&validation_request, database.get_ref().clone())
                .await
                .expect("session lookup")
        );
        let other_request = actix_test::TestRequest::get()
            .insert_header((header::AUTHORIZATION, format!("Bearer {other_token}")))
            .to_http_request();
        assert!(
            request_has_current_admin(&other_request, database.get_ref().clone())
                .await
                .expect("other session lookup"),
            "logging out one device must not revoke another device"
        );
    }

    #[actix_web::test]
    async fn logout_uses_a_valid_refresh_cookie_when_the_access_cookie_is_invalid() {
        let database = session_pool(42, 3);
        let (_, refresh_token) = session_tokens_fixture(&database, 42, 3);
        let app = actix_test::init_service(
            App::new()
                .app_data(database)
                .service(super::logout)
                .service(refresh),
        )
        .await;
        let logout_request = actix_test::TestRequest::post()
            .uri("/logout")
            .cookie(Cookie::new(ACCESS_TOKEN_COOKIE, "invalid"))
            .cookie(Cookie::new(REFRESH_TOKEN_COOKIE, refresh_token.clone()))
            .to_request();
        let logout_response = actix_test::call_service(&app, logout_request).await;
        assert_eq!(logout_response.status(), StatusCode::OK);

        let replay = actix_test::TestRequest::post()
            .uri("/refresh")
            .insert_header((header::AUTHORIZATION, format!("Bearer {refresh_token}")))
            .insert_header((NATIVE_CLIENT_HEADER, "native"))
            .to_request();
        assert_eq!(
            actix_test::call_service(&app, replay).await.status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[actix_web::test]
    async fn refresh_tokens_are_single_use() {
        let database = session_pool(42, 3);
        let refresh_token = refresh_token_fixture(&database, 42, 3);
        let app = actix_test::init_service(App::new().app_data(database).service(refresh)).await;
        let request = || {
            actix_test::TestRequest::post()
                .uri("/refresh")
                .insert_header((header::AUTHORIZATION, format!("Bearer {refresh_token}")))
                .insert_header((NATIVE_CLIENT_HEADER, "native"))
                .to_request()
        };

        assert_eq!(
            actix_test::call_service(&app, request()).await.status(),
            StatusCode::OK
        );
        assert_eq!(
            actix_test::call_service(&app, request()).await.status(),
            StatusCode::UNAUTHORIZED
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
        assert!(!valid_username("alice\nadmin"));
        assert!(!valid_username("alice\0admin"));
        assert!(!valid_username(&"a".repeat(65)));
        assert!(valid_password("correct horse battery staple"));
        assert!(valid_password("🔐🔐🔐🔐🔐🔐🔐🔐"));
        assert!(!valid_password("🔐🔐"));
        assert!(!valid_password("short"));
        assert!(!valid_password(&"x".repeat(257)));
        assert!(!valid_password(&"🔐".repeat(257)));
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
            session_id: None,
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
    async fn artwork_session_bursts_share_a_short_generation_lookup() {
        let user_id = 998_877;
        invalidate_image_session(user_id).await;
        let database = session_pool(user_id, 3);
        let token =
            generate_access_token(user_id, "alice", 320, "admin", 3).expect("test access token");
        let request = actix_test::TestRequest::get()
            .cookie(Cookie::new(ACCESS_TOKEN_COOKIE, token))
            .to_http_request();

        assert!(
            super::current_image_session_claims(&request, database.get_ref().clone())
                .await
                .expect("first image session lookup")
                .is_some()
        );
        diesel::delete(crate::persistence::schema::user::table)
            .execute(&mut database.get().expect("delete test user"))
            .expect("delete test user");

        assert!(
            super::current_image_session_claims(&request, database.get_ref().clone())
                .await
                .expect("cached image session lookup")
                .is_some(),
            "the second image should use the burst cache"
        );
        invalidate_image_session(user_id).await;
        assert!(
            super::current_image_session_claims(&request, database.get_ref().clone())
                .await
                .expect("invalidated image session lookup")
                .is_none()
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
            session_id: None,
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
    fn pairing_codes_accept_readable_spacing_but_require_six_digits() {
        assert_eq!(
            normalized_pairing_code("123 456").as_deref(),
            Some("123456")
        );
        assert_eq!(normalized_pairing_code("12-34").as_deref(), None);
        assert_eq!(normalized_pairing_code("abcdef"), None);
    }

    #[actix_web::test]
    async fn signed_in_account_can_approve_a_short_lived_native_pairing() {
        let database = session_pool(42, 3);
        let access =
            generate_access_token(42, "alice", 320, "admin", 3).expect("pairing approver token");
        let app = actix_test::init_service(
            App::new()
                .app_data(database)
                .service(start_pairing)
                .service(pairing_status)
                .service(
                    web::scope("")
                        .wrap(HttpAuthentication::with_fn(super::validator))
                        .service(approve_pairing),
                ),
        )
        .await;
        let start = actix_test::TestRequest::post()
            .uri("/pairing/start")
            .set_json(serde_json::json!({ "device_name": "Test Android" }))
            .to_request();
        let start_response = actix_test::call_service(&app, start).await;
        assert_eq!(start_response.status(), StatusCode::OK);
        let pairing: Value = actix_test::read_body_json(start_response).await;

        let approve = actix_test::TestRequest::post()
            .uri("/pairing/approve")
            .cookie(Cookie::new(ACCESS_TOKEN_COOKIE, access))
            .set_json(serde_json::json!({ "code": pairing["code"] }))
            .to_request();
        let approve_response = actix_test::call_service(&app, approve).await;
        assert_eq!(approve_response.status(), StatusCode::OK);

        let poll = actix_test::TestRequest::post()
            .uri("/pairing/status")
            .set_json(serde_json::json!({
                "pairing_id": pairing["pairingId"],
                "secret": pairing["secret"]
            }))
            .to_request();
        let poll_response = actix_test::call_service(&app, poll).await;
        assert_eq!(poll_response.status(), StatusCode::OK);
        let paired: Value = actix_test::read_body_json(poll_response).await;
        assert_eq!(paired["status"], true);
        assert_eq!(paired["claims"]["username"], "alice");
        assert!(
            paired["access_token"]
                .as_str()
                .is_some_and(|token| !token.is_empty())
        );
        assert!(
            paired["refresh_token"]
                .as_str()
                .is_some_and(|token| !token.is_empty())
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
            session_id: None,
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
