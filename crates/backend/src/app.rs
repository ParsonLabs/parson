use std::error::Error;
use std::path::Path;
use std::sync::Arc;

use diesel::deserialize::QueryableByName;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Integer, Nullable, Text};
use serde::Serialize;

use crate::library::indexer::{enrich_library_to_database, index_available_library_to_database};
use crate::library::normalize::{LibraryIndexReport, normalize_library_data};
use crate::library::state::LibraryCache;
use crate::library::state::LibraryLifecycle;
use crate::library::storage::store_library;
use crate::persistence::connection::{DbPool, connect};
use crate::playlist_rules::{
    MAX_PLAYLIST_NAME_CHARACTERS, MAX_PLAYLISTS, MAX_TRACKS_PER_PLAYLIST, valid_optional_text,
    valid_song_id,
};

pub type AppError = Box<dyn Error + Send + Sync + 'static>;

/// Process-local application state for native hosts.
#[derive(Clone)]
pub struct LocalApp {
    pub database: DbPool,
    pub library: Arc<LibraryLifecycle>,
}

#[derive(Debug, Serialize)]
pub struct LocalIndexResult {
    pub path: String,
    pub report: LibraryIndexReport,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCatalogPage {
    pub albums: Vec<LocalCatalogAlbum>,
    pub songs: Vec<LocalCatalogSong>,
    pub total_albums: usize,
    pub total_songs: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCatalogAlbum {
    pub id: String,
    pub name: String,
    pub artist_id: String,
    pub artist_name: String,
    pub cover_path: String,
    pub release_year: String,
    pub song_count: usize,
    pub first_song_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCatalogSong {
    pub id: String,
    pub name: String,
    pub artist_id: String,
    pub artist_name: String,
    pub album_id: String,
    pub album_name: String,
    pub cover_path: String,
    pub path: String,
    pub duration_seconds: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchItem {
    pub entity_type: String,
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub artist_name: String,
    pub album_name: String,
    pub artwork_path: String,
    pub media_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAlbumDetail {
    pub album: LocalCatalogAlbum,
    pub songs: Vec<LocalCatalogSong>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPlaylist {
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
    pub track_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPlaylistDetail {
    pub playlist: LocalPlaylist,
    pub songs: Vec<LocalCatalogSong>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCatalogArtist {
    pub id: String,
    pub name: String,
    pub artwork_path: String,
    pub album_count: usize,
    pub song_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalArtistDetail {
    pub artist: LocalCatalogArtist,
    pub albums: Vec<LocalCatalogAlbum>,
    pub songs: Vec<LocalCatalogSong>,
}

#[derive(QueryableByName)]
struct LocalPlaylistRow {
    #[diesel(sql_type = Integer)]
    id: i32,
    #[diesel(sql_type = Text)]
    name: String,
    #[diesel(sql_type = Nullable<Text>)]
    description: Option<String>,
    #[diesel(sql_type = BigInt)]
    track_count: i64,
}

#[derive(QueryableByName)]
struct PlaylistSongRow {
    #[diesel(sql_type = Text)]
    song_id: String,
}

async fn await_index_worker<T>(
    lifecycle: &LibraryLifecycle,
    worker: tokio::task::JoinHandle<Result<T, AppError>>,
) -> Result<T, AppError> {
    match worker.await {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(error)) => {
            lifecycle.set_scan_failed(error.to_string()).await;
            Err(error)
        }
        Err(join_error) => {
            let message = format!("The local index task stopped unexpectedly: {join_error}");
            lifecycle.set_scan_failed(&message).await;
            Err(message.into())
        }
    }
}

async fn perform_local_index(
    lifecycle: Arc<LibraryLifecycle>,
    path: String,
    scan_lease: tokio::sync::OwnedMutexGuard<()>,
) -> Result<LocalIndexResult, AppError> {
    lifecycle
        .set_indexing("Discovering playable music on this PC.")
        .await;
    let index_path = path.clone();
    let worker = tokio::task::spawn_blocking(move || {
        let (mut library, report) = index_available_library_to_database(&index_path)?;
        normalize_library_data(&mut library);
        Ok::<_, AppError>((library, report))
    });
    let (library, report) = await_index_worker(&lifecycle, worker).await?;
    if report.scanned_files == 0 {
        let error = "The selected folder contains no supported audio files.";
        lifecycle.set_scan_failed(error).await;
        return Err(error.into());
    }

    store_library(library).await;
    match LibraryCache::available().await {
        Ok(cache) => lifecycle.set_available(cache).await,
        Err(error) => {
            lifecycle.set_scan_failed(error.to_string()).await;
            return Err(error);
        }
    }

    let enrichment_lifecycle = lifecycle.clone();
    let enrichment_path = path.clone();
    tokio::spawn(async move {
        let _scan_lease = scan_lease;
        let worker = tokio::task::spawn_blocking(move || {
            let (mut library, _) = enrich_library_to_database(&enrichment_path)?;
            normalize_library_data(&mut library);
            Ok::<_, AppError>(library)
        });
        let result = match worker.await {
            Ok(result) => result,
            Err(error) => {
                Err(format!("Metadata enrichment task stopped unexpectedly: {error}").into())
            }
        };
        match result {
            Ok(library) => {
                store_library(library).await;
                match LibraryCache::new().await {
                    Ok(cache) => enrichment_lifecycle.set_ready_and_persist(cache).await,
                    Err(error) => {
                        enrichment_lifecycle
                            .set_enrichment_failed(error.to_string())
                            .await
                    }
                }
            }
            Err(error) => {
                enrichment_lifecycle
                    .set_enrichment_failed(error.to_string())
                    .await
            }
        }
    });

    Ok(LocalIndexResult { path, report })
}

impl LocalApp {
    pub(crate) fn open_uninitialized() -> Result<Self, AppError> {
        Ok(Self {
            database: connect()?,
            library: Arc::new(LibraryLifecycle::new()),
        })
    }

    pub async fn open() -> Result<Self, AppError> {
        let app = Self::open_uninitialized()?;
        crate::startup::initialize_library(&app.library).await;
        Ok(app)
    }

    /// Indexes a folder without an HTTP server.
    pub async fn index_library(&self, requested_path: &Path) -> Result<LocalIndexResult, AppError> {
        let path = tokio::fs::canonicalize(requested_path).await?;
        if !path.is_dir() {
            return Err("The selected library path is not a directory.".into());
        }
        let path = path.to_string_lossy().into_owned();
        let Some(scan_lease) = self.library.try_begin_scan() else {
            return Err("A local library scan is already running.".into());
        };
        let lifecycle = self.library.clone();
        let scan = tokio::spawn(perform_local_index(lifecycle.clone(), path, scan_lease));
        match scan.await {
            Ok(result) => result,
            Err(join_error) => {
                let message = format!("The local scan coordinator stopped: {join_error}");
                lifecycle.set_scan_failed(&message).await;
                Err(message.into())
            }
        }
    }

    /// Returns a bounded catalog page for native clients.
    pub async fn catalog(&self, offset: usize, limit: usize) -> Result<LocalCatalogPage, AppError> {
        self.catalog_page(offset, limit, true, true).await
    }

    pub async fn catalog_albums(
        &self,
        offset: usize,
        limit: usize,
    ) -> Result<LocalCatalogPage, AppError> {
        self.catalog_page(offset, limit, true, false).await
    }

    pub async fn catalog_songs(
        &self,
        offset: usize,
        limit: usize,
    ) -> Result<LocalCatalogPage, AppError> {
        self.catalog_page(offset, limit, false, true).await
    }

    async fn catalog_page(
        &self,
        offset: usize,
        limit: usize,
        include_albums: bool,
        include_songs: bool,
    ) -> Result<LocalCatalogPage, AppError> {
        let cache = self.library.cache().await.map_err(|readiness| {
            readiness
                .message
                .unwrap_or_else(|| "The local library is not ready.".into())
        })?;
        let limit = limit.clamp(1, 200);
        let mut albums = Vec::with_capacity(limit);
        let mut songs = Vec::with_capacity(limit);
        let mut album_position = 0usize;
        let mut song_position = 0usize;

        for artist in cache.artists.iter() {
            for album in &artist.albums {
                if include_albums && album_position >= offset && albums.len() < limit {
                    albums.push(LocalCatalogAlbum {
                        id: album.id.clone(),
                        name: album.name.clone(),
                        artist_id: artist.id.clone(),
                        artist_name: artist.name.clone(),
                        cover_path: album.cover_url.clone(),
                        release_year: album.first_release_date.chars().take(4).collect(),
                        song_count: album.songs.len(),
                        first_song_id: album.songs.first().map(|song| song.id.clone()),
                    });
                }
                album_position += 1;
                for song in &album.songs {
                    if include_songs && song_position >= offset && songs.len() < limit {
                        songs.push(LocalCatalogSong {
                            id: song.id.clone(),
                            name: song.name.clone(),
                            artist_id: artist.id.clone(),
                            artist_name: artist.name.clone(),
                            album_id: album.id.clone(),
                            album_name: album.name.clone(),
                            cover_path: album.cover_url.clone(),
                            path: song.path.clone(),
                            duration_seconds: song.duration,
                        });
                    }
                    song_position += 1;
                }
                if (!include_albums || albums.len() >= limit)
                    && (!include_songs || songs.len() >= limit)
                {
                    break;
                }
            }
            if (!include_albums || albums.len() >= limit)
                && (!include_songs || songs.len() >= limit)
            {
                break;
            }
        }

        Ok(LocalCatalogPage {
            albums,
            songs,
            total_albums: cache.album_count(),
            total_songs: cache.songs_flat.len(),
        })
    }

    pub async fn artists(
        &self,
        offset: usize,
        limit: usize,
    ) -> Result<Vec<LocalCatalogArtist>, AppError> {
        let cache = self.library.cache().await.map_err(|readiness| {
            readiness
                .message
                .unwrap_or_else(|| "The local library is not ready.".into())
        })?;
        Ok(cache
            .artists
            .iter()
            .skip(offset)
            .take(limit.clamp(1, 200))
            .map(|artist| LocalCatalogArtist {
                id: artist.id.clone(),
                name: artist.name.clone(),
                artwork_path: artist.icon_url.clone(),
                album_count: artist.albums.len(),
                song_count: artist.albums.iter().map(|album| album.songs.len()).sum(),
            })
            .collect())
    }

    pub async fn artist_detail(&self, id: &str) -> Result<LocalArtistDetail, AppError> {
        let cache = self.library.cache().await.map_err(|readiness| {
            readiness
                .message
                .unwrap_or_else(|| "The local library is not ready.".into())
        })?;
        let artist = cache
            .artist(id)
            .ok_or_else(|| "The selected artist is no longer in the local library.".to_string())?;
        let summary = LocalCatalogArtist {
            id: artist.id.clone(),
            name: artist.name.clone(),
            artwork_path: artist.icon_url.clone(),
            album_count: artist.albums.len(),
            song_count: artist.albums.iter().map(|album| album.songs.len()).sum(),
        };
        let albums = artist
            .albums
            .iter()
            .map(|album| LocalCatalogAlbum {
                id: album.id.clone(),
                name: album.name.clone(),
                artist_id: artist.id.clone(),
                artist_name: artist.name.clone(),
                cover_path: album.cover_url.clone(),
                release_year: album.first_release_date.chars().take(4).collect(),
                song_count: album.songs.len(),
                first_song_id: album.songs.first().map(|song| song.id.clone()),
            })
            .collect();
        let songs = artist
            .albums
            .iter()
            .flat_map(|album| {
                album.songs.iter().map(|song| LocalCatalogSong {
                    id: song.id.clone(),
                    name: song.name.clone(),
                    artist_id: artist.id.clone(),
                    artist_name: artist.name.clone(),
                    album_id: album.id.clone(),
                    album_name: album.name.clone(),
                    cover_path: album.cover_url.clone(),
                    path: song.path.clone(),
                    duration_seconds: song.duration,
                })
            })
            .take(100)
            .collect();
        Ok(LocalArtistDetail {
            artist: summary,
            albums,
            songs,
        })
    }

    pub async fn search(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<LocalSearchItem>, AppError> {
        let cache = self.library.cache().await.map_err(|readiness| {
            readiness
                .message
                .unwrap_or_else(|| "The local library is not ready.".into())
        })?;
        let hits = cache
            .search_index
            .search(query, limit.clamp(1, 100))
            .expect("local search is infallible");
        let mut items = Vec::with_capacity(hits.len());

        for hit in hits {
            let item = match hit.entity_type.as_str() {
                "artist" => cache.artist(&hit.entity_id).map(|artist| LocalSearchItem {
                    entity_type: "artist".into(),
                    id: artist.id.clone(),
                    title: artist.name.clone(),
                    subtitle: "Artist".into(),
                    artist_name: artist.name.clone(),
                    album_name: String::new(),
                    artwork_path: artist.icon_url.clone(),
                    media_path: String::new(),
                }),
                "album" => cache.album(&hit.entity_id).and_then(|album| {
                    let artist = cache.album_owner(&album.id)?;
                    Some(LocalSearchItem {
                        entity_type: "album".into(),
                        id: album.id.clone(),
                        title: album.name.clone(),
                        subtitle: artist.name.clone(),
                        artist_name: artist.name.clone(),
                        album_name: album.name.clone(),
                        artwork_path: album.cover_url.clone(),
                        media_path: album
                            .songs
                            .first()
                            .map(|song| song.path.clone())
                            .unwrap_or_default(),
                    })
                }),
                "song" => cache
                    .song_map
                    .get(&hit.entity_id)
                    .and_then(|(artist_id, album_id)| {
                        let song = cache.song(&hit.entity_id)?;
                        let artist = cache.artist(artist_id)?;
                        let album = cache.album(album_id)?;
                        Some(LocalSearchItem {
                            entity_type: "song".into(),
                            id: song.id.clone(),
                            title: song.name.clone(),
                            subtitle: format!("{} · {}", artist.name, album.name),
                            artist_name: artist.name.clone(),
                            album_name: album.name.clone(),
                            artwork_path: album.cover_url.clone(),
                            media_path: song.path.clone(),
                        })
                    }),
                _ => None,
            };
            if let Some(item) = item {
                items.push(item);
            }
        }
        Ok(items)
    }

    pub async fn recommendations(
        &self,
        seed_song_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<LocalCatalogSong>, AppError> {
        let cache = self.library.cache().await.map_err(|readiness| {
            readiness
                .message
                .unwrap_or_else(|| "The local library is not ready.".into())
        })?;
        let limit = limit.clamp(1, 40);
        let ranked = crate::recommendation::recommend(
            0,
            seed_song_id,
            cache.as_ref(),
            &self.database,
            limit,
        )
        .map_err(|error| error.to_string())?;
        let mut ids = ranked
            .into_iter()
            .map(|item| item.song_id)
            .collect::<Vec<_>>();
        if ids.is_empty() {
            ids.extend(
                cache
                    .songs_flat
                    .iter()
                    .filter(|song_id| Some(song_id.as_str()) != seed_song_id)
                    .take(limit)
                    .cloned(),
            );
        }
        Ok(ids
            .into_iter()
            .filter_map(|id| {
                let (artist_id, album_id) = cache.song_map.get(&id)?;
                let artist = cache.artist(artist_id)?;
                let album = cache.album(album_id)?;
                let song = cache.song(&id)?;
                Some(LocalCatalogSong {
                    id: song.id.clone(),
                    name: song.name.clone(),
                    artist_id: artist.id.clone(),
                    artist_name: artist.name.clone(),
                    album_id: album.id.clone(),
                    album_name: album.name.clone(),
                    cover_path: album.cover_url.clone(),
                    path: song.path.clone(),
                    duration_seconds: song.duration,
                })
            })
            .take(limit)
            .collect())
    }

    pub async fn album_detail(&self, id: &str) -> Result<LocalAlbumDetail, AppError> {
        let cache = self.library.cache().await.map_err(|readiness| {
            readiness
                .message
                .unwrap_or_else(|| "The local library is not ready.".into())
        })?;
        let album = cache
            .album(id)
            .ok_or_else(|| "The selected album is no longer in the local library.".to_string())?;
        let artist = cache
            .album_owner(id)
            .ok_or_else(|| "The album artist is unavailable.".to_string())?;
        let summary = LocalCatalogAlbum {
            id: album.id.clone(),
            name: album.name.clone(),
            artist_id: artist.id.clone(),
            artist_name: artist.name.clone(),
            cover_path: album.cover_url.clone(),
            release_year: album.first_release_date.chars().take(4).collect(),
            song_count: album.songs.len(),
            first_song_id: album.songs.first().map(|song| song.id.clone()),
        };
        let songs = album
            .songs
            .iter()
            .map(|song| LocalCatalogSong {
                id: song.id.clone(),
                name: song.name.clone(),
                artist_id: artist.id.clone(),
                artist_name: artist.name.clone(),
                album_id: album.id.clone(),
                album_name: album.name.clone(),
                cover_path: album.cover_url.clone(),
                path: song.path.clone(),
                duration_seconds: song.duration,
            })
            .collect();
        Ok(LocalAlbumDetail {
            album: summary,
            songs,
        })
    }

    pub async fn playlists(&self) -> Result<Vec<LocalPlaylist>, AppError> {
        let pool = self.database.clone();
        tokio::task::spawn_blocking(move || {
            let mut connection = pool.get()?;
            let rows = diesel::sql_query(
                "SELECT p.id, p.name, p.description, COUNT(ps.rowid) AS track_count
                 FROM playlist p
                 LEFT JOIN _playlist_to_song ps ON ps.a = p.id
                 GROUP BY p.id, p.name, p.description
                 ORDER BY p.updated_at DESC, p.id DESC
                 LIMIT ?",
            )
            .bind::<BigInt, _>(MAX_PLAYLISTS)
            .load::<LocalPlaylistRow>(&mut connection)?;
            Ok::<_, AppError>(rows.into_iter().map(LocalPlaylist::from).collect())
        })
        .await
        .map_err(|error| format!("The local playlist task stopped unexpectedly: {error}"))?
    }

    pub async fn create_playlist(&self, name: &str) -> Result<LocalPlaylist, AppError> {
        let name = name.trim();
        if !valid_optional_text(Some(name), MAX_PLAYLIST_NAME_CHARACTERS, false) {
            return Err("Playlist names must contain 1 to 200 characters.".into());
        }
        let name = name.to_owned();
        let pool = self.database.clone();
        tokio::task::spawn_blocking(move || {
            use crate::persistence::schema::playlist::dsl as playlists;
            let mut connection = pool.get()?;
            connection.transaction(|connection| {
                let count = playlists::playlist.count().get_result::<i64>(connection)?;
                if count >= MAX_PLAYLISTS {
                    return Err("Local playlist capacity reached.".into());
                }
                diesel::insert_into(playlists::playlist)
                    .values(playlists::name.eq(&name))
                    .execute(connection)?;
                let id = diesel::select(diesel::dsl::sql::<BigInt>("last_insert_rowid()"))
                    .get_result::<i64>(connection)? as i32;
                Ok::<_, AppError>(LocalPlaylist {
                    id,
                    name,
                    description: None,
                    track_count: 0,
                })
            })
        })
        .await
        .map_err(|error| format!("The local playlist task stopped unexpectedly: {error}"))?
    }

    pub async fn add_playlist_song(&self, playlist_id: i32, song_id: &str) -> Result<(), AppError> {
        if !valid_song_id(song_id) {
            return Err("The song identifier is empty or too long.".into());
        }
        let cache = self.library.cache().await.map_err(|readiness| {
            readiness
                .message
                .unwrap_or_else(|| "The local library is not ready.".into())
        })?;
        if cache.song(song_id).is_none() {
            return Err("The selected song is no longer in the local library.".into());
        }
        let pool = self.database.clone();
        let song_id = song_id.to_owned();
        tokio::task::spawn_blocking(move || {
            use crate::persistence::schema::_playlist_to_song::dsl as tracks;
            use crate::persistence::schema::playlist::dsl as playlists;
            let mut connection = pool.get()?;
            connection.transaction(|connection| {
                let exists = playlists::playlist
                    .find(playlist_id)
                    .select(playlists::id)
                    .first::<i32>(connection)
                    .optional()?
                    .is_some();
                if !exists {
                    return Err("The selected playlist no longer exists.".into());
                }
                let already_added = tracks::_playlist_to_song
                    .filter(tracks::a.eq(playlist_id))
                    .filter(tracks::b.eq(&song_id))
                    .select(tracks::rowid)
                    .first::<i32>(connection)
                    .optional()?
                    .is_some();
                if already_added {
                    return Ok(());
                }
                let count = tracks::_playlist_to_song
                    .filter(tracks::a.eq(playlist_id))
                    .count()
                    .get_result::<i64>(connection)?;
                if count >= MAX_TRACKS_PER_PLAYLIST {
                    return Err("Local playlist track capacity reached.".into());
                }
                let inserted = diesel::insert_or_ignore_into(tracks::_playlist_to_song)
                    .values((tracks::a.eq(playlist_id), tracks::b.eq(song_id)))
                    .execute(connection)?;
                if inserted > 0 {
                    diesel::update(playlists::playlist.find(playlist_id))
                        .set(playlists::updated_at.eq(diesel::dsl::now))
                        .execute(connection)?;
                }
                Ok::<_, AppError>(())
            })
        })
        .await
        .map_err(|error| format!("The local playlist task stopped unexpectedly: {error}"))?
    }

    pub async fn playlist_detail(&self, playlist_id: i32) -> Result<LocalPlaylistDetail, AppError> {
        let pool = self.database.clone();
        let (playlist, song_ids) = tokio::task::spawn_blocking(move || {
            let mut connection = pool.get()?;
            let playlist = diesel::sql_query(
                "SELECT p.id, p.name, p.description, COUNT(ps.rowid) AS track_count
                 FROM playlist p
                 LEFT JOIN _playlist_to_song ps ON ps.a = p.id
                 WHERE p.id = ?
                 GROUP BY p.id, p.name, p.description",
            )
            .bind::<Integer, _>(playlist_id)
            .get_result::<LocalPlaylistRow>(&mut connection)
            .optional()?
            .ok_or("The selected playlist no longer exists.")?;
            let songs = diesel::sql_query(
                "SELECT b AS song_id FROM _playlist_to_song
                 WHERE a = ? ORDER BY COALESCE(position, rowid), rowid
                 LIMIT ?",
            )
            .bind::<Integer, _>(playlist_id)
            .bind::<BigInt, _>(MAX_TRACKS_PER_PLAYLIST)
            .load::<PlaylistSongRow>(&mut connection)?;
            Ok::<_, AppError>((LocalPlaylist::from(playlist), songs))
        })
        .await
        .map_err(|error| format!("The local playlist task stopped unexpectedly: {error}"))??;
        let cache = self.library.cache().await.map_err(|readiness| {
            readiness
                .message
                .unwrap_or_else(|| "The local library is not ready.".into())
        })?;
        let songs = song_ids
            .into_iter()
            .filter_map(|row| {
                let (artist_id, album_id) = cache.song_map.get(&row.song_id)?;
                let song = cache.song(&row.song_id)?;
                let artist = cache.artist(artist_id)?;
                let album = cache.album(album_id)?;
                Some(LocalCatalogSong {
                    id: song.id.clone(),
                    name: song.name.clone(),
                    artist_id: artist.id.clone(),
                    artist_name: artist.name.clone(),
                    album_id: album.id.clone(),
                    album_name: album.name.clone(),
                    cover_path: album.cover_url.clone(),
                    path: song.path.clone(),
                    duration_seconds: song.duration,
                })
            })
            .collect();
        Ok(LocalPlaylistDetail { playlist, songs })
    }
}

impl From<LocalPlaylistRow> for LocalPlaylist {
    fn from(row: LocalPlaylistRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            description: row.description,
            track_count: row.track_count,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::{AppError, await_index_worker};
    use crate::library::state::{LibraryLifecycle, LibraryReadinessState};

    #[actix_web::test]
    async fn panicked_index_workers_leave_a_retryable_failure_state() {
        let lifecycle = LibraryLifecycle::new();
        lifecycle.set_indexing("test scan").await;
        let worker = tokio::task::spawn_blocking(|| -> Result<(), AppError> {
            panic!("simulated index worker panic")
        });

        assert!(await_index_worker(&lifecycle, worker).await.is_err());
        assert_eq!(
            lifecycle.readiness().await.state,
            LibraryReadinessState::Failed
        );
        assert!(lifecycle.try_begin_scan().is_some());
    }

    #[actix_web::test]
    async fn detached_scan_work_retains_the_single_flight_lease() {
        let lifecycle = Arc::new(LibraryLifecycle::new());
        let lease = lifecycle.try_begin_scan().expect("initial scan lease");
        let (release, wait) = tokio::sync::oneshot::channel::<()>();
        let coordinator = tokio::spawn(async move {
            let _lease = lease;
            let _ = wait.await;
        });
        drop(coordinator);

        assert!(lifecycle.try_begin_scan().is_none());
        release.send(()).expect("release detached scan");
        for _ in 0..10 {
            if lifecycle.try_begin_scan().is_some() {
                return;
            }
            tokio::task::yield_now().await;
        }
        panic!("detached scan did not release its lease after completion");
    }
}
