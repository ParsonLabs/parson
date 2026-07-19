use actix_web::{HttpRequest, HttpResponse, delete, get, patch, post, web};
use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Double, Integer, Text};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::api::error::{internal_server_error, not_found};
use crate::api::song::{ResponseSong, SongInfo, fetch_song_info};
use crate::library::state::{LibraryCache, LibraryLifecycle, library_unavailable_response};
use crate::persistence::connection::DbPool;
use crate::persistence::models::{NewPlaylist, Playlist};
use crate::playlist_rules::{
    MAX_COVER_IMAGE_CHARACTERS, MAX_PLAYLIST_DESCRIPTION_CHARACTERS, MAX_PLAYLIST_NAME_CHARACTERS,
    MAX_PLAYLISTS as MAX_PLAYLISTS_PER_USER, MAX_TRACKS_PER_PLAYLIST, valid_optional_text,
    valid_song_id,
};

const MAX_BATCH_TRACK_IDS: usize = 500;

fn is_owner(
    connection: &mut diesel::sqlite::SqliteConnection,
    playlist_id: i32,
    user_id: i32,
) -> Result<bool, diesel::result::Error> {
    use crate::persistence::schema::_playlist_to_user::dsl as owners;
    owners::_playlist_to_user
        .filter(owners::a.eq(playlist_id))
        .filter(owners::b.eq(user_id))
        .select(owners::a)
        .first::<i32>(connection)
        .optional()
        .map(|owner| owner.is_some())
}

#[derive(Deserialize)]
struct CreatePlaylist {
    name: String,
    #[serde(default)]
    song_ids: Vec<String>,
    album_id: Option<String>,
}

#[derive(Deserialize, AsChangeset)]
#[diesel(table_name = crate::persistence::schema::playlist)]
struct UpdatePlaylist {
    name: Option<String>,
    description: Option<String>,
    cover_image: Option<String>,
    is_public: Option<bool>,
}

#[derive(Deserialize)]
struct AddTrack {
    song_id: String,
}

#[derive(Deserialize)]
struct AddTracks {
    song_ids: Vec<String>,
}

#[derive(Debug, PartialEq)]
enum AddTrackResult {
    Added,
    PlaylistMissing,
    SongMissing,
    CapacityReached,
}

fn add_track_transactionally(
    connection: &mut diesel::sqlite::SqliteConnection,
    playlist_id: i32,
    owner_id: i32,
    song_id: &str,
) -> Result<AddTrackResult, diesel::result::Error> {
    use crate::persistence::schema::_playlist_to_song::dsl as tracks;
    use crate::persistence::schema::playlist::dsl as playlists;
    use crate::persistence::schema::song::dsl as songs;

    connection.transaction(|connection| {
        if !is_owner(connection, playlist_id, owner_id)? {
            return Ok(AddTrackResult::PlaylistMissing);
        }
        let song_exists = songs::song
            .filter(songs::id.eq(song_id))
            .select(songs::id)
            .first::<String>(connection)
            .optional()?
            .is_some();
        if !song_exists {
            return Ok(AddTrackResult::SongMissing);
        }
        let already_added = tracks::_playlist_to_song
            .filter(tracks::a.eq(playlist_id))
            .filter(tracks::b.eq(song_id))
            .select(tracks::rowid)
            .first::<i32>(connection)
            .optional()?
            .is_some();
        if already_added {
            return Ok(AddTrackResult::Added);
        }
        let track_count = tracks::_playlist_to_song
            .filter(tracks::a.eq(playlist_id))
            .count()
            .get_result::<i64>(connection)?;
        if track_count >= MAX_TRACKS_PER_PLAYLIST {
            return Ok(AddTrackResult::CapacityReached);
        }
        let inserted = diesel::insert_or_ignore_into(tracks::_playlist_to_song)
            .values((tracks::a.eq(playlist_id), tracks::b.eq(song_id)))
            .execute(connection)?;
        if inserted > 0 {
            diesel::update(playlists::playlist.find(playlist_id))
                .set(playlists::updated_at.eq(diesel::dsl::now))
                .execute(connection)?;
        }
        Ok(AddTrackResult::Added)
    })
}

fn add_tracks_transactionally(
    connection: &mut diesel::sqlite::SqliteConnection,
    playlist_id: i32,
    owner_id: i32,
    song_ids: &[String],
) -> Result<AddTrackResult, diesel::result::Error> {
    use crate::persistence::schema::_playlist_to_song::dsl as tracks;
    use crate::persistence::schema::playlist::dsl as playlists;
    use crate::persistence::schema::song::dsl as songs;

    connection.transaction(|connection| {
        if !is_owner(connection, playlist_id, owner_id)? {
            return Ok(AddTrackResult::PlaylistMissing);
        }

        let mut seen = HashSet::new();
        let unique_ids = song_ids
            .iter()
            .filter(|id| seen.insert((*id).clone()))
            .cloned()
            .collect::<Vec<_>>();
        let existing_songs = songs::song
            .filter(songs::id.eq_any(unique_ids.clone()))
            .select(songs::id)
            .load::<String>(connection)?
            .into_iter()
            .collect::<HashSet<_>>();
        if existing_songs.len() != unique_ids.len() {
            return Ok(AddTrackResult::SongMissing);
        }

        let already_added = tracks::_playlist_to_song
            .filter(tracks::a.eq(playlist_id))
            .filter(tracks::b.eq_any(unique_ids.clone()))
            .select(tracks::b)
            .load::<String>(connection)?
            .into_iter()
            .collect::<HashSet<_>>();
        let new_ids = unique_ids
            .into_iter()
            .filter(|id| !already_added.contains(id))
            .collect::<Vec<_>>();
        let track_count = tracks::_playlist_to_song
            .filter(tracks::a.eq(playlist_id))
            .count()
            .get_result::<i64>(connection)?;
        if track_count + new_ids.len() as i64 > MAX_TRACKS_PER_PLAYLIST {
            return Ok(AddTrackResult::CapacityReached);
        }

        for song_id in &new_ids {
            diesel::insert_into(tracks::_playlist_to_song)
                .values((tracks::a.eq(playlist_id), tracks::b.eq(song_id)))
                .execute(connection)?;
        }
        if !new_ids.is_empty() {
            diesel::update(playlists::playlist.find(playlist_id))
                .set(playlists::updated_at.eq(diesel::dsl::now))
                .execute(connection)?;
        }
        Ok(AddTrackResult::Added)
    })
}

enum CreatePlaylistResult {
    Created(Playlist, Vec<String>),
    CapacityReached,
}

#[derive(Serialize)]
struct PlaylistTrack {
    song_id: String,
    date_added: NaiveDateTime,
}

#[derive(QueryableByName)]
struct PlaylistAggregateRow {
    #[diesel(sql_type = Integer)]
    playlist_id: i32,
    #[diesel(sql_type = BigInt)]
    song_count: i64,
    #[diesel(sql_type = Double)]
    total_duration: f64,
}

#[derive(QueryableByName)]
struct PlaylistCoverTrackRow {
    #[diesel(sql_type = Integer)]
    playlist_id: i32,
    #[diesel(sql_type = Text)]
    song_id: String,
}

type PlaylistListRows = (
    Vec<Playlist>,
    Vec<PlaylistAggregateRow>,
    Vec<PlaylistCoverTrackRow>,
);

fn playlist_list_rows(
    connection: &mut diesel::sqlite::SqliteConnection,
    owner_id: i32,
) -> Result<PlaylistListRows, diesel::result::Error> {
    use crate::persistence::schema::_playlist_to_user::dsl as owners;
    use crate::persistence::schema::playlist::dsl as playlists;

    let items = owners::_playlist_to_user
        .inner_join(playlists::playlist)
        .filter(owners::b.eq(owner_id))
        .select(Playlist::as_select())
        .order(playlists::updated_at.desc())
        .limit(MAX_PLAYLISTS_PER_USER)
        .load(connection)?;
    let aggregates = diesel::sql_query(
        "SELECT stats.playlist_id, stats.song_count, stats.total_duration \
         FROM playlist_stats stats \
         INNER JOIN _playlist_to_user owners \
           ON owners.a = stats.playlist_id AND owners.b = ?",
    )
    .bind::<Integer, _>(owner_id)
    .load::<PlaylistAggregateRow>(connection)?;
    let cover_tracks = diesel::sql_query(
        "WITH requested AS ( \
           SELECT playlists.id \
           FROM _playlist_to_user owners \
           INNER JOIN playlist playlists ON playlists.id = owners.a \
           WHERE owners.b = ? \
           ORDER BY playlists.updated_at DESC, playlists.id DESC LIMIT ? \
         ), covers AS ( \
           SELECT id AS playlist_id, 0 AS ordinal, \
             (SELECT b FROM _playlist_to_song WHERE a = requested.id ORDER BY position, rowid LIMIT 1 OFFSET 0) AS song_id FROM requested \
           UNION ALL SELECT id, 1, \
             (SELECT b FROM _playlist_to_song WHERE a = requested.id ORDER BY position, rowid LIMIT 1 OFFSET 1) FROM requested \
           UNION ALL SELECT id, 2, \
             (SELECT b FROM _playlist_to_song WHERE a = requested.id ORDER BY position, rowid LIMIT 1 OFFSET 2) FROM requested \
           UNION ALL SELECT id, 3, \
             (SELECT b FROM _playlist_to_song WHERE a = requested.id ORDER BY position, rowid LIMIT 1 OFFSET 3) FROM requested \
         ) \
         SELECT playlist_id, song_id FROM covers \
         WHERE song_id IS NOT NULL ORDER BY playlist_id, ordinal",
    )
    .bind::<Integer, _>(owner_id)
    .bind::<BigInt, _>(MAX_PLAYLISTS_PER_USER)
    .load::<PlaylistCoverTrackRow>(connection)?;

    Ok((items, aggregates, cover_tracks))
}

#[derive(Serialize)]
struct PlaylistSummary {
    #[serde(flatten)]
    playlist: Playlist,
    song_count: i64,
    total_duration: f64,
    cover_songs: Vec<ResponseSong>,
}

fn full_song(song_id: &str, cache: &LibraryCache) -> Option<ResponseSong> {
    match fetch_song_info(song_id, Some(false), cache).ok()? {
        SongInfo::Full(song) => Some(song),
        SongInfo::Bare(_) => None,
    }
}

#[derive(Serialize)]
struct PlaylistDetail {
    #[serde(flatten)]
    summary: PlaylistSummary,
    song_infos: Vec<PlaylistTrack>,
    songs: Vec<ResponseSong>,
    user_ids: Vec<i32>,
}

#[get("")]
async fn list(
    request: HttpRequest,
    pool: web::Data<DbPool>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let owner_id = match crate::api::auth::authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let list_pool = pool.get_ref().clone();
    match web::block(move || -> Result<_, String> {
        let mut connection = list_pool.get().map_err(|error| error.to_string())?;
        playlist_list_rows(&mut connection, owner_id).map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok((items, aggregates, cover_tracks))) => {
            let aggregate_by_id: HashMap<_, _> = aggregates
                .into_iter()
                .map(|row| (row.playlist_id, (row.song_count, row.total_duration)))
                .collect();
            let mut covers_by_id: HashMap<i32, Vec<ResponseSong>> = HashMap::new();
            for row in cover_tracks {
                if let Some(song) = full_song(&row.song_id, cache.as_ref()) {
                    covers_by_id.entry(row.playlist_id).or_default().push(song);
                }
            }
            let summaries: Vec<_> = items
                .into_iter()
                .map(|playlist| {
                    let id = playlist.id;
                    let (song_count, total_duration) =
                        aggregate_by_id.get(&id).copied().unwrap_or((0, 0.0));
                    PlaylistSummary {
                        playlist,
                        song_count,
                        total_duration,
                        cover_songs: covers_by_id.remove(&id).unwrap_or_default(),
                    }
                })
                .collect();
            HttpResponse::Ok().json(summaries)
        }
        Ok(Err(error)) => {
            tracing::error!(%error, "could not list playlists");
            internal_server_error("Could not list playlists.", "playlist_list_failed")
        }
        Err(error) => {
            tracing::error!(%error, "playlist list worker failed");
            internal_server_error("Could not list playlists.", "playlist_list_failed")
        }
    }
}

#[post("")]
async fn create(
    request: HttpRequest,
    body: web::Json<CreatePlaylist>,
    pool: web::Data<DbPool>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    use crate::persistence::schema::_playlist_to_song::dsl as tracks;
    use crate::persistence::schema::_playlist_to_user::dsl as owners;
    use crate::persistence::schema::playlist::dsl as playlists;

    let owner_id = match crate::api::auth::authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let name = body.name.trim();
    if !valid_optional_text(Some(name), MAX_PLAYLIST_NAME_CHARACTERS, false) {
        return crate::api::error::bad_request(
            "Playlist name must contain 1 to 200 characters.",
            "playlist_name_invalid",
        );
    }
    if body
        .album_id
        .as_deref()
        .is_some_and(|album_id| !valid_song_id(album_id))
    {
        return crate::api::error::bad_request(
            "Initial playlist album identifier is invalid.",
            "playlist_initial_album_invalid",
        );
    }
    let cache = if body.song_ids.is_empty() && body.album_id.is_none() {
        None
    } else {
        match lifecycle.cache().await {
            Ok(cache) => Some(cache),
            Err(readiness) => return library_unavailable_response(readiness),
        }
    };
    let mut requested_song_ids = body.song_ids.clone();
    if let Some(album_id) = body.album_id.as_deref() {
        let Some(album) = cache.as_deref().and_then(|cache| cache.album(album_id)) else {
            return not_found("Album not found.", "album_not_found");
        };
        requested_song_ids.extend(album.songs.iter().map(|song| song.id.clone()));
    }
    let mut seen = HashSet::new();
    let initial_song_ids = requested_song_ids
        .iter()
        .filter(|id| seen.insert((*id).clone()))
        .cloned()
        .collect::<Vec<_>>();
    if initial_song_ids.len() > MAX_BATCH_TRACK_IDS
        || initial_song_ids.iter().any(|id| !valid_song_id(id))
    {
        return crate::api::error::bad_request(
            "Initial playlist tracks are invalid or exceed the batch limit.",
            "playlist_initial_tracks_invalid",
        );
    }
    if initial_song_ids.iter().any(|id| {
        cache
            .as_deref()
            .is_none_or(|cache| cache.song(id).is_none())
    }) {
        return not_found("One or more songs were not found.", "song_not_found");
    }
    let create_pool = pool.get_ref().clone();
    let name = name.to_string();
    let songs_to_insert = initial_song_ids.clone();
    let result = web::block(move || -> Result<CreatePlaylistResult, String> {
        let mut connection = create_pool.get().map_err(|error| error.to_string())?;
        connection
            .transaction(|connection| {
                let playlist_count = owners::_playlist_to_user
                    .filter(owners::b.eq(owner_id))
                    .count()
                    .get_result::<i64>(connection)?;
                if playlist_count >= MAX_PLAYLISTS_PER_USER {
                    return Ok(CreatePlaylistResult::CapacityReached);
                }
                diesel::insert_into(playlists::playlist)
                    .values(NewPlaylist { name })
                    .execute(connection)?;
                let playlist = playlists::playlist
                    .order(playlists::id.desc())
                    .select(Playlist::as_select())
                    .first(connection)?;
                diesel::insert_into(owners::_playlist_to_user)
                    .values((owners::a.eq(playlist.id), owners::b.eq(owner_id)))
                    .execute(connection)?;
                for song_id in &songs_to_insert {
                    diesel::insert_into(tracks::_playlist_to_song)
                        .values((tracks::a.eq(playlist.id), tracks::b.eq(song_id)))
                        .execute(connection)?;
                }
                Ok::<_, diesel::result::Error>(CreatePlaylistResult::Created(
                    playlist,
                    songs_to_insert,
                ))
            })
            .map_err(|error| error.to_string())
    })
    .await;
    match result {
        Ok(Ok(CreatePlaylistResult::Created(playlist, song_ids))) => {
            let songs = cache
                .as_deref()
                .map(|cache| {
                    song_ids
                        .iter()
                        .filter_map(|id| full_song(id, cache))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            HttpResponse::Created().json(PlaylistSummary {
                playlist,
                song_count: songs.len() as i64,
                total_duration: songs.iter().map(|song| song.duration).sum(),
                cover_songs: songs.into_iter().take(4).collect(),
            })
        }
        Ok(Ok(CreatePlaylistResult::CapacityReached)) => {
            crate::api::error::conflict("Playlist capacity reached.", "playlist_capacity_reached")
        }
        Ok(Err(error)) => {
            tracing::error!(%error, "could not create playlist");
            internal_server_error("Could not create playlist.", "playlist_create_failed")
        }
        Err(error) => {
            tracing::error!(%error, "playlist create worker failed");
            internal_server_error("Could not create playlist.", "playlist_create_failed")
        }
    }
}

#[get("/{id}")]
async fn detail(
    request: HttpRequest,
    id: web::Path<i32>,
    pool: web::Data<DbPool>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    use crate::persistence::schema::_playlist_to_song::dsl as tracks;
    use crate::persistence::schema::_playlist_to_user::dsl as owners;
    use crate::persistence::schema::playlist::dsl as playlists;

    let id = id.into_inner();
    let owner_id = match crate::api::auth::authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let detail_pool = pool.get_ref().clone();
    match web::block(move || -> Result<Option<_>, String> {
        let mut connection = detail_pool.get().map_err(|error| error.to_string())?;
        if !is_owner(&mut connection, id, owner_id).map_err(|error| error.to_string())? {
            return Ok(None);
        }
        let Some(playlist) = playlists::playlist
            .filter(playlists::id.eq(id))
            .select(Playlist::as_select())
            .first(&mut connection)
            .optional()
            .map_err(|error| error.to_string())?
        else {
            return Ok(None);
        };
        let song_infos = tracks::_playlist_to_song
            .filter(tracks::a.eq(id))
            .order(tracks::position.asc())
            .then_order_by(tracks::rowid.asc())
            .select((tracks::b, tracks::date_added))
            .limit(MAX_TRACKS_PER_PLAYLIST)
            .load::<(String, NaiveDateTime)>(&mut connection)
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|(song_id, date_added)| PlaylistTrack {
                song_id,
                date_added,
            })
            .collect::<Vec<_>>();
        let user_ids = owners::_playlist_to_user
            .filter(owners::a.eq(id))
            .select(owners::b)
            .limit(MAX_PLAYLISTS_PER_USER)
            .load(&mut connection)
            .map_err(|error| error.to_string())?;
        Ok(Some((playlist, song_infos, user_ids)))
    })
    .await
    {
        Ok(Ok(Some((playlist, song_infos, user_ids)))) => {
            let songs: Vec<_> = song_infos
                .iter()
                .filter_map(|track| full_song(&track.song_id, cache.as_ref()))
                .collect();
            let total_duration = songs.iter().map(|song| song.duration).sum();
            let cover_songs = songs.iter().take(4).cloned().collect();
            HttpResponse::Ok().json(PlaylistDetail {
                summary: PlaylistSummary {
                    playlist,
                    song_count: songs.len() as i64,
                    total_duration,
                    cover_songs,
                },
                song_infos,
                songs,
                user_ids,
            })
        }
        Ok(Ok(None)) => not_found("Playlist not found.", "playlist_not_found"),
        Ok(Err(error)) => {
            tracing::error!(%error, "playlist detail lookup failed");
            internal_server_error("Could not load playlist.", "playlist_load_failed")
        }
        Err(error) => {
            tracing::error!(%error, "playlist detail worker failed");
            internal_server_error("Could not load playlist.", "playlist_load_failed")
        }
    }
}

#[patch("/{id}")]
async fn update(
    request: HttpRequest,
    id: web::Path<i32>,
    body: web::Json<UpdatePlaylist>,
    pool: web::Data<DbPool>,
) -> HttpResponse {
    use crate::persistence::schema::playlist::dsl as playlists;
    let owner_id = match crate::api::auth::authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let playlist_id = id.into_inner();
    let mut changes = body.into_inner();
    if !valid_optional_text(changes.name.as_deref(), MAX_PLAYLIST_NAME_CHARACTERS, false)
        || !valid_optional_text(
            changes.description.as_deref(),
            MAX_PLAYLIST_DESCRIPTION_CHARACTERS,
            true,
        )
        || !valid_optional_text(
            changes.cover_image.as_deref(),
            MAX_COVER_IMAGE_CHARACTERS,
            true,
        )
    {
        return crate::api::error::bad_request(
            "Playlist metadata is empty or too long.",
            "playlist_metadata_invalid",
        );
    }
    if let Some(name) = changes.name.as_mut() {
        *name = name.trim().to_string();
    }
    let update_pool = pool.get_ref().clone();
    match web::block(move || -> Result<Option<usize>, String> {
        let mut connection = update_pool.get().map_err(|error| error.to_string())?;
        if !is_owner(&mut connection, playlist_id, owner_id).map_err(|error| error.to_string())? {
            return Ok(None);
        }
        diesel::update(playlists::playlist.find(playlist_id))
            .set(changes)
            .execute(&mut connection)
            .map(Some)
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(Some(1))) => HttpResponse::NoContent().finish(),
        Ok(Ok(_)) => not_found("Playlist not found.", "playlist_not_found"),
        Ok(Err(error)) => {
            tracing::error!(%error, "could not update playlist");
            internal_server_error("Could not update playlist.", "playlist_update_failed")
        }
        Err(error) => {
            tracing::error!(%error, "playlist update worker failed");
            internal_server_error("Could not update playlist.", "playlist_update_failed")
        }
    }
}

#[delete("/{id}")]
async fn delete_playlist(
    request: HttpRequest,
    id: web::Path<i32>,
    pool: web::Data<DbPool>,
) -> HttpResponse {
    use crate::persistence::schema::playlist::dsl as playlists;
    let owner_id = match crate::api::auth::authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let playlist_id = id.into_inner();
    let delete_pool = pool.get_ref().clone();
    match web::block(move || -> Result<Option<usize>, String> {
        let mut connection = delete_pool.get().map_err(|error| error.to_string())?;
        if !is_owner(&mut connection, playlist_id, owner_id).map_err(|error| error.to_string())? {
            return Ok(None);
        }
        diesel::delete(playlists::playlist.find(playlist_id))
            .execute(&mut connection)
            .map(Some)
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(Some(1))) => HttpResponse::NoContent().finish(),
        Ok(Ok(_)) => not_found("Playlist not found.", "playlist_not_found"),
        Ok(Err(error)) => {
            tracing::error!(%error, "could not delete playlist");
            internal_server_error("Could not delete playlist.", "playlist_delete_failed")
        }
        Err(error) => {
            tracing::error!(%error, "playlist delete worker failed");
            internal_server_error("Could not delete playlist.", "playlist_delete_failed")
        }
    }
}

#[post("/{id}/tracks")]
async fn add_track(
    request: HttpRequest,
    id: web::Path<i32>,
    body: web::Json<AddTrack>,
    pool: web::Data<DbPool>,
) -> HttpResponse {
    let owner_id = match crate::api::auth::authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let playlist_id = id.into_inner();
    let song_id = body.song_id.clone();
    if !valid_song_id(&song_id) {
        return crate::api::error::bad_request(
            "Song ID is empty or too long.",
            "playlist_song_id_invalid",
        );
    }
    let add_pool = pool.get_ref().clone();
    let result = web::block(move || -> Result<AddTrackResult, String> {
        let mut connection = add_pool.get().map_err(|error| error.to_string())?;
        add_track_transactionally(&mut connection, playlist_id, owner_id, &song_id)
            .map_err(|error: diesel::result::Error| error.to_string())
    })
    .await;
    match result {
        Ok(Ok(AddTrackResult::Added)) => HttpResponse::NoContent().finish(),
        Ok(Ok(AddTrackResult::PlaylistMissing)) => {
            not_found("Playlist not found.", "playlist_not_found")
        }
        Ok(Ok(AddTrackResult::SongMissing)) => {
            not_found("Song not found.", "playlist_song_not_found")
        }
        Ok(Ok(AddTrackResult::CapacityReached)) => crate::api::error::conflict(
            "Playlist track capacity reached.",
            "playlist_track_capacity_reached",
        ),
        Ok(Err(error)) => {
            tracing::error!(%error, "could not add playlist track");
            internal_server_error("Could not add track.", "playlist_track_add_failed")
        }
        Err(error) => {
            tracing::error!(%error, "playlist track worker failed");
            internal_server_error("Could not add track.", "playlist_track_add_failed")
        }
    }
}

#[post("/{id}/tracks/batch")]
async fn add_tracks(
    request: HttpRequest,
    id: web::Path<i32>,
    body: web::Json<AddTracks>,
    pool: web::Data<DbPool>,
) -> HttpResponse {
    let owner_id = match crate::api::auth::authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let playlist_id = id.into_inner();
    let song_ids = body.song_ids.clone();
    if song_ids.is_empty()
        || song_ids.len() > MAX_BATCH_TRACK_IDS
        || song_ids.iter().any(|song_id| !valid_song_id(song_id))
    {
        return crate::api::error::bad_request(
            "Song IDs are empty, invalid, or exceed the batch limit.",
            "playlist_song_ids_invalid",
        );
    }

    let add_pool = pool.get_ref().clone();
    let result = web::block(move || -> Result<AddTrackResult, String> {
        let mut connection = add_pool.get().map_err(|error| error.to_string())?;
        add_tracks_transactionally(&mut connection, playlist_id, owner_id, &song_ids)
            .map_err(|error| error.to_string())
    })
    .await;
    match result {
        Ok(Ok(AddTrackResult::Added)) => HttpResponse::NoContent().finish(),
        Ok(Ok(AddTrackResult::PlaylistMissing)) => {
            not_found("Playlist not found.", "playlist_not_found")
        }
        Ok(Ok(AddTrackResult::SongMissing)) => not_found(
            "One or more songs were not found.",
            "playlist_song_not_found",
        ),
        Ok(Ok(AddTrackResult::CapacityReached)) => crate::api::error::conflict(
            "Playlist track capacity reached.",
            "playlist_track_capacity_reached",
        ),
        Ok(Err(error)) => {
            tracing::error!(%error, "could not add playlist tracks");
            internal_server_error("Could not add tracks.", "playlist_tracks_add_failed")
        }
        Err(error) => {
            tracing::error!(%error, "playlist tracks worker failed");
            internal_server_error("Could not add tracks.", "playlist_tracks_add_failed")
        }
    }
}

#[post("/{id}/albums/{album_id}")]
async fn add_album(
    request: HttpRequest,
    path: web::Path<(i32, String)>,
    pool: web::Data<DbPool>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let owner_id = match crate::api::auth::authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let (playlist_id, album_id) = path.into_inner();
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let Some(album) = cache.album(&album_id) else {
        return not_found("Album not found.", "album_not_found");
    };
    let song_ids = album
        .songs
        .iter()
        .map(|song| song.id.clone())
        .collect::<Vec<_>>();
    if song_ids.is_empty() {
        return HttpResponse::NoContent().finish();
    }

    let add_pool = pool.get_ref().clone();
    let result = web::block(move || -> Result<AddTrackResult, String> {
        let mut connection = add_pool.get().map_err(|error| error.to_string())?;
        add_tracks_transactionally(&mut connection, playlist_id, owner_id, &song_ids)
            .map_err(|error| error.to_string())
    })
    .await;
    match result {
        Ok(Ok(AddTrackResult::Added)) => HttpResponse::NoContent().finish(),
        Ok(Ok(AddTrackResult::PlaylistMissing)) => {
            not_found("Playlist not found.", "playlist_not_found")
        }
        Ok(Ok(AddTrackResult::SongMissing)) => not_found(
            "One or more songs were not found.",
            "playlist_song_not_found",
        ),
        Ok(Ok(AddTrackResult::CapacityReached)) => crate::api::error::conflict(
            "Playlist track capacity reached.",
            "playlist_track_capacity_reached",
        ),
        Ok(Err(error)) => {
            tracing::error!(%error, "could not add album to playlist");
            internal_server_error("Could not add album.", "playlist_album_add_failed")
        }
        Err(error) => {
            tracing::error!(%error, "playlist album worker failed");
            internal_server_error("Could not add album.", "playlist_album_add_failed")
        }
    }
}

#[cfg(test)]
mod tests {
    use diesel::Connection;
    use diesel::RunQueryDsl;
    use diesel::connection::SimpleConnection;

    use super::{
        AddTrackResult, MAX_PLAYLIST_NAME_CHARACTERS, MAX_TRACKS_PER_PLAYLIST,
        add_track_transactionally, add_tracks_transactionally, is_owner, playlist_list_rows,
        valid_optional_text,
    };

    #[test]
    fn playlist_ownership_is_scoped_to_the_authenticated_user() {
        let mut connection = diesel::sqlite::SqliteConnection::establish(":memory:")
            .expect("in-memory sqlite connection");
        connection
            .batch_execute(
                "CREATE TABLE _playlist_to_user (a INTEGER NOT NULL, b INTEGER NOT NULL);
                 INSERT INTO _playlist_to_user (a, b) VALUES (7, 10);",
            )
            .expect("ownership fixture");

        assert!(is_owner(&mut connection, 7, 10).expect("ownership lookup"));
        assert!(!is_owner(&mut connection, 7, 11).expect("ownership lookup"));
        assert!(!is_owner(&mut connection, 8, 10).expect("ownership lookup"));
    }

    #[test]
    fn playlist_metadata_is_bounded_before_database_writes() {
        assert!(valid_optional_text(
            Some("Road trip"),
            MAX_PLAYLIST_NAME_CHARACTERS,
            false
        ));
        assert!(!valid_optional_text(
            Some("   "),
            MAX_PLAYLIST_NAME_CHARACTERS,
            false
        ));
        assert!(!valid_optional_text(
            Some(&"x".repeat(MAX_PLAYLIST_NAME_CHARACTERS + 1)),
            MAX_PLAYLIST_NAME_CHARACTERS,
            false,
        ));
    }

    #[test]
    fn playlist_add_is_idempotent_and_capacity_is_transactional() {
        let mut connection = diesel::sqlite::SqliteConnection::establish(":memory:")
            .expect("in-memory sqlite connection");
        connection
            .batch_execute(
                "CREATE TABLE playlist (
                    id INTEGER PRIMARY KEY, updated_at TIMESTAMP NOT NULL
                 );
                 CREATE TABLE _playlist_to_user (
                    rowid INTEGER PRIMARY KEY, a INTEGER NOT NULL, b INTEGER NOT NULL
                 );
                 CREATE TABLE song (id TEXT PRIMARY KEY);
                 CREATE TABLE _playlist_to_song (
                    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
                    a INTEGER NOT NULL, b TEXT NOT NULL,
                    date_added TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    added_by INTEGER, position INTEGER,
                    UNIQUE(a, b)
                 );
                 INSERT INTO playlist (id, updated_at) VALUES (1, '2000-01-01 00:00:00');
                 INSERT INTO _playlist_to_user (a, b) VALUES (1, 7);
                 INSERT INTO song (id) VALUES ('song-1'), ('song-overflow');",
            )
            .expect("playlist reliability fixture");

        assert_eq!(
            add_track_transactionally(&mut connection, 1, 7, "song-1").expect("first playlist add"),
            AddTrackResult::Added,
        );
        assert_eq!(
            add_track_transactionally(&mut connection, 1, 7, "song-1")
                .expect("idempotent playlist add"),
            AddTrackResult::Added,
        );

        connection
            .batch_execute(&format!(
                "WITH RECURSIVE sequence(value) AS (
                    SELECT 2 UNION ALL SELECT value + 1 FROM sequence WHERE value < {}
                 )
                 INSERT INTO _playlist_to_song (a, b)
                 SELECT 1, 'existing-' || value FROM sequence;",
                MAX_TRACKS_PER_PLAYLIST
            ))
            .expect("fill playlist to capacity");
        assert_eq!(
            add_track_transactionally(&mut connection, 1, 7, "song-overflow")
                .expect("capacity result"),
            AddTrackResult::CapacityReached,
        );
    }

    #[test]
    fn playlist_batch_add_is_atomic_and_deduplicated() {
        let mut connection = diesel::sqlite::SqliteConnection::establish(":memory:")
            .expect("in-memory sqlite connection");
        connection
            .batch_execute(
                "CREATE TABLE playlist (
                    id INTEGER PRIMARY KEY, updated_at TIMESTAMP NOT NULL
                 );
                 CREATE TABLE _playlist_to_user (
                    rowid INTEGER PRIMARY KEY, a INTEGER NOT NULL, b INTEGER NOT NULL
                 );
                 CREATE TABLE song (id TEXT PRIMARY KEY);
                 CREATE TABLE _playlist_to_song (
                    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
                    a INTEGER NOT NULL, b TEXT NOT NULL,
                    date_added TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    added_by INTEGER, position INTEGER,
                    UNIQUE(a, b)
                 );
                 INSERT INTO playlist (id, updated_at) VALUES (1, '2000-01-01 00:00:00');
                 INSERT INTO _playlist_to_user (a, b) VALUES (1, 7);
                 INSERT INTO song (id) VALUES ('song-1'), ('song-2');",
            )
            .expect("playlist batch fixture");

        assert_eq!(
            add_tracks_transactionally(
                &mut connection,
                1,
                7,
                &["song-1".into(), "song-1".into(), "song-2".into()],
            )
            .expect("batch add"),
            AddTrackResult::Added,
        );
        let count = diesel::sql_query("SELECT COUNT(*) AS count FROM _playlist_to_song")
            .load::<CountRow>(&mut connection)
            .expect("track count")[0]
            .count;
        assert_eq!(count, 2);
        let ids = diesel::sql_query("SELECT b AS id FROM _playlist_to_song ORDER BY rowid")
            .load::<IdRow>(&mut connection)
            .expect("track order")
            .into_iter()
            .map(|row| row.id)
            .collect::<Vec<_>>();
        assert_eq!(ids, ["song-1", "song-2"]);

        assert_eq!(
            add_tracks_transactionally(
                &mut connection,
                1,
                7,
                &["song-1".into(), "missing".into()],
            )
            .expect("missing batch"),
            AddTrackResult::SongMissing,
        );
        let count = diesel::sql_query("SELECT COUNT(*) AS count FROM _playlist_to_song")
            .load::<CountRow>(&mut connection)
            .expect("track count after rejected batch")[0]
            .count;
        assert_eq!(count, 2);
    }

    #[test]
    fn playlist_list_rows_are_scoped_aggregated_and_cover_bounded() {
        let mut connection = diesel::sqlite::SqliteConnection::establish(":memory:")
            .expect("in-memory sqlite connection");
        connection
            .batch_execute(
                "CREATE TABLE playlist (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    cover_image TEXT,
                    is_public BOOLEAN NOT NULL DEFAULT false,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE TABLE _playlist_to_user (
                    rowid INTEGER PRIMARY KEY, a INTEGER NOT NULL, b INTEGER NOT NULL
                 );
                 CREATE TABLE _playlist_to_song (
                    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
                    a INTEGER NOT NULL, b TEXT NOT NULL,
                    date_added TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    added_by INTEGER, position INTEGER
                 );
                 CREATE TABLE track_entity (
                    id TEXT PRIMARY KEY, duration_seconds REAL NOT NULL
                 );
                 CREATE TABLE playlist_stats (
                    playlist_id INTEGER PRIMARY KEY,
                    total_duration REAL NOT NULL,
                    song_count INTEGER NOT NULL
                 );
                 INSERT INTO playlist (id, name) VALUES (1, 'Mine'), (2, 'Theirs');
                 INSERT INTO _playlist_to_user (a, b) VALUES (1, 7), (2, 8);
                 INSERT INTO track_entity (id, duration_seconds) VALUES
                    ('song-1', 1), ('song-2', 2), ('song-3', 3),
                    ('song-4', 4), ('song-5', 5), ('other-song', 100);
                 INSERT INTO _playlist_to_song (a, b, position) VALUES
                    (1, 'song-1', 3), (1, 'song-2', 1), (1, 'song-3', 2),
                    (1, 'song-4', NULL), (1, 'song-5', 5),
                    (2, 'other-song', 1);
                 UPDATE _playlist_to_song SET position = rowid WHERE position IS NULL;
                 INSERT INTO playlist_stats VALUES (1, 15, 5), (2, 100, 1);",
            )
            .expect("playlist summary fixture");

        let (playlists, aggregates, covers) =
            playlist_list_rows(&mut connection, 7).expect("playlist summary rows");

        assert_eq!(playlists.len(), 1);
        assert_eq!(playlists[0].name, "Mine");
        assert_eq!(aggregates.len(), 1);
        assert_eq!(aggregates[0].playlist_id, 1);
        assert_eq!(aggregates[0].song_count, 5);
        assert_eq!(aggregates[0].total_duration, 15.0);
        assert_eq!(
            covers
                .into_iter()
                .map(|row| row.song_id)
                .collect::<Vec<_>>(),
            ["song-2", "song-3", "song-1", "song-4"]
        );
    }

    #[derive(diesel::QueryableByName)]
    struct CountRow {
        #[diesel(sql_type = diesel::sql_types::BigInt)]
        count: i64,
    }

    #[derive(diesel::QueryableByName)]
    struct IdRow {
        #[diesel(sql_type = diesel::sql_types::Text)]
        id: String,
    }
}

#[delete("/{id}/tracks/{song_id}")]
async fn remove_track(
    request: HttpRequest,
    path: web::Path<(i32, String)>,
    pool: web::Data<DbPool>,
) -> HttpResponse {
    use crate::persistence::schema::_playlist_to_song::dsl as tracks;
    use crate::persistence::schema::playlist::dsl as playlists;
    let (id, song_id) = path.into_inner();
    let owner_id = match crate::api::auth::authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    if !valid_song_id(&song_id) {
        return crate::api::error::bad_request(
            "Song ID is empty or too long.",
            "playlist_song_id_invalid",
        );
    }
    let remove_pool = pool.get_ref().clone();
    match web::block(move || -> Result<Option<usize>, String> {
        let mut connection = remove_pool.get().map_err(|error| error.to_string())?;
        connection
            .transaction(|connection| {
                if !is_owner(connection, id, owner_id)? {
                    return Ok(None);
                }
                let removed = diesel::delete(
                    tracks::_playlist_to_song
                        .filter(tracks::a.eq(id))
                        .filter(tracks::b.eq(song_id)),
                )
                .execute(connection)?;
                if removed > 0 {
                    diesel::update(playlists::playlist.find(id))
                        .set(playlists::updated_at.eq(diesel::dsl::now))
                        .execute(connection)?;
                }
                Ok(Some(removed))
            })
            .map_err(|error: diesel::result::Error| error.to_string())
    })
    .await
    {
        Ok(Ok(Some(_))) => HttpResponse::NoContent().finish(),
        Ok(Ok(None)) => not_found("Playlist not found.", "playlist_not_found"),
        Ok(Err(error)) => {
            tracing::error!(%error, "could not remove playlist track");
            internal_server_error("Could not remove track.", "playlist_track_remove_failed")
        }
        Err(error) => {
            tracing::error!(%error, "playlist track removal worker failed");
            internal_server_error("Could not remove track.", "playlist_track_remove_failed")
        }
    }
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/playlists")
            .service(list)
            .service(create)
            .service(add_album)
            .service(add_tracks)
            .service(add_track)
            .service(remove_track)
            .service(update)
            .service(delete_playlist)
            .service(detail),
    );
}
