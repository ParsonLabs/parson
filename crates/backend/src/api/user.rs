use std::error::Error;
use std::io::Write;
use std::sync::OnceLock;

use actix_multipart::Multipart;
use actix_web::{HttpRequest, HttpResponse, Responder, delete, get, patch, post, put, web};
use bytes::BytesMut;
use diesel::{
    BoolExpressionMethods, Connection, ExpressionMethods, OptionalExtension, QueryDsl, RunQueryDsl,
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};

use crate::api::auth::{authenticated_user_id, hash_password, valid_password, verify_password};
use crate::api::error::{bad_request, internal_server_error, not_found, unauthorized};
use crate::api::song::{ResponseSong, SongInfo, fetch_song_info_from_cache};
use crate::library::state::{LibraryCache, LibraryLifecycle, library_unavailable_response};
use crate::library::storage::get_profile_picture_path;
use crate::persistence::connection::DbPool;
use crate::persistence::models::{ListenHistoryItem, NewListenHistoryItem, User};
use crate::persistence::schema::listen_history_item::dsl as lh_dsl;
use crate::recommendation::{
    PlaybackEventRequest, record_playback_event, schedule_listen_history_retention,
};
use std::collections::HashMap;

#[derive(Serialize)]
struct SettingsUser {
    id: i32,
    username: String,
    role: String,
}

#[get("")]
async fn get_users(
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> Result<HttpResponse, Box<dyn Error>> {
    use crate::persistence::schema::user::dsl::*;

    let authenticated = match authenticated_user_id(&request) {
        Ok(authenticated) => authenticated,
        Err(response) => return Ok(response),
    };
    let users_pool = pool.get_ref().clone();
    let result = web::block(move || -> Result<Option<Vec<SettingsUser>>, String> {
        let mut connection = users_pool.get().map_err(|error| error.to_string())?;
        let requester_role = user
            .filter(id.eq(authenticated))
            .select(role)
            .first::<String>(&mut connection)
            .optional()
            .map_err(|error| error.to_string())?;
        if requester_role.as_deref() != Some("admin") {
            return Ok(None);
        }
        user.order(username.asc())
            .select((id, username, role))
            .load::<(i32, String, String)>(&mut connection)
            .map(|users| {
                Some(
                    users
                        .into_iter()
                        .map(|(user_id, user_name, user_role)| SettingsUser {
                            id: user_id,
                            username: user_name,
                            role: user_role,
                        })
                        .collect(),
                )
            })
            .map_err(|error| error.to_string())
    })
    .await;

    match result {
        Ok(Ok(Some(users))) => Ok(HttpResponse::Ok().json(users)),
        Ok(Ok(None)) => Ok(crate::api::error::forbidden(
            "Administrator access is required.",
            "admin_required",
        )),
        Ok(Err(error)) => {
            tracing::error!(%error, "user list lookup failed");
            Ok(internal_server_error(
                "Could not load users.",
                "users_load_failed",
            ))
        }
        Err(error) => {
            tracing::error!(%error, "user list worker failed");
            Ok(internal_server_error(
                "Could not load users.",
                "users_load_failed",
            ))
        }
    }
}

fn hydrate_song_ids(ids: Vec<String>, cache: &LibraryCache) -> Vec<ResponseSong> {
    let mut seen = std::collections::HashSet::new();
    ids.into_iter()
        .filter(|id| seen.insert(id.clone()))
        .filter_map(
            |id| match fetch_song_info_from_cache(&id, cache, Some(false)) {
                Ok(SongInfo::Full(song)) => Some(song),
                _ => None,
            },
        )
        .collect()
}

/// Maximum rows returned from play-history reads.
const MAX_HISTORY_PAGE_SIZE: i64 = 200;
const MAX_FAVORITES_PAGE_SIZE: i64 = 200;
const MAX_AVATAR_BYTES: usize = 5 * 1024 * 1024;
const MAX_STORED_AVATAR_BYTES: u64 = 25 * 1024 * 1024;
const AVATAR_WRITE_LOCK_COUNT: usize = 32;
static AVATAR_WRITE_LOCKS: OnceLock<[std::sync::Mutex<()>; AVATAR_WRITE_LOCK_COUNT]> =
    OnceLock::new();

fn avatar_write_lock(user_id: i32) -> &'static std::sync::Mutex<()> {
    let locks =
        AVATAR_WRITE_LOCKS.get_or_init(|| std::array::from_fn(|_| std::sync::Mutex::new(())));
    &locks[(user_id.unsigned_abs() as usize) % AVATAR_WRITE_LOCK_COUNT]
}

#[derive(Deserialize)]
pub struct AuthData {
    current_password: String,
    new_password: String,
}

#[post("/me/password")]
pub async fn change_password(
    form: web::Json<AuthData>,
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> Result<impl Responder, Box<dyn Error>> {
    use crate::persistence::schema::user::dsl::*;

    let user_id = match authenticated_user_id(&request) {
        Ok(authenticated_id) => authenticated_id,
        Err(response) => return Ok(response),
    };
    if !valid_password(&form.current_password) || !valid_password(&form.new_password) {
        return Ok(bad_request(
            "Passwords must contain between 8 and 256 bytes.",
            "invalid_password_length",
        ));
    }
    let password_pool = pool.get_ref().clone();
    let current_password = form.current_password.clone();
    let new_password = form.new_password.clone();
    let result = web::block(move || -> Result<Result<(), &'static str>, String> {
        let mut connection = password_pool.get().map_err(|error| error.to_string())?;
        let stored_password = user
            .filter(id.eq(user_id))
            .select(password)
            .first::<String>(&mut connection)
            .optional()
            .map_err(|error| error.to_string())?;
        let Some(stored_password) = stored_password else {
            return Ok(Err("not_found"));
        };
        if !verify_password(&current_password, &stored_password) {
            return Ok(Err("incorrect"));
        }
        let hashed = hash_password(&new_password).map_err(|error| error.to_string())?;
        diesel::update(user.filter(id.eq(user_id)))
            .set((password.eq(hashed), token_version.eq(token_version + 1)))
            .execute(&mut connection)
            .map_err(|error| error.to_string())?;
        Ok(Ok(()))
    })
    .await;

    match result {
        Ok(Ok(Ok(()))) => Ok(HttpResponse::Ok().body("Password changed")),
        Ok(Ok(Err("not_found"))) => Ok(not_found("User not found.", "user_not_found")),
        Ok(Ok(Err("incorrect"))) => Ok(unauthorized(
            "Current password is incorrect.",
            "current_password_incorrect",
        )),
        Ok(Ok(Err(_))) | Ok(Err(_)) | Err(_) => Ok(internal_server_error(
            "There was an error updating the password.",
            "password_update_failed",
        )),
    }
}

#[derive(Deserialize)]
struct ListenHistoryQuery {
    limit: Option<i64>,
    /// Stable keyset cursor. Prefer this over `offset`; its cost does not grow
    /// with the number of older rows in the account.
    before_id: Option<i32>,
    /// Compatibility only. Bounded so legacy clients cannot cause deep scans.
    offset: Option<i64>,
}

#[get("/me/history")]
async fn get_listen_history(
    query: web::Query<ListenHistoryQuery>,
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> Result<HttpResponse, Box<dyn Error>> {
    let user_id = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return Ok(response),
    };
    let limit = query.limit.unwrap_or(50).clamp(1, MAX_HISTORY_PAGE_SIZE);
    // Bound deep offsets to limit SQLite work.
    let offset = query.offset.unwrap_or(0).clamp(0, 1_000);
    let before_id = query.before_id;
    let history_pool = pool.get_ref().clone();
    match web::block(move || -> Result<Vec<ListenHistoryItem>, String> {
        let mut connection = history_pool.get().map_err(|error| error.to_string())?;
        let mut statement = lh_dsl::listen_history_item
            .filter(lh_dsl::user_id.eq(user_id))
            .into_boxed();
        if let Some(cursor) = before_id {
            statement = statement.filter(lh_dsl::id.lt(cursor));
        }
        statement
            .order(lh_dsl::id.desc())
            .limit(limit)
            .offset(offset)
            .load::<ListenHistoryItem>(&mut connection)
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(results)) => Ok(HttpResponse::Ok().json(results)),
        Ok(Err(error)) => {
            tracing::error!(%error, "history lookup failed");
            Ok(internal_server_error(
                "Could not load history.",
                "history_load_failed",
            ))
        }
        Err(error) => {
            tracing::error!(%error, "history lookup worker failed");
            Ok(internal_server_error(
                "Could not load history.",
                "history_load_failed",
            ))
        }
    }
}

#[get("/me/history/songs")]
async fn get_listen_history_songs(
    query: web::Query<ListenHistoryQuery>,
    pool: web::Data<DbPool>,
    lifecycle: web::Data<LibraryLifecycle>,
    request: HttpRequest,
) -> HttpResponse {
    let user_id = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let limit = query.limit.unwrap_or(50).clamp(1, MAX_HISTORY_PAGE_SIZE);
    let offset = query.offset.unwrap_or(0).clamp(0, 1_000);
    let before_id = query.before_id;
    let history_pool = pool.get_ref().clone();
    match web::block(move || -> Result<Vec<String>, String> {
        let mut connection = history_pool.get().map_err(|error| error.to_string())?;
        let mut statement = lh_dsl::listen_history_item
            .filter(lh_dsl::user_id.eq(user_id))
            .into_boxed();
        if let Some(cursor) = before_id {
            statement = statement.filter(lh_dsl::id.lt(cursor));
        }
        statement
            .order(lh_dsl::id.desc())
            .select(lh_dsl::song_id)
            .limit(limit)
            .offset(offset)
            .load::<String>(&mut connection)
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(ids)) => HttpResponse::Ok().json(hydrate_song_ids(ids, cache.as_ref())),
        Ok(Err(error)) => {
            tracing::error!(%error, "history songs lookup failed");
            internal_server_error("Could not load history.", "history_songs_load_failed")
        }
        Err(error) => {
            tracing::error!(%error, "history songs lookup worker failed");
            internal_server_error("Could not load history.", "history_songs_load_failed")
        }
    }
}

#[derive(Deserialize)]
pub struct AddSongRequest {
    song_id: String,
}

#[post("/me/history")]
pub async fn add_song_to_listen_history(
    item: web::Json<AddSongRequest>,
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> Result<HttpResponse, Box<dyn Error>> {
    let user_id = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return Ok(response),
    };
    if item.song_id.is_empty() || item.song_id.chars().count() > 256 {
        return Ok(bad_request(
            "Song identifier is empty or too long.",
            "history_song_id_invalid",
        ));
    }
    let history_pool = pool.get_ref().clone();
    let song_id = item.song_id.clone();
    match web::block(move || -> Result<(), String> {
        let mut connection = history_pool.get().map_err(|error| error.to_string())?;
        connection
            .transaction(|connection| {
                let new_item = NewListenHistoryItem { user_id, song_id };
                diesel::insert_into(lh_dsl::listen_history_item)
                    .values(&new_item)
                    .execute(connection)?;
                schedule_listen_history_retention(connection, user_id)?;
                Ok::<_, diesel::result::Error>(())
            })
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(())) => Ok(HttpResponse::Ok().body("Song added to history")),
        Ok(Err(error)) => {
            tracing::error!(%error, "history insert failed");
            Ok(internal_server_error(
                "Could not update history.",
                "history_insert_failed",
            ))
        }
        Err(error) => {
            tracing::error!(%error, "history insert worker failed");
            Ok(internal_server_error(
                "Could not update history.",
                "history_insert_failed",
            ))
        }
    }
}

#[derive(Deserialize)]
struct FavoritesQuery {
    limit: Option<i64>,
    before_added_at: Option<chrono::NaiveDateTime>,
    before_song_id: Option<String>,
    /// Compatibility only. New clients use the compound keyset cursor.
    offset: Option<i64>,
}

fn favorite_page_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(100).clamp(1, MAX_FAVORITES_PAGE_SIZE)
}

#[derive(Serialize)]
struct FavoriteSongResponse {
    song_id: String,
    added_at: chrono::NaiveDateTime,
}

#[derive(Serialize)]
struct FavoriteSongDetailResponse {
    song_id: String,
    added_at: chrono::NaiveDateTime,
    song: ResponseSong,
}

#[derive(Serialize)]
struct FavoriteMembershipResponse {
    liked: bool,
}

#[get("/me/favorites")]
async fn get_favorite_songs(
    query: web::Query<FavoritesQuery>,
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> HttpResponse {
    use crate::persistence::schema::favorite_song::dsl as favorites;

    let user_id = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let limit = favorite_page_limit(query.limit);
    let offset = query.offset.unwrap_or(0).clamp(0, 1_000);
    let cursor = query.before_added_at.zip(query.before_song_id.clone());
    let favorites_pool = pool.get_ref().clone();

    match web::block(move || -> Result<Vec<FavoriteSongResponse>, String> {
        let mut connection = favorites_pool.get().map_err(|error| error.to_string())?;
        let mut statement = favorites::favorite_song
            .filter(favorites::user_id.eq(user_id))
            .into_boxed();
        if let Some((added_at, song_id)) = cursor {
            statement = statement.filter(
                favorites::added_at.lt(added_at).or(favorites::added_at
                    .eq(added_at)
                    .and(favorites::song_id.gt(song_id))),
            );
        }
        statement
            .select((favorites::song_id, favorites::added_at))
            .order((favorites::added_at.desc(), favorites::song_id.asc()))
            .limit(limit)
            .offset(offset)
            .load::<(String, chrono::NaiveDateTime)>(&mut connection)
            .map(|items| {
                items
                    .into_iter()
                    .map(|(song_id, added_at)| FavoriteSongResponse { song_id, added_at })
                    .collect()
            })
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(items)) => HttpResponse::Ok().json(items),
        Ok(Err(error)) => {
            tracing::error!(%error, "favorite songs lookup failed");
            internal_server_error("Could not load liked songs.", "favorite_songs_load_failed")
        }
        Err(error) => {
            tracing::error!(%error, "favorite songs lookup worker failed");
            internal_server_error("Could not load liked songs.", "favorite_songs_load_failed")
        }
    }
}

#[get("/me/favorites/songs")]
async fn get_favorite_song_details(
    query: web::Query<FavoritesQuery>,
    pool: web::Data<DbPool>,
    lifecycle: web::Data<LibraryLifecycle>,
    request: HttpRequest,
) -> HttpResponse {
    use crate::persistence::schema::favorite_song::dsl as favorites;

    let user_id = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let limit = favorite_page_limit(query.limit);
    let offset = query.offset.unwrap_or(0).clamp(0, 1_000);
    let cursor = query.before_added_at.zip(query.before_song_id.clone());
    let favorites_pool = pool.get_ref().clone();
    match web::block(move || -> Result<Vec<FavoriteSongResponse>, String> {
        let mut connection = favorites_pool.get().map_err(|error| error.to_string())?;
        let mut statement = favorites::favorite_song
            .filter(favorites::user_id.eq(user_id))
            .into_boxed();
        if let Some((added_at, song_id)) = cursor {
            statement = statement.filter(
                favorites::added_at.lt(added_at).or(favorites::added_at
                    .eq(added_at)
                    .and(favorites::song_id.gt(song_id))),
            );
        }
        statement
            .select((favorites::song_id, favorites::added_at))
            .order((favorites::added_at.desc(), favorites::song_id.asc()))
            .limit(limit)
            .offset(offset)
            .load::<(String, chrono::NaiveDateTime)>(&mut connection)
            .map(|items| {
                items
                    .into_iter()
                    .map(|(song_id, added_at)| FavoriteSongResponse { song_id, added_at })
                    .collect()
            })
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(items)) => {
            let details = items
                .into_iter()
                .filter_map(|item| {
                    let song = match fetch_song_info_from_cache(
                        &item.song_id,
                        cache.as_ref(),
                        Some(false),
                    ) {
                        Ok(SongInfo::Full(song)) => song,
                        _ => return None,
                    };
                    Some(FavoriteSongDetailResponse {
                        song_id: item.song_id,
                        added_at: item.added_at,
                        song,
                    })
                })
                .collect::<Vec<_>>();
            HttpResponse::Ok().json(details)
        }
        Ok(Err(error)) => {
            tracing::error!(%error, "favorite song details lookup failed");
            internal_server_error(
                "Could not load liked songs.",
                "favorite_song_details_failed",
            )
        }
        Err(error) => {
            tracing::error!(%error, "favorite song details worker failed");
            internal_server_error(
                "Could not load liked songs.",
                "favorite_song_details_failed",
            )
        }
    }
}

#[get("/me/favorites/{song_id}")]
async fn favorite_song_membership(
    path: web::Path<String>,
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> HttpResponse {
    use crate::persistence::schema::favorite_song::dsl as favorites;

    let user_id = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let favorite_id = path.into_inner();
    if favorite_id.is_empty() || favorite_id.chars().count() > 256 {
        return bad_request(
            "Song identifier is empty or too long.",
            "favorite_song_id_invalid",
        );
    }
    let membership_pool = pool.get_ref().clone();
    match web::block(move || -> Result<bool, String> {
        let mut connection = membership_pool.get().map_err(|error| error.to_string())?;
        favorites::favorite_song
            .filter(favorites::user_id.eq(user_id))
            .filter(favorites::song_id.eq(favorite_id))
            .select(favorites::song_id)
            .first::<String>(&mut connection)
            .optional()
            .map(|row| row.is_some())
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(liked)) => HttpResponse::Ok().json(FavoriteMembershipResponse { liked }),
        Ok(Err(error)) => {
            tracing::error!(%error, "favorite membership lookup failed");
            internal_server_error("Could not check liked song.", "favorite_membership_failed")
        }
        Err(error) => {
            tracing::error!(%error, "favorite membership worker failed");
            internal_server_error("Could not check liked song.", "favorite_membership_failed")
        }
    }
}

#[post("/me/favorites/{song_id}")]
async fn add_favorite_song(
    path: web::Path<String>,
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> HttpResponse {
    use crate::persistence::schema::favorite_song::dsl as favorites;
    use crate::persistence::schema::song::dsl as songs;

    let user_id = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let favorite_id = path.into_inner();
    if favorite_id.is_empty() || favorite_id.chars().count() > 256 {
        return bad_request(
            "Song identifier is empty or too long.",
            "favorite_song_id_invalid",
        );
    }
    let favorites_pool = pool.get_ref().clone();

    match web::block(move || -> Result<Option<usize>, String> {
        let mut connection = favorites_pool.get().map_err(|error| error.to_string())?;
        let song_exists = songs::song
            .find(&favorite_id)
            .select(songs::id)
            .first::<String>(&mut connection)
            .optional()
            .map_err(|error| error.to_string())?
            .is_some();
        if !song_exists {
            return Ok(None);
        }
        diesel::insert_into(favorites::favorite_song)
            .values((
                favorites::user_id.eq(user_id),
                favorites::song_id.eq(favorite_id),
            ))
            .on_conflict((favorites::user_id, favorites::song_id))
            .do_nothing()
            .execute(&mut connection)
            .map(Some)
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(Some(1))) => HttpResponse::Created().finish(),
        Ok(Ok(Some(_))) => HttpResponse::Ok().finish(),
        Ok(Ok(None)) => not_found("Song not found.", "song_not_found"),
        Ok(Err(error)) => {
            tracing::error!(%error, "favorite song insert failed");
            internal_server_error("Could not like this song.", "favorite_song_insert_failed")
        }
        Err(error) => {
            tracing::error!(%error, "favorite song insert worker failed");
            internal_server_error("Could not like this song.", "favorite_song_insert_failed")
        }
    }
}

#[delete("/me/favorites/{song_id}")]
async fn remove_favorite_song(
    path: web::Path<String>,
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> HttpResponse {
    use crate::persistence::schema::favorite_song::dsl as favorites;

    let user_id = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let favorite_id = path.into_inner();
    if favorite_id.is_empty() || favorite_id.chars().count() > 256 {
        return bad_request(
            "Song identifier is empty or too long.",
            "favorite_song_id_invalid",
        );
    }
    let favorites_pool = pool.get_ref().clone();

    match web::block(move || -> Result<usize, String> {
        let mut connection = favorites_pool.get().map_err(|error| error.to_string())?;
        diesel::delete(
            favorites::favorite_song
                .filter(favorites::user_id.eq(user_id))
                .filter(favorites::song_id.eq(favorite_id)),
        )
        .execute(&mut connection)
        .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(_)) => HttpResponse::NoContent().finish(),
        Ok(Err(error)) => {
            tracing::error!(%error, "favorite song delete failed");
            internal_server_error("Could not unlike this song.", "favorite_song_delete_failed")
        }
        Err(error) => {
            tracing::error!(%error, "favorite song delete worker failed");
            internal_server_error("Could not unlike this song.", "favorite_song_delete_failed")
        }
    }
}

#[post("/me/playback-events")]
async fn add_playback_event(
    item: web::Json<PlaybackEventRequest>,
    lifecycle: web::Data<LibraryLifecycle>,
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> HttpResponse {
    let user_id = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let event = item.into_inner();
    let event_cache = cache.clone();
    let event_pool = pool.get_ref().clone();
    match web::block(move || {
        record_playback_event(user_id, &event, event_cache.as_ref(), &event_pool)
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(result)) => HttpResponse::Ok().json(result),
        Ok(Err(error)) => HttpResponse::BadRequest().json(serde_json::json!({
            "error": "invalid_playback_event",
            "message": error,
        })),
        Err(error) => {
            tracing::error!(%error, "playback event worker failed");
            HttpResponse::InternalServerError().finish()
        }
    }
}

#[derive(Deserialize)]
struct SetBitrateRequest {
    bitrate: i32,
}

#[patch("/me/preferences")]
async fn set_bitrate(
    item: web::Json<SetBitrateRequest>,
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> impl Responder {
    use crate::persistence::schema::user::dsl::{bitrate, user};

    let user_id = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    if item.bitrate != 0 && !(64..=320).contains(&item.bitrate) {
        return bad_request(
            "Bitrate must be 0 or between 64 and 320 kbps.",
            "invalid_bitrate",
        );
    }
    let preference_pool = pool.get_ref().clone();
    let requested_bitrate = item.bitrate;
    match web::block(move || -> Result<usize, String> {
        let mut connection = preference_pool.get().map_err(|error| error.to_string())?;
        diesel::update(user.find(user_id))
            .set(bitrate.eq(requested_bitrate))
            .execute(&mut connection)
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(1)) => HttpResponse::Ok().body("Bitrate set"),
        Ok(Ok(_)) => not_found("User not found.", "user_not_found"),
        Ok(Err(error)) => {
            tracing::error!(%error, "bitrate update failed");
            internal_server_error("Error updating bitrate.", "bitrate_update_failed")
        }
        Err(error) => {
            tracing::error!(%error, "bitrate update worker failed");
            internal_server_error("Error updating bitrate.", "bitrate_update_failed")
        }
    }
}

#[derive(Deserialize)]
pub struct SetNowPlayingRequest {
    now_playing: String,
}

#[patch("/me/playback")]
pub async fn set_now_playing(
    item: web::Json<SetNowPlayingRequest>,
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> impl Responder {
    use crate::persistence::schema::user::dsl::{now_playing, user};

    let user_id = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    if item.now_playing.len() > 160 {
        return bad_request("Song identifier is too long.", "now_playing_too_long");
    }
    let playback_pool = pool.get_ref().clone();
    let requested_song = item.now_playing.clone();
    match web::block(move || -> Result<usize, String> {
        let mut connection = playback_pool.get().map_err(|error| error.to_string())?;
        diesel::update(user.find(user_id))
            .set(now_playing.eq(requested_song))
            .execute(&mut connection)
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(1)) => HttpResponse::Ok().body("Now playing set"),
        Ok(Ok(_)) => not_found("User not found.", "user_not_found"),
        Ok(Err(error)) => {
            tracing::error!(%error, "now-playing update failed");
            internal_server_error("Error updating now playing.", "now_playing_update_failed")
        }
        Err(error) => {
            tracing::error!(%error, "now-playing update worker failed");
            internal_server_error("Error updating now playing.", "now_playing_update_failed")
        }
    }
}

#[derive(Serialize)]
struct GetNowPlayingResponse {
    now_playing: Option<String>,
}

#[get("/me/playback")]
async fn get_now_playing(pool: web::Data<DbPool>, request: HttpRequest) -> impl Responder {
    use crate::persistence::schema::user::dsl::{now_playing, user};

    let user_id = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let playback_pool = pool.get_ref().clone();
    match web::block(move || -> Result<Option<Option<String>>, String> {
        let mut connection = playback_pool.get().map_err(|error| error.to_string())?;
        user.find(user_id)
            .select(now_playing)
            .first::<Option<String>>(&mut connection)
            .optional()
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(Some(result))) => HttpResponse::Ok().json(GetNowPlayingResponse {
            now_playing: result,
        }),
        Ok(Ok(None)) => not_found("User not found.", "user_not_found"),
        Ok(Err(error)) => {
            tracing::error!(%error, "now-playing lookup failed");
            internal_server_error("Error loading now playing.", "now_playing_load_failed")
        }
        Err(error) => {
            tracing::error!(%error, "now-playing lookup worker failed");
            internal_server_error("Error loading now playing.", "now_playing_load_failed")
        }
    }
}

#[get("/by-username/{username}")]
async fn get_user_info(
    path: web::Path<String>,
    pool: web::Data<DbPool>,
) -> Result<impl Responder, Box<dyn Error>> {
    use crate::persistence::schema::user::dsl::*;

    let path_username = path.into_inner();
    let lookup_pool = pool.get_ref().clone();
    match web::block(move || -> Result<Option<User>, String> {
        let mut connection = lookup_pool.get().map_err(|error| error.to_string())?;
        user.filter(username.eq(&path_username))
            .first::<User>(&mut connection)
            .optional()
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(Some(found))) => Ok(HttpResponse::Ok().json(found)),
        Ok(Ok(None)) => Ok(not_found("User not found.", "user_not_found")),
        Ok(Err(error)) => {
            tracing::error!(%error, "user lookup failed");
            Ok(internal_server_error(
                "Could not load user.",
                "user_load_failed",
            ))
        }
        Err(error) => {
            tracing::error!(%error, "user lookup worker failed");
            Ok(internal_server_error(
                "Could not load user.",
                "user_load_failed",
            ))
        }
    }
}

#[get("/{id}")]
async fn get_user_info_by_id(
    path: web::Path<i32>,
    pool: web::Data<DbPool>,
) -> Result<impl Responder, Box<dyn Error>> {
    use crate::persistence::schema::user::dsl::*;

    let path_id = path.into_inner();
    let lookup_pool = pool.get_ref().clone();
    match web::block(move || -> Result<Option<User>, String> {
        let mut connection = lookup_pool.get().map_err(|error| error.to_string())?;
        user.filter(id.eq(path_id))
            .first::<User>(&mut connection)
            .optional()
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(Some(found))) => Ok(HttpResponse::Ok().json(found)),
        Ok(Ok(None)) => Ok(not_found("User not found.", "user_not_found")),
        Ok(Err(error)) => {
            tracing::error!(%error, "user lookup failed");
            Ok(internal_server_error(
                "Could not load user.",
                "user_load_failed",
            ))
        }
        Err(error) => {
            tracing::error!(%error, "user lookup worker failed");
            Ok(internal_server_error(
                "Could not load user.",
                "user_load_failed",
            ))
        }
    }
}

#[get("/{id}/avatar")]
pub async fn get_profile_picture(path: web::Path<i32>) -> Result<impl Responder, Box<dyn Error>> {
    let user_id = path.into_inner();
    let mut profile_picture_path = get_profile_picture_path();
    profile_picture_path.push(format!("{}.jpg", user_id));

    match crate::api::image::read_file_bounded(&profile_picture_path, MAX_STORED_AVATAR_BYTES).await
    {
        Ok(image_data) => Ok(HttpResponse::Ok()
            .content_type("image/jpeg")
            .body(image_data)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let initial = user_id.to_string().chars().next().unwrap_or('?');
            let svg = format!(
                r##"<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="#1f2937"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="54" font-weight="700" fill="#f9fafb">{}</text></svg>"##,
                initial
            );
            Ok(HttpResponse::Ok()
                .content_type("image/svg+xml; charset=utf-8")
                .body(svg))
        }
        Err(error) if error.kind() == std::io::ErrorKind::FileTooLarge => {
            Ok(HttpResponse::PayloadTooLarge().json(serde_json::json!({
                "error": "avatar_file_too_large",
                "message": "The stored profile picture is too large."
            })))
        }
        Err(error) => {
            tracing::error!(%error, user_id, "avatar read failed");
            Ok(internal_server_error(
                "Could not load the profile picture.",
                "avatar_read_failed",
            ))
        }
    }
}

#[put("/{id}/avatar")]
async fn upload_profile_picture(
    mut payload: Multipart,
    path: web::Path<i32>,
    request: HttpRequest,
) -> Result<impl Responder, Box<dyn Error>> {
    let user_id = path.into_inner();
    let authenticated = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return Ok(response),
    };
    if authenticated != user_id {
        return Ok(unauthorized(
            "You can only update your own profile picture.",
            "avatar_owner_required",
        ));
    }
    let mut profile_picture_path = get_profile_picture_path();
    profile_picture_path.push(format!("{}.jpg", user_id));
    let mut uploaded = None;
    while let Some(item) = payload.next().await {
        let mut field = item?;
        if uploaded.is_some() {
            return Ok(crate::api::error::bad_request(
                "Upload exactly one image.",
                "avatar_multiple_files",
            ));
        }
        let mut bytes = BytesMut::new();
        while let Some(chunk) = field.next().await {
            let data = chunk?;
            if bytes.len().saturating_add(data.len()) > MAX_AVATAR_BYTES {
                return Ok(HttpResponse::PayloadTooLarge().json(serde_json::json!({
                    "error": "avatar_too_large",
                    "message": "Profile pictures must be 5 MB or smaller."
                })));
            }
            bytes.extend_from_slice(&data);
        }
        uploaded = Some(bytes.freeze());
    }
    let Some(uploaded) = uploaded else {
        return Ok(crate::api::error::bad_request(
            "No profile picture was provided.",
            "avatar_missing",
        ));
    };
    let destination = profile_picture_path.clone();
    web::block(move || -> Result<(), String> {
        let _write_guard = avatar_write_lock(user_id)
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let cursor = std::io::Cursor::new(uploaded);
        let mut reader = image::ImageReader::new(cursor)
            .with_guessed_format()
            .map_err(|error| error.to_string())?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(4096);
        limits.max_image_height = Some(4096);
        limits.max_alloc = Some(64 * 1024 * 1024);
        reader.limits(limits);
        let image = reader.decode().map_err(|error| error.to_string())?;
        let mut encoded = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, 88)
            .encode_image(&image)
            .map_err(|error| error.to_string())?;
        let parent = destination
            .parent()
            .ok_or_else(|| "Avatar destination has no parent directory".to_string())?;
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let temporary = destination.with_extension(format!("jpg.{}.tmp", uuid::Uuid::new_v4()));
        let backup = destination.with_extension("jpg.bak");
        let result = (|| -> Result<(), std::io::Error> {
            let mut file = std::fs::File::create(&temporary)?;
            file.write_all(&encoded)?;
            file.sync_all()?;
            if destination.exists() {
                let _ = std::fs::remove_file(&backup);
                std::fs::rename(&destination, &backup)?;
            }
            if let Err(error) = std::fs::rename(&temporary, &destination) {
                if backup.exists() {
                    let _ = std::fs::rename(&backup, &destination);
                }
                return Err(error);
            }
            let _ = std::fs::remove_file(&backup);
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result.map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| std::io::Error::other(error.to_string()))?
    .map_err(std::io::Error::other)?;
    Ok(HttpResponse::Ok().body("Profile picture uploaded successfully"))
}

#[get("/{user_id}/recommendations")]
async fn get_recommended_full(
    path: web::Path<u32>,
    query: web::Query<HashMap<String, String>>,
    lifecycle: web::Data<LibraryLifecycle>,
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> Result<impl Responder, Box<dyn Error>> {
    let user_id = path.into_inner();
    let authenticated = match authenticated_user_id(&request) {
        Ok(id) => id as u32,
        Err(response) => return Ok(response),
    };
    if authenticated != user_id {
        return Ok(unauthorized(
            "Recommendations are private.",
            "recommendations_private",
        ));
    }
    let current_song = query.get("song_id").cloned();
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return Ok(library_unavailable_response(readiness)),
    };

    let rec_ids = fetch_recommended_song_ids(user_id, current_song, cache.as_ref(), &pool).await?;

    let mut results = Vec::new();
    for sid in rec_ids.into_iter() {
        if let Ok(crate::api::song::SongInfo::Full(song)) =
            crate::api::song::fetch_song_info_from_cache(&sid, cache.as_ref(), Some(false))
        {
            results.push(song);
        }
    }

    Ok(HttpResponse::Ok().json(results))
}

#[get("/{user_id}/recommendation-ids")]
async fn get_recommended_ids(
    path: web::Path<u32>,
    query: web::Query<HashMap<String, String>>,
    lifecycle: web::Data<LibraryLifecycle>,
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> Result<impl Responder, Box<dyn Error>> {
    let authenticated = match authenticated_user_id(&request) {
        Ok(id) => id as u32,
        Err(response) => return Ok(response),
    };
    if authenticated != *path {
        return Ok(unauthorized(
            "Recommendations are private.",
            "recommendations_private",
        ));
    }
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return Ok(library_unavailable_response(readiness)),
    };
    let ids = fetch_recommended_song_ids(
        authenticated,
        query.get("song_id").cloned(),
        cache.as_ref(),
        &pool,
    )
    .await?;
    Ok(HttpResponse::Ok().json(ids))
}

pub async fn fetch_recommended_song_ids(
    user_id_u32: u32,
    current_song_id: Option<String>,
    cache: &LibraryCache,
    pool: &DbPool,
) -> Result<Vec<String>, Box<dyn Error>> {
    Ok(crate::recommendation::recommend(
        user_id_u32 as i32,
        current_song_id.as_deref(),
        cache,
        pool,
        50,
    )?
    .into_iter()
    .map(|candidate| candidate.song_id)
    .collect())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/users")
            .service(get_users)
            .service(change_password)
            .service(get_listen_history_songs)
            .service(get_listen_history)
            .service(add_song_to_listen_history)
            .service(get_favorite_song_details)
            .service(get_favorite_songs)
            .service(favorite_song_membership)
            .service(add_favorite_song)
            .service(remove_favorite_song)
            .service(add_playback_event)
            .service(set_bitrate)
            .service(get_now_playing)
            .service(set_now_playing)
            .service(get_user_info)
            .service(get_user_info_by_id)
            .service(get_profile_picture)
            .service(upload_profile_picture)
            .service(get_recommended_ids)
            .service(get_recommended_full),
    );
}

#[cfg(test)]
mod tests {
    use actix_web::{App, HttpMessage, http::StatusCode, test as actix_test, web};
    use diesel::connection::SimpleConnection;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel::sqlite::SqliteConnection;
    use serde_json::Value;

    use super::{
        add_favorite_song, favorite_song_membership, get_favorite_songs, remove_favorite_song,
    };
    use crate::api::auth::Claims;

    fn favorite_pool() -> web::Data<crate::persistence::connection::DbPool> {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("favorite test pool");
        pool.get()
            .expect("favorite test connection")
            .batch_execute(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE user (id INTEGER PRIMARY KEY);
                 CREATE TABLE song (id TEXT PRIMARY KEY);
                 CREATE TABLE favorite_song (
                    user_id INTEGER NOT NULL,
                    song_id TEXT NOT NULL,
                    added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, song_id),
                    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
                    FOREIGN KEY (song_id) REFERENCES song(id) ON DELETE CASCADE
                 );
                 INSERT INTO user (id) VALUES (7);
                 INSERT INTO song (id) VALUES ('song-one');",
            )
            .expect("favorite schema fixture");
        web::Data::new(std::sync::Arc::new(pool))
    }

    macro_rules! authenticated_request {
        ($method:ident, $uri:expr) => {{
            let request = actix_test::TestRequest::$method().uri($uri).to_request();
            request.extensions_mut().insert(Claims {
                sub: "7".to_string(),
                exp: usize::MAX,
                username: "listener".to_string(),
                bitrate: 0,
                token_type: "access".to_string(),
                role: "user".to_string(),
                token_version: 0,
            });
            request
        }};
    }

    #[actix_web::test]
    async fn favorite_song_endpoints_are_idempotent_and_private_to_the_user() {
        let app = actix_test::init_service(
            App::new()
                .app_data(favorite_pool())
                .service(get_favorite_songs)
                .service(favorite_song_membership)
                .service(add_favorite_song)
                .service(remove_favorite_song),
        )
        .await;

        let missing =
            actix_test::call_service(&app, authenticated_request!(post, "/me/favorites/missing"))
                .await;
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);

        let created =
            actix_test::call_service(&app, authenticated_request!(post, "/me/favorites/song-one"))
                .await;
        assert_eq!(created.status(), StatusCode::CREATED);

        let duplicate =
            actix_test::call_service(&app, authenticated_request!(post, "/me/favorites/song-one"))
                .await;
        assert_eq!(duplicate.status(), StatusCode::OK);

        let membership =
            actix_test::call_service(&app, authenticated_request!(get, "/me/favorites/song-one"))
                .await;
        let membership: Value = actix_test::read_body_json(membership).await;
        assert_eq!(membership["liked"], true);

        let listed =
            actix_test::call_service(&app, authenticated_request!(get, "/me/favorites")).await;
        assert_eq!(listed.status(), StatusCode::OK);
        let body: Vec<Value> = actix_test::read_body_json(listed).await;
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["song_id"], "song-one");

        let removed = actix_test::call_service(
            &app,
            authenticated_request!(delete, "/me/favorites/song-one"),
        )
        .await;
        assert_eq!(removed.status(), StatusCode::NO_CONTENT);

        let membership =
            actix_test::call_service(&app, authenticated_request!(get, "/me/favorites/song-one"))
                .await;
        let membership: Value = actix_test::read_body_json(membership).await;
        assert_eq!(membership["liked"], false);

        let empty =
            actix_test::call_service(&app, authenticated_request!(get, "/me/favorites")).await;
        let body: Vec<Value> = actix_test::read_body_json(empty).await;
        assert!(body.is_empty());
    }
}
