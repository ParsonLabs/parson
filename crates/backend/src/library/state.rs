use std::collections::HashMap;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex as StdMutex, OnceLock};
use std::time::{Instant, SystemTime};

#[cfg(feature = "server")]
use actix_web::HttpResponse;
use diesel::deserialize::QueryableByName;
use diesel::prelude::*;
use diesel::sql_types::Text;
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, OwnedMutexGuard, RwLock};

#[cfg(feature = "server")]
use crate::api::error::service_unavailable;
use crate::domain::{Album, Artist, Song};
use crate::library::search::{SearchIndex, normalize, release_context_boost};
use crate::persistence::connection::connect;

/// Compact catalog index type.
pub type CatalogIndex = u32;

#[derive(QueryableByName)]
struct AlbumGenreRow {
    #[diesel(sql_type = Text)]
    album_id: String,
    #[diesel(sql_type = Text)]
    name: String,
}

fn load_album_genres()
-> Result<HashMap<String, Vec<String>>, Box<dyn std::error::Error + Send + Sync>> {
    let pool = connect()?;
    let mut connection = pool.get()?;
    let rows = diesel::sql_query(
        "SELECT ag.album_id, g.name
         FROM album_genre ag
         JOIN genre_entity g ON g.id = ag.genre_id
         ORDER BY g.normalized_name",
    )
    .load::<AlbumGenreRow>(&mut connection)?;
    let mut genres = HashMap::<String, Vec<String>>::new();
    for row in rows {
        genres.entry(row.album_id).or_default().push(row.name);
    }
    Ok(genres)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LibraryReadinessState {
    NoLibraryIndexed,
    Indexing,
    Ready,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LibraryEnrichmentState {
    Pending,
    Running,
    Complete,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
pub struct LibraryReadiness {
    pub state: LibraryReadinessState,
    pub message: Option<String>,
    pub enrichment: LibraryEnrichmentState,
}

impl LibraryReadiness {
    fn new(state: LibraryReadinessState, message: Option<String>) -> Self {
        Self {
            state,
            message,
            enrichment: LibraryEnrichmentState::Pending,
        }
    }
}

pub struct LibraryLifecycle {
    readiness: RwLock<LibraryReadiness>,
    cache: RwLock<Option<Arc<LibraryCache>>>,
    scan: Arc<Mutex<()>>,
    catalog_revision: AtomicU64,
}

#[derive(Serialize, Deserialize)]
pub struct LibraryCache {
    pub artists: Arc<Vec<Artist>>,
    pub search_index: SearchIndex,

    pub song_map: HashMap<String, (String, String)>,

    pub album_genres: HashMap<String, Vec<String>>,

    pub(crate) artist_positions: HashMap<String, CatalogIndex>,
    pub(crate) album_positions: HashMap<String, (CatalogIndex, CatalogIndex)>,
    pub(crate) song_positions: HashMap<String, (CatalogIndex, CatalogIndex, CatalogIndex)>,

    // Store flat IDs; song_map already owns artist and album context.
    pub songs_flat: Vec<String>,

    // Secondary indexes store IDs rather than cloned songs.
    pub songs_by_artist: HashMap<String, Vec<CatalogIndex>>,
    pub songs_by_genre: HashMap<String, Vec<CatalogIndex>>,
    // Canonical paths make artwork authorization constant-time.
    pub image_paths: HashSet<PathBuf>,
}

// Version 4 stores JSON in the existing zstd envelope.
const CATALOG_CACHE_SCHEMA_VERSION: u32 = 4;
static CACHE_PERSIST_REQUEST: AtomicU64 = AtomicU64::new(0);
static CACHE_PERSIST_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();

#[derive(Serialize, Deserialize)]
struct PersistedLibraryCache {
    schema_version: u32,
    cache: LibraryCache,
}

#[derive(Serialize)]
struct PersistedLibraryCacheRef<'a> {
    schema_version: u32,
    cache: &'a LibraryCache,
}

fn catalog_cache_directory() -> PathBuf {
    crate::settings::data_path(&["Cache", "Catalog"])
}

fn catalog_cache_candidates(directory: &std::path::Path) -> Vec<PathBuf> {
    let mut candidates = std::fs::read_dir(directory)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("catalog-") && name.ends_with(".json.zst"))
        })
        .collect::<Vec<_>>();
    candidates.sort_unstable_by(|left, right| right.file_name().cmp(&left.file_name()));
    candidates
}

fn load_persisted_cache_from(
    directory: &std::path::Path,
) -> Result<LibraryCache, Box<dyn std::error::Error + Send + Sync>> {
    let mut last_error: Option<Box<dyn std::error::Error + Send + Sync>> = None;
    for path in catalog_cache_candidates(directory) {
        let result = (|| {
            let file = std::fs::File::open(&path)?;
            let mut decoder = zstd::stream::read::Decoder::new(std::io::BufReader::new(file))?;
            let persisted: PersistedLibraryCache = serde_json::from_reader(&mut decoder)?;
            if persisted.schema_version != CATALOG_CACHE_SCHEMA_VERSION {
                return Err(std::io::Error::other("catalog cache schema changed").into());
            }
            Ok(persisted.cache)
        })();
        match result {
            Ok(cache) => return Ok(cache),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "no catalog cache is available",
        )
        .into()
    }))
}

fn persist_cache_to(
    directory: &std::path::Path,
    cache: &LibraryCache,
) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    std::fs::create_dir_all(directory)?;
    let generation = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let identity = uuid::Uuid::new_v4();
    let target = directory.join(format!("catalog-{generation:032}-{identity}.json.zst"));
    let temporary = directory.join(format!("catalog-{generation:032}-{identity}.tmp"));
    let file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    let result = (|| {
        let mut encoder = zstd::stream::write::Encoder::new(file, 1)?;
        serde_json::to_writer(
            &mut encoder,
            &PersistedLibraryCacheRef {
                schema_version: CATALOG_CACHE_SCHEMA_VERSION,
                cache,
            },
        )?;
        let encoded = encoder.finish()?;
        encoded.sync_all()?;
        std::fs::rename(&temporary, &target)?;
        // Retain one fallback generation.
        for obsolete in catalog_cache_candidates(directory).into_iter().skip(2) {
            let _ = std::fs::remove_file(obsolete);
        }
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result?;
    Ok(target)
}

impl LibraryCache {
    pub async fn load_persisted() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let started = Instant::now();
        let cache =
            tokio::task::spawn_blocking(|| load_persisted_cache_from(&catalog_cache_directory()))
                .await
                .map_err(|error| format!("Catalog cache task failed: {error}"))??;
        tracing::info!(
            cache_load_us = started.elapsed().as_micros() as u64,
            songs = cache.songs_flat.len(),
            "loaded two-generation catalog cache"
        );
        Ok(cache)
    }

    fn persist_in_background(cache: Arc<Self>) {
        let request = CACHE_PERSIST_REQUEST.fetch_add(1, Ordering::AcqRel) + 1;
        tokio::spawn(async move {
            // Coalesce publications and serialize off the interaction path.
            tokio::time::sleep(std::time::Duration::from_millis(750)).await;
            if CACHE_PERSIST_REQUEST.load(Ordering::Acquire) != request {
                return;
            }
            let songs = cache.songs_flat.len();
            let started = Instant::now();
            let persisted = tokio::task::spawn_blocking(move || {
                let _guard = CACHE_PERSIST_LOCK
                    .get_or_init(|| StdMutex::new(()))
                    .lock()
                    .map_err(|_| std::io::Error::other("catalog cache lock was poisoned"))?;
                if CACHE_PERSIST_REQUEST.load(Ordering::Acquire) != request {
                    return Ok(None);
                }
                persist_cache_to(&catalog_cache_directory(), &cache).map(Some)
            })
            .await;
            match persisted {
                Ok(Ok(Some(path))) => tracing::info!(
                    path = %path.display(),
                    songs,
                    cache_store_us = started.elapsed().as_micros() as u64,
                    "stored next catalog cache generation"
                ),
                Ok(Ok(None)) => {}
                Ok(Err(error)) => tracing::warn!(%error, "catalog cache store failed"),
                Err(error) => tracing::warn!(%error, "catalog cache store task stopped"),
            }
        });
    }

    pub async fn new() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        Self::build(true).await
    }

    pub async fn available() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        Self::build(false).await
    }

    async fn build(enriched: bool) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let lib_arc = crate::library::storage::fetch_library().await?;
        let artists_arc = Arc::clone(&lib_arc);
        // Every available batch must be searchable before enrichment.
        let search_artists = Arc::clone(&artists_arc);
        let search_index = tokio::task::spawn_blocking(move || SearchIndex::build(&search_artists))
            .await
            .map_err(|error| format!("Search index task failed: {error}"))?
            .map_err(|error| format!("Could not build library search index: {error}"))?;

        let album_count: usize = artists_arc.iter().map(|artist| artist.albums.len()).sum();
        let song_count: usize = artists_arc
            .iter()
            .flat_map(|artist| &artist.albums)
            .map(|album| album.songs.len())
            .sum();
        let mut song_map = HashMap::with_capacity(song_count);
        // Borrow catalog IDs to avoid a second allocated set.
        let mut song_release_boosts = HashMap::<&str, f32>::with_capacity(song_count);
        let mut album_genres = if enriched {
            tokio::task::spawn_blocking(load_album_genres)
                .await
                .map_err(|error| format!("Album genre task failed: {error}"))??
        } else {
            HashMap::new()
        };
        let mut songs_flat = Vec::with_capacity(song_count);
        let mut artist_positions = HashMap::with_capacity(artists_arc.len());
        let mut album_positions = HashMap::with_capacity(album_count);
        let mut song_positions = HashMap::with_capacity(song_count);
        let mut songs_by_artist: HashMap<String, Vec<CatalogIndex>> =
            HashMap::with_capacity(artists_arc.len());
        let mut songs_by_genre: HashMap<String, Vec<CatalogIndex>> = HashMap::new();
        let mut image_paths = HashSet::new();

        for (artist_index, artist) in artists_arc.iter().enumerate() {
            let artist_index = CatalogIndex::try_from(artist_index)
                .map_err(|_| "Library contains too many artists to index")?;
            artist_positions.insert(artist.id.clone(), artist_index);
            if let Ok(path) = std::fs::canonicalize(&artist.icon_url) {
                image_paths.insert(path);
            }
            let canonical_album_titles = artist
                .albums
                .iter()
                .filter(|album| {
                    crate::library::normalize::is_edition_primary_type(&album.primary_type)
                })
                .map(|album| normalize(&album.name))
                .collect::<HashSet<_>>();
            for (album_index, album) in artist.albums.iter().enumerate() {
                let album_index = CatalogIndex::try_from(album_index)
                    .map_err(|_| "Artist contains too many albums to index")?;
                album_positions.insert(album.id.clone(), (artist_index, album_index));
                if let Ok(path) = std::fs::canonicalize(&album.cover_url) {
                    image_paths.insert(path);
                }

                let genres = album_genres.entry(album.id.clone()).or_default();
                if let Some(release) = &album.release_album {
                    for g in &release.genres {
                        let name = g.name.trim();
                        if !name.is_empty() && !genres.iter().any(|genre| genre == name) {
                            genres.push(name.to_string());
                        }
                    }
                }
                if let Some(rg) = &album.release_group_album {
                    for g in &rg.genres {
                        let name = g.name.trim();
                        if !name.is_empty() && !genres.iter().any(|genre| genre == name) {
                            genres.push(name.to_string());
                        }
                    }
                }
                let release_boost = release_context_boost(
                    &album.primary_type,
                    canonical_album_titles.contains(&normalize(&album.name)),
                );
                for (song_index, song) in album.songs.iter().enumerate() {
                    let song_index = CatalogIndex::try_from(song_index)
                        .map_err(|_| "Album contains too many songs to index")?;
                    let is_preferred_occurrence = song_release_boosts
                        .get(song.id.as_str())
                        .is_none_or(|existing| release_boost >= *existing);
                    if is_preferred_occurrence {
                        song_release_boosts.insert(&song.id, release_boost);
                        song_positions
                            .insert(song.id.clone(), (artist_index, album_index, song_index));
                        song_map.insert(song.id.clone(), (artist.id.clone(), album.id.clone()));
                    }
                    let flat_index = CatalogIndex::try_from(songs_flat.len())
                        .map_err(|_| "Library contains too many songs to index")?;
                    songs_flat.push(song.id.clone());
                    songs_by_artist
                        .entry(artist.id.clone())
                        .or_default()
                        .push(flat_index);
                    for genre in album_genres.get(&album.id).into_iter().flatten() {
                        songs_by_genre
                            .entry(genre.clone())
                            .or_default()
                            .push(flat_index);
                    }
                }
            }
        }

        Ok(LibraryCache {
            artists: artists_arc,
            search_index,
            song_map,
            album_genres,
            artist_positions,
            album_positions,
            song_positions,
            songs_flat,
            songs_by_artist,
            songs_by_genre,
            image_paths,
        })
    }

    pub fn artist(&self, id: &str) -> Option<&Artist> {
        self.artist_positions
            .get(id)
            .and_then(|index| self.artists.get(*index as usize))
    }

    pub fn album(&self, id: &str) -> Option<&Album> {
        self.album_positions.get(id).and_then(|(artist, album)| {
            self.artists
                .get(*artist as usize)?
                .albums
                .get(*album as usize)
        })
    }

    pub fn album_owner(&self, id: &str) -> Option<&Artist> {
        self.album_positions
            .get(id)
            .and_then(|(artist, _)| self.artists.get(*artist as usize))
    }

    pub fn song(&self, id: &str) -> Option<&Song> {
        self.song_positions
            .get(id)
            .and_then(|(artist, album, song)| {
                self.artists
                    .get(*artist as usize)?
                    .albums
                    .get(*album as usize)?
                    .songs
                    .get(*song as usize)
            })
    }

    pub fn album_count(&self) -> usize {
        self.album_positions.len()
    }

    pub fn flat_song_id(&self, index: CatalogIndex) -> Option<&str> {
        self.songs_flat.get(index as usize).map(String::as_str)
    }
}

impl LibraryLifecycle {
    pub fn new() -> Self {
        Self {
            readiness: RwLock::new(LibraryReadiness::new(
                LibraryReadinessState::NoLibraryIndexed,
                Some("No library has been indexed yet.".to_string()),
            )),
            cache: RwLock::new(None),
            scan: Arc::new(Mutex::new(())),
            catalog_revision: AtomicU64::new(0),
        }
    }

    /// Acquires the single-flight library scan lease without waiting.
    pub fn try_begin_scan(&self) -> Option<OwnedMutexGuard<()>> {
        self.scan.clone().try_lock_owned().ok()
    }

    pub async fn set_indexing(&self, message: impl Into<String>) {
        *self.readiness.write().await =
            LibraryReadiness::new(LibraryReadinessState::Indexing, Some(message.into()));
    }

    pub async fn set_no_library(&self) {
        *self.cache.write().await = None;
        self.catalog_revision.fetch_add(1, Ordering::Release);
        *self.readiness.write().await = LibraryReadiness::new(
            LibraryReadinessState::NoLibraryIndexed,
            Some(
                "No library has been indexed yet. Complete setup or index a library first."
                    .to_string(),
            ),
        );
    }

    pub async fn set_ready(&self, cache: LibraryCache) {
        self.set_ready_with_message(cache, "Library is ready.")
            .await;
    }

    pub async fn set_ready_and_persist(&self, cache: LibraryCache) {
        let cache = Arc::new(cache);
        LibraryCache::persist_in_background(cache.clone());
        *self.cache.write().await = Some(cache);
        self.catalog_revision.fetch_add(1, Ordering::Release);
        let mut readiness = LibraryReadiness::new(
            LibraryReadinessState::Ready,
            Some("Library is ready.".into()),
        );
        readiness.enrichment = LibraryEnrichmentState::Complete;
        *self.readiness.write().await = readiness;
    }

    pub async fn set_ready_with_message(&self, cache: LibraryCache, message: impl Into<String>) {
        *self.cache.write().await = Some(Arc::new(cache));
        self.catalog_revision.fetch_add(1, Ordering::Release);
        let mut readiness =
            LibraryReadiness::new(LibraryReadinessState::Ready, Some(message.into()));
        readiness.enrichment = LibraryEnrichmentState::Complete;
        *self.readiness.write().await = readiness;
    }

    pub async fn set_available(&self, cache: LibraryCache) {
        self.set_available_with_message(
            cache,
            "Library is available; metadata enrichment is continuing.",
        )
        .await;
    }

    pub async fn set_available_with_message(
        &self,
        cache: LibraryCache,
        message: impl Into<String>,
    ) {
        *self.cache.write().await = Some(Arc::new(cache));
        self.catalog_revision.fetch_add(1, Ordering::Release);
        *self.readiness.write().await = LibraryReadiness {
            state: LibraryReadinessState::Ready,
            message: Some(message.into()),
            enrichment: LibraryEnrichmentState::Running,
        };
    }

    pub async fn set_enrichment_failed(&self, message: impl Into<String>) {
        let mut readiness = self.readiness.write().await;
        readiness.state = LibraryReadinessState::Ready;
        readiness.enrichment = LibraryEnrichmentState::Failed;
        readiness.message = Some(format!(
            "Library is available, but metadata enrichment failed. {}",
            message.into()
        ));
    }

    pub async fn set_failed(&self, message: impl Into<String>) {
        *self.cache.write().await = None;
        self.catalog_revision.fetch_add(1, Ordering::Release);
        *self.readiness.write().await =
            LibraryReadiness::new(LibraryReadinessState::Failed, Some(message.into()));
    }

    pub async fn set_scan_failed(&self, message: impl Into<String>) {
        let message = message.into();
        if self.cache.read().await.is_some() {
            let mut readiness = LibraryReadiness::new(
                LibraryReadinessState::Ready,
                Some(format!(
                    "Library refresh failed; serving the previous catalog. {message}"
                )),
            );
            readiness.enrichment = self.readiness.read().await.enrichment.clone();
            *self.readiness.write().await = readiness;
        } else {
            self.set_failed(message).await;
        }
    }

    pub async fn readiness(&self) -> LibraryReadiness {
        self.readiness.read().await.clone()
    }

    pub fn catalog_revision(&self) -> u64 {
        self.catalog_revision.load(Ordering::Acquire)
    }

    pub async fn cache(&self) -> Result<Arc<LibraryCache>, LibraryReadiness> {
        if let Some(cache) = self.cache.read().await.clone() {
            return Ok(cache);
        }

        Err(self.readiness().await)
    }
}

impl Default for LibraryLifecycle {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(feature = "server")]
pub fn library_unavailable_response(readiness: LibraryReadiness) -> HttpResponse {
    let (code, fallback_message) = match readiness.state {
        LibraryReadinessState::NoLibraryIndexed => (
            "library_setup_required",
            "No library has been indexed yet. Complete setup or index a library first.",
        ),
        LibraryReadinessState::Indexing => (
            "library_indexing",
            "The library is currently being indexed. Try again shortly.",
        ),
        LibraryReadinessState::Ready => (
            "library_cache_unavailable",
            "The library cache is not available.",
        ),
        LibraryReadinessState::Failed => (
            "library_index_failed",
            "Library indexing failed. Check the server logs and retry.",
        ),
    };

    service_unavailable(
        readiness.message.unwrap_or(fallback_message.to_string()),
        code,
    )
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};
    use std::sync::Arc;

    use super::{
        LibraryCache, LibraryEnrichmentState, LibraryLifecycle, LibraryReadinessState,
        load_persisted_cache_from, persist_cache_to,
    };
    use crate::library::search::SearchIndex;

    #[test]
    fn library_scans_are_single_flight() {
        let lifecycle = LibraryLifecycle::new();
        let first = lifecycle.try_begin_scan();
        assert!(first.is_some());
        assert!(lifecycle.try_begin_scan().is_none());
        drop(first);
        assert!(lifecycle.try_begin_scan().is_some());
    }

    fn empty_cache() -> LibraryCache {
        LibraryCache {
            artists: Arc::new(Vec::new()),
            search_index: SearchIndex::build(&[]).expect("empty search index"),
            song_map: HashMap::new(),
            album_genres: HashMap::new(),
            artist_positions: HashMap::new(),
            album_positions: HashMap::new(),
            song_positions: HashMap::new(),
            songs_flat: Vec::new(),
            songs_by_artist: HashMap::new(),
            songs_by_genre: HashMap::new(),
            image_paths: HashSet::new(),
        }
    }

    #[test]
    fn catalog_cache_keeps_two_atomic_generations_and_falls_back() {
        let directory = std::env::temp_dir().join(format!(
            "parson-catalog-cache-test-{}",
            uuid::Uuid::new_v4()
        ));
        let mut first = empty_cache();
        first.songs_flat.push("first".into());
        let first_path = persist_cache_to(&directory, &first).expect("first generation");
        let mut second = empty_cache();
        second.songs_flat.push("second".into());
        let second_path = persist_cache_to(&directory, &second).expect("second generation");

        let loaded = load_persisted_cache_from(&directory).expect("newest generation");
        assert_eq!(loaded.songs_flat, ["second"]);
        std::fs::write(second_path, b"corrupt").expect("corrupt newest generation");
        let fallback = load_persisted_cache_from(&directory).expect("previous generation");
        assert_eq!(fallback.songs_flat, ["first"]);
        assert!(first_path.exists());
        assert_eq!(super::catalog_cache_candidates(&directory).len(), 2);
        std::fs::remove_dir_all(directory).expect("catalog cache cleanup");
    }

    #[test]
    #[ignore = "one-hundred-thousand-song disk-cache benchmark"]
    fn hundred_thousand_song_cache_loads_within_interactive_budget() {
        use crate::domain::{Album, Artist, Song};
        use std::time::{Duration, Instant};

        let mut artists = Vec::with_capacity(100);
        let mut song_map = HashMap::with_capacity(100_000);
        let mut artist_positions = HashMap::with_capacity(100);
        let mut album_positions = HashMap::with_capacity(1_000);
        let mut song_positions = HashMap::with_capacity(100_000);
        let mut songs_flat = Vec::with_capacity(100_000);
        let mut songs_by_artist = HashMap::with_capacity(100);
        for artist_index in 0..100_u32 {
            let artist_id = format!("artist-{artist_index}");
            artist_positions.insert(artist_id.clone(), artist_index);
            let mut albums = Vec::with_capacity(10);
            for album_index in 0..10_u32 {
                let album_id = format!("album-{artist_index}-{album_index}");
                album_positions.insert(album_id.clone(), (artist_index, album_index));
                let mut songs = Vec::with_capacity(100);
                for song_index in 0..100_u32 {
                    let song_id = format!("song-{artist_index}-{album_index}-{song_index}");
                    let flat_index = songs_flat.len() as u32;
                    songs_flat.push(song_id.clone());
                    songs_by_artist
                        .entry(artist_id.clone())
                        .or_insert_with(Vec::new)
                        .push(flat_index);
                    song_map.insert(song_id.clone(), (artist_id.clone(), album_id.clone()));
                    song_positions.insert(song_id.clone(), (artist_index, album_index, song_index));
                    songs.push(Song {
                        id: song_id,
                        name: format!("Track {song_index}"),
                        artist: format!("Artist {artist_index}"),
                        path: format!("/library/{artist_index}/{album_index}/{song_index}.flac"),
                        ..Song::default()
                    });
                }
                albums.push(Album {
                    id: album_id,
                    name: format!("Album {album_index}"),
                    songs,
                    primary_type: "album".into(),
                    ..Album::default()
                });
            }
            artists.push(Artist {
                id: artist_id,
                name: format!("Artist {artist_index}"),
                albums,
                ..Artist::default()
            });
        }
        let artists = Arc::new(artists);
        let search_index = SearchIndex::build(&artists).expect("100k search index");
        let cache = LibraryCache {
            artists,
            search_index,
            song_map,
            album_genres: HashMap::new(),
            artist_positions,
            album_positions,
            song_positions,
            songs_flat,
            songs_by_artist,
            songs_by_genre: HashMap::new(),
            image_paths: HashSet::new(),
        };
        let directory = std::env::temp_dir().join(format!(
            "parson-100k-cache-benchmark-{}",
            uuid::Uuid::new_v4()
        ));
        let store_started = Instant::now();
        let path = persist_cache_to(&directory, &cache).expect("persist 100k cache");
        let store_elapsed = store_started.elapsed();
        let load_started = Instant::now();
        let loaded = load_persisted_cache_from(&directory).expect("load 100k cache");
        let load_elapsed = load_started.elapsed();
        eprintln!(
            "100k cache: {} bytes, store={store_elapsed:?}, load={load_elapsed:?}",
            std::fs::metadata(path).expect("cache metadata").len()
        );
        assert_eq!(loaded.songs_flat.len(), 100_000);
        assert!(load_elapsed < Duration::from_secs(1));
        std::fs::remove_dir_all(directory).expect("100k cache cleanup");
    }

    #[actix_web::test]
    async fn available_library_is_readable_before_enrichment_finishes() {
        let lifecycle = LibraryLifecycle::new();
        lifecycle.set_available(empty_cache()).await;

        let readiness = lifecycle.readiness().await;
        assert_eq!(readiness.state, LibraryReadinessState::Ready);
        assert_eq!(readiness.enrichment, LibraryEnrichmentState::Running);
        assert!(lifecycle.cache().await.is_ok());

        lifecycle
            .set_enrichment_failed("provider unavailable")
            .await;
        let readiness = lifecycle.readiness().await;
        assert_eq!(readiness.state, LibraryReadinessState::Ready);
        assert_eq!(readiness.enrichment, LibraryEnrichmentState::Failed);
        assert!(lifecycle.cache().await.is_ok());
    }

    #[actix_web::test]
    async fn catalog_revision_changes_only_when_the_visible_catalog_changes() {
        let lifecycle = LibraryLifecycle::new();
        assert_eq!(lifecycle.catalog_revision(), 0);
        lifecycle.set_indexing("scanning").await;
        assert_eq!(lifecycle.catalog_revision(), 0);
        lifecycle.set_available(empty_cache()).await;
        assert_eq!(lifecycle.catalog_revision(), 1);
        lifecycle
            .set_enrichment_failed("metadata unavailable")
            .await;
        assert_eq!(lifecycle.catalog_revision(), 1);
        lifecycle.set_ready(empty_cache()).await;
        assert_eq!(lifecycle.catalog_revision(), 2);
    }

    #[actix_web::test]
    async fn failed_refreshes_keep_the_last_known_good_cache_available() {
        let lifecycle = LibraryLifecycle::new();
        lifecycle.set_ready(empty_cache()).await;

        lifecycle.set_scan_failed("temporary drive failure").await;

        assert_eq!(
            lifecycle.readiness().await.state,
            LibraryReadinessState::Ready
        );
        assert!(lifecycle.cache().await.is_ok());
    }

    #[actix_web::test]
    async fn initial_scan_failures_remain_failed_without_a_previous_cache() {
        let lifecycle = LibraryLifecycle::new();
        lifecycle.set_scan_failed("initial failure").await;
        assert_eq!(
            lifecycle.readiness().await.state,
            LibraryReadinessState::Failed
        );
        assert!(lifecycle.cache().await.is_err());
    }

    #[actix_web::test]
    async fn lifecycle_transitions_clear_stale_cache_on_terminal_states() {
        let lifecycle = LibraryLifecycle::new();
        lifecycle.set_indexing("scanning").await;
        assert_eq!(
            lifecycle.readiness().await.state,
            LibraryReadinessState::Indexing
        );
        lifecycle.set_failed("drive unavailable").await;
        assert_eq!(
            lifecycle.readiness().await.state,
            LibraryReadinessState::Failed
        );
        assert!(lifecycle.cache().await.is_err());
        lifecycle.set_no_library().await;
        assert_eq!(
            lifecycle.readiness().await.state,
            LibraryReadinessState::NoLibraryIndexed
        );
    }

    #[actix_web::test]
    async fn unavailable_responses_expose_stable_state_specific_codes() {
        use super::{LibraryReadiness, library_unavailable_response};
        use actix_web::body::to_bytes;
        use serde_json::Value;

        for (state, code) in [
            (
                LibraryReadinessState::NoLibraryIndexed,
                "library_setup_required",
            ),
            (LibraryReadinessState::Indexing, "library_indexing"),
            (LibraryReadinessState::Ready, "library_cache_unavailable"),
            (LibraryReadinessState::Failed, "library_index_failed"),
        ] {
            let response = library_unavailable_response(LibraryReadiness {
                state,
                message: None,
                enrichment: super::LibraryEnrichmentState::Pending,
            });
            assert_eq!(
                response.status(),
                actix_web::http::StatusCode::SERVICE_UNAVAILABLE
            );
            let body: Value =
                serde_json::from_slice(&to_bytes(response.into_body()).await.unwrap()).unwrap();
            assert_eq!(body["code"], code);
        }
    }
}
