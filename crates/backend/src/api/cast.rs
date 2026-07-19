use std::path::Path;
use std::sync::OnceLock;

use actix_web::{HttpRequest, HttpResponse, delete, get, patch, post, web};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use diesel::deserialize::QueryableByName;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Bool, Double, Integer, Nullable, Text};
use futures::StreamExt;
use percent_encoding::{AsciiSet, CONTROLS, utf8_percent_encode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::api::auth::authenticated_user_id;
use crate::api::library::stream_cast_compatible;
use crate::library::state::{LibraryLifecycle, library_unavailable_response};
use crate::persistence::connection::DbPool;

const MAX_CAST_QUEUE_ITEMS: usize = 100;
const MAX_RECEIVER_FIELD_CHARACTERS: usize = 128;
const CAST_URL_LIFETIME_SECONDS: i64 = 12 * 60 * 60;
const CAST_EVENT_BUFFER: usize = 256;
const URL_COMPONENT: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'/')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

static CAST_EVENTS: OnceLock<tokio::sync::broadcast::Sender<i32>> = OnceLock::new();

fn cast_events() -> &'static tokio::sync::broadcast::Sender<i32> {
    CAST_EVENTS.get_or_init(|| tokio::sync::broadcast::channel(CAST_EVENT_BUFFER).0)
}

fn notify_cast_changed(user_id: i32) {
    let _ = cast_events().send(user_id);
}

#[derive(Deserialize)]
struct CreateCastSessionRequest {
    receiver_id: String,
    receiver_name: String,
    song_ids: Vec<String>,
    #[serde(default)]
    current_position: i32,
}

#[derive(Deserialize)]
struct UpdateCastStateRequest {
    revision: i32,
    current_position: i32,
    position_ms: i64,
    duration_ms: i64,
    playing: bool,
    volume: f64,
    muted: bool,
    status: String,
    acknowledged_command_revision: i32,
}

#[derive(Deserialize)]
struct CastCommandRequest {
    command: String,
    position_ms: Option<i64>,
    volume: Option<f64>,
    muted: Option<bool>,
    queue_position: Option<i32>,
}

#[derive(Deserialize)]
pub(crate) struct CastMediaQuery {
    session: String,
    expires: i64,
    signature: String,
}

#[derive(Clone, QueryableByName)]
struct CastSessionRow {
    #[diesel(sql_type = Text)]
    id: String,
    #[diesel(sql_type = Text)]
    receiver_id: String,
    #[diesel(sql_type = Text)]
    receiver_name: String,
    #[diesel(sql_type = Text)]
    status: String,
    #[diesel(sql_type = Integer)]
    current_position: i32,
    #[diesel(sql_type = BigInt)]
    position_ms: i64,
    #[diesel(sql_type = BigInt)]
    duration_ms: i64,
    #[diesel(sql_type = Bool)]
    playing: bool,
    #[diesel(sql_type = Double)]
    volume: f64,
    #[diesel(sql_type = Bool)]
    muted: bool,
    #[diesel(sql_type = Text)]
    repeat_mode: String,
    #[diesel(sql_type = Integer)]
    revision: i32,
    #[diesel(sql_type = Nullable<Text>)]
    command: Option<String>,
    #[diesel(sql_type = Nullable<BigInt>)]
    command_position_ms: Option<i64>,
    #[diesel(sql_type = Nullable<Double>)]
    command_volume: Option<f64>,
    #[diesel(sql_type = Nullable<Bool>)]
    command_muted: Option<bool>,
    #[diesel(sql_type = Nullable<Integer>)]
    command_queue_position: Option<i32>,
    #[diesel(sql_type = Integer)]
    command_revision: i32,
    #[diesel(sql_type = Integer)]
    acknowledged_command_revision: i32,
    #[diesel(sql_type = BigInt)]
    expires_at: i64,
}

#[derive(QueryableByName)]
struct CastItemRow {
    #[diesel(sql_type = Integer)]
    position: i32,
    #[diesel(sql_type = Text)]
    song_id: String,
}

#[derive(Serialize)]
struct CastSessionResponse {
    id: String,
    receiver_id: String,
    receiver_name: String,
    status: String,
    current_position: i32,
    position_ms: i64,
    duration_ms: i64,
    playing: bool,
    volume: f64,
    muted: bool,
    repeat_mode: String,
    revision: i32,
    command: Option<String>,
    command_position_ms: Option<i64>,
    command_volume: Option<f64>,
    command_muted: Option<bool>,
    command_queue_position: Option<i32>,
    command_revision: i32,
    acknowledged_command_revision: i32,
    expires_at: i64,
    items: Vec<CastQueueItem>,
}

#[derive(Serialize)]
struct CastQueueItem {
    position: i32,
    song_id: String,
    title: String,
    artist: String,
    album: String,
    artwork_url: Option<String>,
    media_url: String,
    content_type: &'static str,
    duration_ms: i64,
}

fn now_seconds() -> i64 {
    chrono::Utc::now().timestamp()
}

fn signature_payload(session_id: &str, song_id: &str, expires: i64) -> String {
    format!("{session_id}\n{song_id}\n{expires}")
}

fn sign_media_url(session_id: &str, song_id: &str, expires: i64) -> String {
    URL_SAFE_NO_PAD.encode(media_signature_bytes(session_id, song_id, expires))
}

fn verify_media_signature(session_id: &str, song_id: &str, expires: i64, signature: &str) -> bool {
    let Ok(candidate) = URL_SAFE_NO_PAD.decode(signature) else {
        return false;
    };
    let expected = media_signature_bytes(session_id, song_id, expires);
    candidate.len() == expected.len()
        && candidate
            .iter()
            .zip(expected)
            .fold(0_u8, |difference, (left, right)| {
                difference | (left ^ right)
            })
            == 0
}

fn media_signature_bytes(session_id: &str, song_id: &str, expires: i64) -> [u8; 32] {
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
    inner.update(signature_payload(session_id, song_id, expires));
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner);
    outer.finalize().into()
}

fn request_origin(request: &HttpRequest) -> String {
    let connection = request.connection_info();
    format!("{}://{}", connection.scheme(), connection.host())
}

fn encoded(value: &str) -> String {
    utf8_percent_encode(value, URL_COMPONENT).to_string()
}

fn cast_content_type(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("mp3") => "audio/mpeg",
        Some("aac") => "audio/aac",
        Some("m4a") | Some("mp4") => "audio/mp4",
        _ => "audio/mpeg",
    }
}

fn valid_receiver_field(value: &str) -> bool {
    !value.trim().is_empty()
        && value.trim() == value
        && value.chars().count() <= MAX_RECEIVER_FIELD_CHARACTERS
}

fn valid_status(value: &str) -> bool {
    matches!(
        value,
        "connecting" | "playing" | "paused" | "stopped" | "ended" | "failed"
    )
}

fn valid_command(
    value: &str,
    position_ms: Option<i64>,
    volume: Option<f64>,
    muted: Option<bool>,
    queue_position: Option<i32>,
) -> bool {
    match value {
        "play" | "pause" | "next" | "previous" | "stop" => {
            position_ms.is_none() && volume.is_none() && muted.is_none() && queue_position.is_none()
        }
        "seek" => {
            position_ms.is_some_and(|value| value >= 0)
                && volume.is_none()
                && muted.is_none()
                && queue_position.is_none()
        }
        "set_volume" => {
            position_ms.is_none()
                && muted.is_none()
                && queue_position.is_none()
                && volume.is_some_and(|value| value.is_finite() && (0.0..=1.0).contains(&value))
        }
        "set_mute" => {
            position_ms.is_none() && volume.is_none() && muted.is_some() && queue_position.is_none()
        }
        "jump" => {
            position_ms.is_none()
                && volume.is_none()
                && muted.is_none()
                && queue_position.is_some_and(|value| value >= 0)
        }
        _ => false,
    }
}

fn query_session(
    connection: &mut diesel::sqlite::SqliteConnection,
    session_id: &str,
    user_id: i32,
) -> Result<Option<(CastSessionRow, Vec<CastItemRow>)>, diesel::result::Error> {
    let session = diesel::sql_query(
        "SELECT id, receiver_id, receiver_name, status, current_position,
                CAST(position_ms AS BIGINT) AS position_ms,
                CAST(duration_ms AS BIGINT) AS duration_ms,
                playing, volume, muted, repeat_mode, revision, command,
                CAST(command_position_ms AS BIGINT) AS command_position_ms,
                command_volume, command_muted, command_queue_position,
                command_revision, acknowledged_command_revision,
                CAST(expires_at AS BIGINT) AS expires_at
         FROM cast_session WHERE id = ? AND user_id = ?",
    )
    .bind::<Text, _>(session_id)
    .bind::<Integer, _>(user_id)
    .get_result::<CastSessionRow>(connection)
    .optional()?;
    let Some(session) = session else {
        return Ok(None);
    };
    let items = diesel::sql_query(
        "SELECT position, song_id FROM cast_session_item
         WHERE session_id = ? ORDER BY position ASC",
    )
    .bind::<Text, _>(session_id)
    .load::<CastItemRow>(connection)?;
    Ok(Some((session, items)))
}

fn hydrate_response(
    session: CastSessionRow,
    items: Vec<CastItemRow>,
    origin: &str,
    lifecycle: &crate::library::state::LibraryCache,
) -> CastSessionResponse {
    let expires = session
        .expires_at
        .min(now_seconds() + CAST_URL_LIFETIME_SECONDS);
    let items = items
        .into_iter()
        .filter_map(|item| {
            let song = lifecycle.song(&item.song_id)?;
            let (artist_id, album_id) = lifecycle.song_map.get(&item.song_id)?;
            let artist = lifecycle.artist(artist_id)?;
            let album = lifecycle.album(album_id)?;
            let signature = sign_media_url(&session.id, &song.id, expires);
            let media_url = format!(
                "{origin}/api/v1/cast/media/{}/stream?session={}&expires={expires}&signature={signature}",
                encoded(&song.id),
                encoded(&session.id),
            );
            let artwork_url = (!album.cover_url.trim().is_empty()).then(|| {
                format!(
                    "{origin}/media/images/{}?raw=true",
                    encoded(&album.cover_url)
                )
            });
            Some(CastQueueItem {
                position: item.position,
                song_id: song.id.clone(),
                title: song.name.clone(),
                artist: artist.name.clone(),
                album: album.name.clone(),
                artwork_url,
                media_url,
                content_type: cast_content_type(&song.path),
                duration_ms: (song.duration.max(0.0) * 1_000.0).round() as i64,
            })
        })
        .collect();
    CastSessionResponse {
        id: session.id,
        receiver_id: session.receiver_id,
        receiver_name: session.receiver_name,
        status: session.status,
        current_position: session.current_position,
        position_ms: session.position_ms,
        duration_ms: session.duration_ms,
        playing: session.playing,
        volume: session.volume,
        muted: session.muted,
        repeat_mode: session.repeat_mode,
        revision: session.revision,
        command: session.command,
        command_position_ms: session.command_position_ms,
        command_volume: session.command_volume,
        command_muted: session.command_muted,
        command_queue_position: session.command_queue_position,
        command_revision: session.command_revision,
        acknowledged_command_revision: session.acknowledged_command_revision,
        expires_at: session.expires_at,
        items,
    }
}

async fn response_for_session(
    request: &HttpRequest,
    session_id: String,
    user_id: i32,
    pool: &DbPool,
    lifecycle: &web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let query_pool = pool.clone();
    let queried = web::block(move || {
        let mut connection = query_pool.get().map_err(|error| error.to_string())?;
        query_session(&mut connection, &session_id, user_id).map_err(|error| error.to_string())
    })
    .await;
    match queried {
        Ok(Ok(Some((session, items)))) => HttpResponse::Ok().json(hydrate_response(
            session,
            items,
            &request_origin(request),
            cache.as_ref(),
        )),
        Ok(Ok(None)) => {
            HttpResponse::NotFound().json(serde_json::json!({"error": "cast_session_not_found"}))
        }
        Ok(Err(error)) => {
            tracing::error!(%error, "cast session lookup failed");
            HttpResponse::InternalServerError().finish()
        }
        Err(error) => {
            tracing::error!(%error, "cast session lookup worker failed");
            HttpResponse::InternalServerError().finish()
        }
    }
}

#[post("")]
async fn create_session(
    request: HttpRequest,
    form: web::Json<CreateCastSessionRequest>,
    pool: web::Data<DbPool>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let user_id = match authenticated_user_id(&request) {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    if !valid_receiver_field(&form.receiver_id)
        || !valid_receiver_field(&form.receiver_name)
        || form.song_ids.is_empty()
        || form.song_ids.len() > MAX_CAST_QUEUE_ITEMS
        || form.current_position < 0
        || form.current_position as usize >= form.song_ids.len()
    {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({"error": "invalid_cast_session"}));
    }
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    if form
        .song_ids
        .iter()
        .any(|song_id| cache.song(song_id).is_none())
    {
        return HttpResponse::BadRequest().json(serde_json::json!({"error": "invalid_cast_queue"}));
    }

    let session_id = Uuid::new_v4().to_string();
    let expires_at = now_seconds() + CAST_URL_LIFETIME_SECONDS;
    let receiver_id = form.receiver_id.clone();
    let receiver_name = form.receiver_name.clone();
    let song_ids = form.song_ids.clone();
    let current_position = form.current_position;
    let insert_pool = pool.get_ref().clone();
    let insert_session_id = session_id.clone();
    let inserted = web::block(move || -> Result<(), String> {
        let mut connection = insert_pool.get().map_err(|error| error.to_string())?;
        connection
            .transaction::<_, diesel::result::Error, _>(|connection| {
                diesel::sql_query(
                    "UPDATE cast_session SET status = 'stopped', playing = 0,
                            updated_at = CURRENT_TIMESTAMP, revision = revision + 1
                     WHERE user_id = ? AND status IN ('connecting', 'playing', 'paused')",
                )
                .bind::<Integer, _>(user_id)
                .execute(connection)?;
                diesel::sql_query(
                    "INSERT INTO cast_session
                     (id, user_id, receiver_id, receiver_name, current_position, expires_at)
                     VALUES (?, ?, ?, ?, ?, ?)",
                )
                .bind::<Text, _>(&insert_session_id)
                .bind::<Integer, _>(user_id)
                .bind::<Text, _>(&receiver_id)
                .bind::<Text, _>(&receiver_name)
                .bind::<Integer, _>(current_position)
                .bind::<BigInt, _>(expires_at)
                .execute(connection)?;
                for (position, song_id) in song_ids.iter().enumerate() {
                    diesel::sql_query(
                        "INSERT INTO cast_session_item (session_id, position, song_id)
                         VALUES (?, ?, ?)",
                    )
                    .bind::<Text, _>(&insert_session_id)
                    .bind::<Integer, _>(position as i32)
                    .bind::<Text, _>(song_id)
                    .execute(connection)?;
                }
                Ok(())
            })
            .map_err(|error| error.to_string())
    })
    .await;
    if !matches!(inserted, Ok(Ok(()))) {
        tracing::error!(?inserted, "cast session persistence failed");
        return HttpResponse::InternalServerError().finish();
    }
    notify_cast_changed(user_id);
    response_for_session(&request, session_id, user_id, pool.get_ref(), &lifecycle).await
}

#[get("/current")]
async fn current_session(
    request: HttpRequest,
    pool: web::Data<DbPool>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let user_id = match authenticated_user_id(&request) {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    let query_pool = pool.get_ref().clone();
    let session_id = web::block(move || -> Result<Option<String>, String> {
        let mut connection = query_pool.get().map_err(|error| error.to_string())?;
        #[derive(QueryableByName)]
        struct IdRow {
            #[diesel(sql_type = Text)]
            id: String,
        }
        diesel::sql_query(
            "SELECT id FROM cast_session
             WHERE user_id = ? AND status IN ('connecting', 'playing', 'paused') AND expires_at >= ?
             ORDER BY updated_at DESC LIMIT 1",
        )
        .bind::<Integer, _>(user_id)
        .bind::<BigInt, _>(now_seconds())
        .get_result::<IdRow>(&mut connection)
        .optional()
        .map(|row| row.map(|row| row.id))
        .map_err(|error| error.to_string())
    })
    .await;
    match session_id {
        Ok(Ok(Some(session_id))) => {
            response_for_session(&request, session_id, user_id, pool.get_ref(), &lifecycle).await
        }
        Ok(Ok(None)) => HttpResponse::NoContent().finish(),
        Ok(Err(error)) => {
            tracing::error!(%error, "current cast session lookup failed");
            HttpResponse::InternalServerError().finish()
        }
        Err(error) => {
            tracing::error!(%error, "current cast session lookup worker failed");
            HttpResponse::InternalServerError().finish()
        }
    }
}

#[get("/events")]
async fn session_events(
    request: HttpRequest,
    payload: web::Payload,
) -> Result<HttpResponse, actix_web::Error> {
    let user_id = match authenticated_user_id(&request) {
        Ok(user_id) => user_id,
        Err(response) => return Ok(response),
    };
    let (response, mut session, mut messages) = actix_ws::handle(&request, payload)?;
    let mut events = cast_events().subscribe();
    actix_web::rt::spawn(async move {
        tracing::info!(user_id, "cast session WebSocket connected");
        if session.text(r#"{"type":"ready"}"#).await.is_err() {
            return;
        }
        loop {
            tokio::select! {
                event = events.recv() => match event {
                    Ok(changed_user_id) if changed_user_id == user_id => {
                        if session.text(r#"{"type":"cast_session_changed"}"#).await.is_err() {
                            break;
                        }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        if session.text(r#"{"type":"cast_session_changed"}"#).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                },
                message = messages.next() => match message {
                    Some(Ok(actix_ws::Message::Ping(bytes))) => {
                        if session.pong(&bytes).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(actix_ws::Message::Close(reason))) => {
                        let _ = session.close(reason).await;
                        break;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) | None => break,
                }
            }
        }
        tracing::info!(user_id, "cast session WebSocket disconnected");
    });
    Ok(response)
}

#[get("/{session_id}")]
async fn get_session(
    request: HttpRequest,
    session_id: web::Path<String>,
    pool: web::Data<DbPool>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let user_id = match authenticated_user_id(&request) {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    response_for_session(
        &request,
        session_id.into_inner(),
        user_id,
        pool.get_ref(),
        &lifecycle,
    )
    .await
}

#[patch("/{session_id}/state")]
async fn update_state(
    request: HttpRequest,
    session_id: web::Path<String>,
    form: web::Json<UpdateCastStateRequest>,
    pool: web::Data<DbPool>,
) -> HttpResponse {
    let user_id = match authenticated_user_id(&request) {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    if form.revision < 1
        || form.current_position < 0
        || form.position_ms < 0
        || form.duration_ms < 0
        || !form.volume.is_finite()
        || !(0.0..=1.0).contains(&form.volume)
        || !valid_status(&form.status)
        || form.acknowledged_command_revision < 0
    {
        return HttpResponse::BadRequest().json(serde_json::json!({"error": "invalid_cast_state"}));
    }
    let session_id = session_id.into_inner();
    let update_pool = pool.get_ref().clone();
    let form = form.into_inner();
    let result = web::block(move || -> Result<(usize, Option<CastSessionRow>), String> {
        let mut connection = update_pool.get().map_err(|error| error.to_string())?;
        let previous = query_session(&mut connection, &session_id, user_id)
            .map_err(|error| error.to_string())?
            .map(|(session, _)| session);
        let item_count = diesel::sql_query(
            "SELECT CAST(COUNT(*) AS BIGINT) AS count FROM cast_session_item WHERE session_id = ?",
        )
        .bind::<Text, _>(&session_id)
        .get_result::<CountRow>(&mut connection)
        .map_err(|error| error.to_string())?
        .count;
        if i64::from(form.current_position) >= item_count {
            return Ok((0, None));
        }
        let changed = diesel::sql_query(
            "UPDATE cast_session SET current_position = ?, position_ms = ?, duration_ms = ?,
                    playing = ?, volume = ?, muted = ?, status = ?,
                    acknowledged_command_revision = ?, revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND user_id = ? AND revision = ?
                   AND acknowledged_command_revision <= ? AND command_revision >= ?",
        )
        .bind::<Integer, _>(form.current_position)
        .bind::<BigInt, _>(form.position_ms)
        .bind::<BigInt, _>(form.duration_ms)
        .bind::<Bool, _>(form.playing)
        .bind::<Double, _>(form.volume)
        .bind::<Bool, _>(form.muted)
        .bind::<Text, _>(&form.status)
        .bind::<Integer, _>(form.acknowledged_command_revision)
        .bind::<Text, _>(&session_id)
        .bind::<Integer, _>(user_id)
        .bind::<Integer, _>(form.revision)
        .bind::<Integer, _>(form.acknowledged_command_revision)
        .bind::<Integer, _>(form.acknowledged_command_revision)
        .execute(&mut connection)
        .map_err(|error| error.to_string())?;
        if changed == 1
            && previous.is_some_and(|previous| {
                previous.current_position != form.current_position
                    || (previous.status == "connecting"
                        && matches!(form.status.as_str(), "playing" | "paused"))
            })
        {
            diesel::sql_query(
                "INSERT INTO listen_history_item (user_id, song_id)
                 SELECT ?, song_id FROM cast_session_item
                 WHERE session_id = ? AND position = ?",
            )
            .bind::<Integer, _>(user_id)
            .bind::<Text, _>(&session_id)
            .bind::<Integer, _>(form.current_position)
            .execute(&mut connection)
            .map_err(|error| error.to_string())?;
        }
        let current = query_session(&mut connection, &session_id, user_id)
            .map_err(|error| error.to_string())?
            .map(|(session, _)| session);
        Ok((changed, current))
    })
    .await;
    match result {
        Ok(Ok((1, Some(session)))) => {
            notify_cast_changed(user_id);
            HttpResponse::Ok().json(serde_json::json!({
                "revision": session.revision,
                "command_revision": session.command_revision,
                "acknowledged_command_revision": session.acknowledged_command_revision,
            }))
        }
        Ok(Ok((0, Some(session)))) => HttpResponse::Conflict().json(serde_json::json!({
            "error": "cast_session_revision_conflict",
            "revision": session.revision,
            "command_revision": session.command_revision,
            "acknowledged_command_revision": session.acknowledged_command_revision,
        })),
        Ok(Ok((_, None))) => {
            HttpResponse::BadRequest().json(serde_json::json!({"error": "cast_position_invalid"}))
        }
        Ok(Err(error)) => {
            tracing::error!(%error, "cast state update failed");
            HttpResponse::InternalServerError().finish()
        }
        Err(error) => {
            tracing::error!(%error, "cast state update worker failed");
            HttpResponse::InternalServerError().finish()
        }
        _ => HttpResponse::InternalServerError().finish(),
    }
}

#[derive(QueryableByName)]
struct CountRow {
    #[diesel(sql_type = BigInt)]
    count: i64,
}

#[post("/{session_id}/commands")]
async fn send_command(
    request: HttpRequest,
    session_id: web::Path<String>,
    form: web::Json<CastCommandRequest>,
    pool: web::Data<DbPool>,
) -> HttpResponse {
    let user_id = match authenticated_user_id(&request) {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    if !valid_command(
        &form.command,
        form.position_ms,
        form.volume,
        form.muted,
        form.queue_position,
    ) {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({"error": "invalid_cast_command"}));
    }
    let command_pool = pool.get_ref().clone();
    let session_id = session_id.into_inner();
    let form = form.into_inner();
    let result = web::block(move || -> Result<Option<(i32, i32)>, String> {
        let mut connection = command_pool.get().map_err(|error| error.to_string())?;
        if let Some(position) = form.queue_position {
            let count = diesel::sql_query(
                "SELECT CAST(COUNT(*) AS BIGINT) AS count FROM cast_session_item WHERE session_id = ?",
            )
            .bind::<Text, _>(&session_id)
            .get_result::<CountRow>(&mut connection)
            .map_err(|error| error.to_string())?
            .count;
            if i64::from(position) >= count {
                return Ok(Some((-1, -1)));
            }
        }
        let changed = diesel::sql_query(
            "UPDATE cast_session SET command = ?, command_position_ms = ?, command_volume = ?, command_muted = ?, command_queue_position = ?,
                    command_revision = command_revision + 1, revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND user_id = ? AND status IN ('connecting', 'playing', 'paused')
                   AND expires_at >= ?",
        )
        .bind::<Text, _>(&form.command)
        .bind::<Nullable<BigInt>, _>(form.position_ms)
        .bind::<Nullable<Double>, _>(form.volume)
        .bind::<Nullable<Bool>, _>(form.muted)
        .bind::<Nullable<Integer>, _>(form.queue_position)
        .bind::<Text, _>(&session_id)
        .bind::<Integer, _>(user_id)
        .bind::<BigInt, _>(now_seconds())
        .execute(&mut connection)
        .map_err(|error| error.to_string())?;
        if changed == 0 {
            return Ok(None);
        }
        query_session(&mut connection, &session_id, user_id)
            .map_err(|error| error.to_string())
            .map(|row| row.map(|(session, _)| (session.revision, session.command_revision)))
    })
    .await;
    match result {
        Ok(Ok(Some((-1, -1)))) => {
            HttpResponse::BadRequest().json(serde_json::json!({"error": "cast_position_invalid"}))
        }
        Ok(Ok(Some((revision, command_revision)))) => {
            notify_cast_changed(user_id);
            HttpResponse::Accepted().json(serde_json::json!({
                "revision": revision,
                "command_revision": command_revision,
            }))
        }
        Ok(Ok(None)) => {
            HttpResponse::NotFound().json(serde_json::json!({"error": "cast_session_not_found"}))
        }
        Ok(Err(error)) => {
            tracing::error!(%error, "cast command persistence failed");
            HttpResponse::InternalServerError().finish()
        }
        Err(error) => {
            tracing::error!(%error, "cast command persistence worker failed");
            HttpResponse::InternalServerError().finish()
        }
    }
}

#[delete("/{session_id}")]
async fn stop_session(
    request: HttpRequest,
    session_id: web::Path<String>,
    pool: web::Data<DbPool>,
) -> HttpResponse {
    let user_id = match authenticated_user_id(&request) {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    let stop_pool = pool.get_ref().clone();
    let session_id = session_id.into_inner();
    let stopped = web::block(move || -> Result<usize, String> {
        let mut connection = stop_pool.get().map_err(|error| error.to_string())?;
        diesel::sql_query(
            "UPDATE cast_session SET status = 'stopped', playing = 0, command = 'stop',
                    command_revision = command_revision + 1, revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
        )
        .bind::<Text, _>(&session_id)
        .bind::<Integer, _>(user_id)
        .execute(&mut connection)
        .map_err(|error| error.to_string())
    })
    .await;
    match stopped {
        Ok(Ok(1)) => {
            notify_cast_changed(user_id);
            HttpResponse::NoContent().finish()
        }
        Ok(Ok(_)) => HttpResponse::NotFound().finish(),
        Ok(Err(error)) => {
            tracing::error!(%error, "cast session stop failed");
            HttpResponse::InternalServerError().finish()
        }
        Err(error) => {
            tracing::error!(%error, "cast session stop worker failed");
            HttpResponse::InternalServerError().finish()
        }
    }
}

pub(crate) async fn cast_media(
    request: HttpRequest,
    song_id: web::Path<String>,
    query: web::Query<CastMediaQuery>,
    pool: web::Data<DbPool>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let song_id = song_id.into_inner();
    if query.expires < now_seconds()
        || !verify_media_signature(&query.session, &song_id, query.expires, &query.signature)
    {
        return HttpResponse::Unauthorized().json(serde_json::json!({"error": "cast_url_invalid"}));
    }
    let verify_pool = pool.get_ref().clone();
    let session_id = query.session.clone();
    let verify_song_id = song_id.clone();
    let expires = query.expires;
    let allowed = web::block(move || -> Result<bool, String> {
        let mut connection = verify_pool.get().map_err(|error| error.to_string())?;
        let row = diesel::sql_query(
            "SELECT CAST(COUNT(*) AS BIGINT) AS count
             FROM cast_session s JOIN cast_session_item i ON i.session_id = s.id
             WHERE s.id = ? AND i.song_id = ? AND s.status IN ('connecting', 'playing', 'paused')
                   AND s.expires_at >= ? AND s.expires_at >= ?",
        )
        .bind::<Text, _>(&session_id)
        .bind::<Text, _>(&verify_song_id)
        .bind::<BigInt, _>(now_seconds())
        .bind::<BigInt, _>(expires)
        .get_result::<CountRow>(&mut connection)
        .map_err(|error| error.to_string())?;
        Ok(row.count == 1)
    })
    .await;
    if !matches!(allowed, Ok(Ok(true))) {
        return HttpResponse::Unauthorized()
            .json(serde_json::json!({"error": "cast_session_inactive"}));
    }
    stream_cast_compatible(&request, &song_id, &lifecycle).await
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/cast/sessions")
            .service(create_session)
            .service(current_session)
            .service(session_events)
            .service(get_session)
            .service(update_state)
            .service(send_command)
            .service(stop_session),
    );
}

#[cfg(test)]
mod tests {
    use super::{
        cast_events, notify_cast_changed, sign_media_url, valid_command, verify_media_signature,
    };

    #[actix_web::test]
    async fn cast_change_events_are_user_scoped_and_push_driven() {
        let mut events = cast_events().subscribe();
        notify_cast_changed(42);
        assert_eq!(events.recv().await.expect("cast change event"), 42);
    }

    #[test]
    fn receiver_urls_are_bound_to_session_song_and_expiry() {
        let signature = sign_media_url("session-a", "song-a", 12345);
        assert!(verify_media_signature(
            "session-a",
            "song-a",
            12345,
            &signature
        ));
        assert!(!verify_media_signature(
            "session-b",
            "song-a",
            12345,
            &signature
        ));
        assert!(!verify_media_signature(
            "session-a",
            "song-b",
            12345,
            &signature
        ));
        assert!(!verify_media_signature(
            "session-a",
            "song-a",
            12346,
            &signature
        ));
    }

    #[test]
    fn cast_commands_reject_ambiguous_arguments() {
        assert!(valid_command("play", None, None, None, None));
        assert!(valid_command("seek", Some(10), None, None, None));
        assert!(valid_command("set_volume", None, Some(0.5), None, None));
        assert!(valid_command("set_mute", None, None, Some(true), None));
        assert!(valid_command("jump", None, None, None, Some(2)));
        assert!(!valid_command("seek", None, None, None, None));
        assert!(!valid_command("play", Some(10), None, None, None));
        assert!(!valid_command("set_volume", None, Some(2.0), None, None));
    }
}
