use std::error::Error;
use std::io::Write;
use std::sync::{Arc, OnceLock};

use actix_multipart::Multipart;
use actix_web::{
    HttpMessage, HttpRequest, HttpResponse, Responder, delete, get, patch, post, put, web,
};
use bytes::BytesMut;
use diesel::deserialize::QueryableByName;
use diesel::{
    BoolExpressionMethods, Connection, ExpressionMethods, OptionalExtension, QueryDsl, RunQueryDsl,
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};

use crate::api::auth::{
    Claims, authenticated_user_id, hash_password, renewed_access_session_response, valid_password,
    valid_username, verify_password,
};
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

#[derive(Deserialize)]
struct ChangeUsernameRequest {
    current_password: String,
    username: String,
}

#[derive(Debug)]
enum ChangeUsernameError {
    Database(diesel::result::Error),
    Duplicate,
    IncorrectPassword,
    NotFound,
}

struct RenewedUserIdentity {
    bitrate: i32,
    role: String,
    token_version: i32,
    username: String,
}

fn change_username_row(
    connection: &mut diesel::SqliteConnection,
    user_id: i32,
    requested_username: &str,
    current_password: &str,
) -> Result<RenewedUserIdentity, ChangeUsernameError> {
    use crate::persistence::schema::user::dsl::{
        bitrate, id, password, role, token_version, user, username,
    };

    let stored = user
        .filter(id.eq(user_id))
        .select((password, username, bitrate, role, token_version))
        .first::<(String, String, i32, String, i32)>(connection)
        .optional()
        .map_err(ChangeUsernameError::Database)?
        .ok_or(ChangeUsernameError::NotFound)?;
    if !verify_password(current_password, &stored.0) {
        return Err(ChangeUsernameError::IncorrectPassword);
    }

    if stored.1 != requested_username {
        match diesel::update(user.filter(id.eq(user_id)))
            .set(username.eq(requested_username))
            .execute(connection)
        {
            Ok(1) => {}
            Ok(_) => return Err(ChangeUsernameError::NotFound),
            Err(diesel::result::Error::DatabaseError(
                diesel::result::DatabaseErrorKind::UniqueViolation,
                _,
            )) => return Err(ChangeUsernameError::Duplicate),
            Err(error) => return Err(ChangeUsernameError::Database(error)),
        }
    }

    Ok(RenewedUserIdentity {
        username: requested_username.to_string(),
        bitrate: stored.2,
        role: stored.3,
        token_version: stored.4,
    })
}

#[derive(Debug)]
enum DeleteUserError {
    Database(diesel::result::Error),
    Storage(String),
    RequesterNotAdmin,
    TargetNotFound,
    CannotDeleteSelf,
    LastAdministrator,
}

impl From<diesel::result::Error> for DeleteUserError {
    fn from(error: diesel::result::Error) -> Self {
        Self::Database(error)
    }
}

fn delete_user_rows(
    connection: &mut diesel::SqliteConnection,
    requester_id: i32,
    target_id: i32,
) -> Result<(), DeleteUserError> {
    #[derive(QueryableByName)]
    struct RoleRow {
        #[diesel(sql_type = diesel::sql_types::Text)]
        role: String,
    }
    #[derive(QueryableByName)]
    struct CountRow {
        #[diesel(sql_type = diesel::sql_types::BigInt)]
        count: i64,
    }
    connection.immediate_transaction::<_, DeleteUserError, _>(|connection| {
        let requester = diesel::sql_query("SELECT role FROM user WHERE id = ?")
            .bind::<diesel::sql_types::Integer, _>(requester_id)
            .get_result::<RoleRow>(connection)
            .optional()?;
        if requester.as_ref().map(|user| user.role.as_str()) != Some("admin") {
            return Err(DeleteUserError::RequesterNotAdmin);
        }
        if requester_id == target_id {
            return Err(DeleteUserError::CannotDeleteSelf);
        }
        let target = diesel::sql_query("SELECT role FROM user WHERE id = ?")
            .bind::<diesel::sql_types::Integer, _>(target_id)
            .get_result::<RoleRow>(connection)
            .optional()?
            .ok_or(DeleteUserError::TargetNotFound)?;
        if target.role == "admin" {
            let administrators = diesel::sql_query(
                "SELECT CAST(COUNT(*) AS BIGINT) AS count FROM user WHERE role = 'admin'",
            )
            .get_result::<CountRow>(connection)?
            .count;
            if administrators <= 1 {
                return Err(DeleteUserError::LastAdministrator);
            }
        }

        diesel::sql_query(
            "DELETE FROM playlist
             WHERE id IN (
               SELECT a FROM _playlist_to_user
               WHERE b = ? AND role = 'owner'
             )",
        )
        .bind::<diesel::sql_types::Integer, _>(target_id)
        .execute(connection)?;
        diesel::sql_query("DELETE FROM search_item WHERE user_id = ?")
            .bind::<diesel::sql_types::Integer, _>(target_id)
            .execute(connection)?;
        diesel::sql_query("DELETE FROM listen_history_item WHERE user_id = ?")
            .bind::<diesel::sql_types::Integer, _>(target_id)
            .execute(connection)?;
        diesel::sql_query("DELETE FROM follow WHERE follower_id = ? OR following_id = ?")
            .bind::<diesel::sql_types::Integer, _>(target_id)
            .bind::<diesel::sql_types::Integer, _>(target_id)
            .execute(connection)?;
        diesel::sql_query("DELETE FROM user WHERE id = ?")
            .bind::<diesel::sql_types::Integer, _>(target_id)
            .execute(connection)?;
        Ok(())
    })
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

#[delete("/{target_user_id}")]
async fn delete_user(
    path: web::Path<i32>,
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> HttpResponse {
    let requester_id = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let target_id = path.into_inner();
    let delete_pool = pool.get_ref().clone();
    let result = web::block(move || -> Result<(), DeleteUserError> {
        let mut connection = delete_pool
            .get()
            .map_err(|error| DeleteUserError::Storage(error.to_string()))?;
        // Validate before the relatively expensive safety backup. The same
        // invariants are checked again inside the delete transaction.
        #[derive(QueryableByName)]
        struct Roles {
            #[diesel(sql_type = diesel::sql_types::Integer)]
            id: i32,
            #[diesel(sql_type = diesel::sql_types::Text)]
            role: String,
        }
        let roles = diesel::sql_query("SELECT id, role FROM user WHERE id IN (?, ?)")
            .bind::<diesel::sql_types::Integer, _>(requester_id)
            .bind::<diesel::sql_types::Integer, _>(target_id)
            .load::<Roles>(&mut connection)?;
        if !roles
            .iter()
            .any(|user| user.id == requester_id && user.role == "admin")
        {
            return Err(DeleteUserError::RequesterNotAdmin);
        }
        if requester_id == target_id {
            return Err(DeleteUserError::CannotDeleteSelf);
        }
        if !roles.iter().any(|user| user.id == target_id) {
            return Err(DeleteUserError::TargetNotFound);
        }
        drop(connection);
        crate::api::data::create_safety_backup(&delete_pool).map_err(DeleteUserError::Storage)?;
        let mut connection = delete_pool
            .get()
            .map_err(|error| DeleteUserError::Storage(error.to_string()))?;
        delete_user_rows(&mut connection, requester_id, target_id)
    })
    .await;

    match result {
        Ok(Ok(())) => {
            crate::api::auth::invalidate_image_session(target_id).await;
            let avatar = get_profile_picture_path().join(format!("{target_id}.jpg"));
            if let Err(error) = tokio::fs::remove_file(avatar).await
                && error.kind() != std::io::ErrorKind::NotFound
            {
                tracing::warn!(%error, target_id, "could not remove deleted user avatar");
            }
            HttpResponse::NoContent().finish()
        }
        Ok(Err(DeleteUserError::RequesterNotAdmin)) => {
            crate::api::error::forbidden("Administrator access is required.", "admin_required")
        }
        Ok(Err(DeleteUserError::TargetNotFound)) => not_found("User not found.", "user_not_found"),
        Ok(Err(DeleteUserError::CannotDeleteSelf)) => bad_request(
            "You cannot delete the account you are currently using.",
            "cannot_delete_current_user",
        ),
        Ok(Err(DeleteUserError::LastAdministrator)) => bad_request(
            "Parson must keep at least one administrator.",
            "last_administrator_required",
        ),
        Ok(Err(DeleteUserError::Database(error))) => {
            tracing::error!(%error, target_id, "user deletion failed");
            internal_server_error("Could not delete the user.", "user_delete_failed")
        }
        Ok(Err(DeleteUserError::Storage(error))) => {
            tracing::error!(%error, target_id, "user deletion safety backup failed");
            internal_server_error(
                "Could not create a safety backup, so the user was not deleted.",
                "user_delete_backup_failed",
            )
        }
        Err(error) => {
            tracing::error!(%error, target_id, "user deletion worker failed");
            internal_server_error("Could not delete the user.", "user_delete_failed")
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
            "Passwords must contain between 8 and 256 characters.",
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
        connection
            .immediate_transaction::<_, diesel::result::Error, _>(|connection| {
                diesel::update(user.filter(id.eq(user_id)))
                    .set((password.eq(hashed), token_version.eq(token_version + 1)))
                    .execute(connection)?;
                diesel::sql_query("DELETE FROM refresh_session WHERE user_id = ?")
                    .bind::<diesel::sql_types::Integer, _>(user_id)
                    .execute(connection)?;
                Ok(())
            })
            .map_err(|error| error.to_string())?;
        Ok(Ok(()))
    })
    .await;

    match result {
        Ok(Ok(Ok(()))) => {
            crate::api::auth::invalidate_image_session(user_id).await;
            Ok(HttpResponse::Ok().body("Password changed"))
        }
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

#[patch("/me/username")]
async fn change_username(
    form: web::Json<ChangeUsernameRequest>,
    pool: web::Data<DbPool>,
    request: HttpRequest,
) -> HttpResponse {
    let user_id = match authenticated_user_id(&request) {
        Ok(authenticated_id) => authenticated_id,
        Err(response) => return response,
    };
    if !valid_username(&form.username) {
        return bad_request(
            "Usernames must contain between 1 and 64 characters, with no surrounding whitespace or control characters.",
            "invalid_username",
        );
    }
    if !valid_password(&form.current_password) {
        return unauthorized(
            "Current password is incorrect.",
            "current_password_incorrect",
        );
    }
    let session_id = request
        .extensions()
        .get::<Claims>()
        .and_then(|claims| claims.session_id.clone());
    let username_pool = pool.get_ref().clone();
    let requested_username = form.username.clone();
    let current_password = form.current_password.clone();
    let result = web::block(move || {
        let mut connection = username_pool.get().map_err(|error| {
            ChangeUsernameError::Database(diesel::result::Error::QueryBuilderError(Box::new(error)))
        })?;
        change_username_row(
            &mut connection,
            user_id,
            &requested_username,
            &current_password,
        )
    })
    .await;

    match result {
        Ok(Ok(identity)) => match renewed_access_session_response(
            &request,
            user_id,
            &identity.username,
            identity.bitrate,
            &identity.role,
            identity.token_version,
            session_id.as_deref(),
        ) {
            Ok(response) => response,
            Err(error) => {
                tracing::error!(%error, user_id, "username access-token renewal failed");
                internal_server_error(
                    "The username changed, but the session could not be renewed. Sign in again.",
                    "username_session_renewal_failed",
                )
            }
        },
        Ok(Err(ChangeUsernameError::Duplicate)) => crate::api::error::conflict(
            "That username is already in use.",
            "username_already_exists",
        ),
        Ok(Err(ChangeUsernameError::IncorrectPassword)) => unauthorized(
            "Current password is incorrect.",
            "current_password_incorrect",
        ),
        Ok(Err(ChangeUsernameError::NotFound)) => not_found("User not found.", "user_not_found"),
        Ok(Err(ChangeUsernameError::Database(error))) => {
            tracing::error!(%error, user_id, "username update failed");
            internal_server_error("Could not update the username.", "username_update_failed")
        }
        Err(error) => {
            tracing::error!(%error, user_id, "username update worker failed");
            internal_server_error("Could not update the username.", "username_update_failed")
        }
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

    let rec_ids =
        fetch_recommended_song_ids(user_id, current_song, cache.clone(), pool.get_ref().clone())
            .await?;

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
        cache,
        pool.get_ref().clone(),
    )
    .await?;
    Ok(HttpResponse::Ok().json(ids))
}

pub async fn fetch_recommended_song_ids(
    user_id_u32: u32,
    current_song_id: Option<String>,
    cache: Arc<LibraryCache>,
    pool: DbPool,
) -> Result<Vec<String>, Box<dyn Error>> {
    tokio::task::spawn_blocking(move || {
        crate::recommendation::recommend(
            user_id_u32 as i32,
            current_song_id.as_deref(),
            cache.as_ref(),
            &pool,
            50,
        )
        .map(|ranked| {
            ranked
                .into_iter()
                .map(|candidate| candidate.song_id)
                .collect()
        })
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| -> Box<dyn Error> { Box::new(error) })?
    .map_err(|error| -> Box<dyn Error> { error.into() })
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/users")
            .service(get_users)
            .service(delete_user)
            .service(change_password)
            .service(change_username)
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
    use diesel::RunQueryDsl;
    use diesel::connection::SimpleConnection;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel::sqlite::SqliteConnection;
    use serde_json::Value;

    use super::{
        ChangeUsernameError, DeleteUserError, add_favorite_song, change_username,
        change_username_row, delete_user_rows, favorite_song_membership, get_favorite_songs,
        remove_favorite_song,
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

    fn username_pool() -> web::Data<crate::persistence::connection::DbPool> {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("username test pool");
        let password_hash = crate::api::auth::hash_password("synthetic-current-password")
            .expect("fixture password hash");
        let mut connection = pool.get().expect("username test connection");
        connection
            .batch_execute(
                "CREATE TABLE user (
                    id INTEGER PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    password TEXT NOT NULL,
                    bitrate INTEGER NOT NULL,
                    role TEXT NOT NULL,
                    token_version INTEGER NOT NULL
                 );
                 CREATE TABLE refresh_session (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    expires_at BIGINT NOT NULL
                 );",
            )
            .expect("username test schema");
        diesel::sql_query(
            "INSERT INTO user
                (id, username, password, bitrate, role, token_version)
             VALUES (7, 'old-handle', ?, 256, 'user', 3),
                    (8, 'reserved-handle', ?, 0, 'user', 0)",
        )
        .bind::<diesel::sql_types::Text, _>(&password_hash)
        .bind::<diesel::sql_types::Text, _>(&password_hash)
        .execute(&mut connection)
        .expect("username test users");
        drop(connection);
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
                session_id: None,
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

    #[actix_web::test]
    async fn username_endpoint_updates_claims_cookie_and_native_token() {
        let database = username_pool();
        let app = actix_test::init_service(
            App::new()
                .app_data(database.clone())
                .service(change_username)
                .service(crate::api::auth::login),
        )
        .await;
        let request = actix_test::TestRequest::patch()
            .uri("/me/username")
            .insert_header(("X-Parson-Client", "native"))
            .set_json(serde_json::json!({
                "current_password": "synthetic-current-password",
                "username": "new-handle"
            }))
            .to_request();
        request.extensions_mut().insert(Claims {
            sub: "7".to_string(),
            exp: usize::MAX,
            username: "old-handle".to_string(),
            bitrate: 256,
            token_type: "access".to_string(),
            role: "user".to_string(),
            token_version: 3,
            session_id: Some("synthetic-session".to_string()),
        });

        let response = actix_test::call_service(&app, request).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(
            response
                .headers()
                .get_all("set-cookie")
                .filter_map(|value| value.to_str().ok())
                .any(|value| value.starts_with("plm_accessToken="))
        );
        let body: Value = actix_test::read_body_json(response).await;
        assert_eq!(body["claims"]["username"], "new-handle");
        assert!(
            body["access_token"]
                .as_str()
                .is_some_and(|token| !token.is_empty())
        );

        #[derive(diesel::deserialize::QueryableByName)]
        struct UsernameRow {
            #[diesel(sql_type = diesel::sql_types::Text)]
            username: String,
        }
        let stored = diesel::sql_query("SELECT username FROM user WHERE id = 7")
            .get_result::<UsernameRow>(&mut database.get().expect("username lookup"))
            .expect("renamed user");
        assert_eq!(stored.username, "new-handle");

        let old_login = actix_test::TestRequest::post()
            .uri("/login")
            .set_json(serde_json::json!({
                "username": "old-handle",
                "password": "synthetic-current-password"
            }))
            .to_request();
        let old_login = actix_test::call_service(&app, old_login).await;
        assert_eq!(old_login.status(), StatusCode::UNAUTHORIZED);

        let new_login = actix_test::TestRequest::post()
            .uri("/login")
            .insert_header(("X-Parson-Client", "native"))
            .set_json(serde_json::json!({
                "username": "new-handle",
                "password": "synthetic-current-password"
            }))
            .to_request();
        let new_login = actix_test::call_service(&app, new_login).await;
        assert_eq!(new_login.status(), StatusCode::OK);
        let new_login: Value = actix_test::read_body_json(new_login).await;
        assert_eq!(new_login["claims"]["username"], "new-handle");
    }

    #[test]
    fn administrators_can_delete_another_user_and_owned_data() {
        use diesel::{Connection, RunQueryDsl};

        let mut connection = SqliteConnection::establish(":memory:").expect("user database");
        connection
            .batch_execute(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE user (id INTEGER PRIMARY KEY, role TEXT NOT NULL);
                 CREATE TABLE playlist (id TEXT PRIMARY KEY);
                 CREATE TABLE _playlist_to_user (
                    a TEXT NOT NULL, b INTEGER NOT NULL, role TEXT NOT NULL,
                    FOREIGN KEY (a) REFERENCES playlist(id) ON DELETE CASCADE,
                    FOREIGN KEY (b) REFERENCES user(id) ON DELETE CASCADE
                 );
                 CREATE TABLE search_item (
                    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE RESTRICT
                 );
                 CREATE TABLE listen_history_item (
                    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE RESTRICT
                 );
                 CREATE TABLE follow (
                    follower_id INTEGER NOT NULL, following_id INTEGER NOT NULL,
                    FOREIGN KEY (follower_id) REFERENCES user(id) ON DELETE RESTRICT,
                    FOREIGN KEY (following_id) REFERENCES user(id) ON DELETE RESTRICT
                 );
                 INSERT INTO user VALUES (1, 'admin'), (2, 'admin'), (3, 'user');
                 INSERT INTO playlist VALUES ('owned');
                 INSERT INTO _playlist_to_user VALUES ('owned', 3, 'owner');
                 INSERT INTO search_item VALUES (1, 3);
                 INSERT INTO listen_history_item VALUES (1, 3);
                 INSERT INTO follow VALUES (1, 3);",
            )
            .expect("user deletion fixture");

        delete_user_rows(&mut connection, 1, 3).expect("delete user");
        #[derive(diesel::deserialize::QueryableByName)]
        struct Count {
            #[diesel(sql_type = diesel::sql_types::BigInt)]
            count: i64,
        }
        let remaining = diesel::sql_query(
            "SELECT CAST(
                (SELECT COUNT(*) FROM user WHERE id = 3) +
                (SELECT COUNT(*) FROM playlist WHERE id = 'owned') +
                (SELECT COUNT(*) FROM search_item WHERE user_id = 3) +
                (SELECT COUNT(*) FROM listen_history_item WHERE user_id = 3) +
                (SELECT COUNT(*) FROM follow WHERE following_id = 3)
              AS BIGINT) AS count",
        )
        .get_result::<Count>(&mut connection)
        .expect("remaining owned data");
        assert_eq!(remaining.count, 0);
        assert!(matches!(
            delete_user_rows(&mut connection, 1, 1),
            Err(DeleteUserError::CannotDeleteSelf)
        ));
    }

    #[test]
    fn username_changes_preserve_identity_and_enforce_password_and_uniqueness() {
        use diesel::{Connection, RunQueryDsl};

        let mut connection = SqliteConnection::establish(":memory:").expect("user database");
        connection
            .batch_execute(
                "CREATE TABLE user (
                    id INTEGER PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    password TEXT NOT NULL,
                    bitrate INTEGER NOT NULL,
                    role TEXT NOT NULL,
                    token_version INTEGER NOT NULL
                 );",
            )
            .expect("username fixture schema");
        let password_hash = crate::api::auth::hash_password("synthetic-current-password")
            .expect("fixture password hash");
        diesel::sql_query(
            "INSERT INTO user
                (id, username, password, bitrate, role, token_version)
             VALUES (7, 'old-handle', ?, 256, 'user', 3),
                    (8, 'reserved-handle', ?, 0, 'user', 0)",
        )
        .bind::<diesel::sql_types::Text, _>(&password_hash)
        .bind::<diesel::sql_types::Text, _>(&password_hash)
        .execute(&mut connection)
        .expect("username fixture users");

        let changed = change_username_row(
            &mut connection,
            7,
            "new-handle",
            "synthetic-current-password",
        )
        .expect("change username");
        assert_eq!(changed.username, "new-handle");
        assert_eq!(changed.bitrate, 256);
        assert_eq!(changed.role, "user");
        assert_eq!(changed.token_version, 3);

        #[derive(diesel::deserialize::QueryableByName)]
        struct StoredUser {
            #[diesel(sql_type = diesel::sql_types::Integer)]
            id: i32,
            #[diesel(sql_type = diesel::sql_types::Text)]
            username: String,
        }
        let stored = diesel::sql_query("SELECT id, username FROM user WHERE id = 7")
            .get_result::<StoredUser>(&mut connection)
            .expect("updated user");
        assert_eq!(stored.id, 7);
        assert_eq!(stored.username, "new-handle");

        assert!(matches!(
            change_username_row(
                &mut connection,
                7,
                "another-handle",
                "incorrect-synthetic-password"
            ),
            Err(ChangeUsernameError::IncorrectPassword)
        ));
        assert!(matches!(
            change_username_row(
                &mut connection,
                7,
                "reserved-handle",
                "synthetic-current-password"
            ),
            Err(ChangeUsernameError::Duplicate)
        ));
    }
}
