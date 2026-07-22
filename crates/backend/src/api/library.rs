use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::Instant;
use std::time::{Duration, SystemTime};

use actix_web::http::header;
use actix_web::{HttpRequest, HttpResponse, Responder, get, head, post, web};
use diesel::RunQueryDsl;
use diesel::deserialize::QueryableByName;
use diesel::sql_types::Text;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::{Mutex, Semaphore};
use tokio_util::io::ReaderStream;
use tracing::{error, info, warn};

use crate::api::error::{
    bad_request, conflict, forbidden, internal_server_error, not_found, range_not_satisfiable,
    service_unavailable,
};
use crate::domain::Artist;

const MAX_CONCURRENT_TRANSCODES: usize = 4;
const DEFAULT_TRANSCODE_CACHE_MAX_BYTES: u64 = 10 * 1024 * 1024 * 1024;
static TRANSCODE_SLOTS: OnceLock<Arc<Semaphore>> = OnceLock::new();
static TRANSCODE_CACHE_LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();

fn transcode_slots() -> Arc<Semaphore> {
    TRANSCODE_SLOTS
        .get_or_init(|| Arc::new(Semaphore::new(MAX_CONCURRENT_TRANSCODES)))
        .clone()
}

fn transcode_cache_locks() -> &'static Mutex<HashMap<PathBuf, Arc<Mutex<()>>>> {
    TRANSCODE_CACHE_LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct TranscodeCleanup {
    cache_lock: Arc<Mutex<()>>,
    cache_path: PathBuf,
    committed: bool,
    temp_path: PathBuf,
}

impl Drop for TranscodeCleanup {
    fn drop(&mut self) {
        let cache_lock = self.cache_lock.clone();
        let cache_path = self.cache_path.clone();
        let temp_path = (!self.committed).then(|| self.temp_path.clone());
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                if let Some(temp_path) = temp_path {
                    let _ = tokio::fs::remove_file(temp_path).await;
                }
                release_transcode_lock(&cache_path, &cache_lock).await;
            });
        } else if let Some(temp_path) = temp_path {
            let _ = std::fs::remove_file(temp_path);
        }
    }
}

fn transcode_cache_max_bytes() -> u64 {
    std::env::var("PARSON_TRANSCODE_CACHE_MAX_BYTES")
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_TRANSCODE_CACHE_MAX_BYTES)
}

fn prune_transcode_cache(
    directory: &Path,
    protected: &Path,
    max_bytes: u64,
    minimum_age: Duration,
) -> std::io::Result<()> {
    let now = SystemTime::now();
    let mut files = Vec::new();
    let mut total = 0u64;
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(metadata) if metadata.is_file() => metadata,
            _ => continue,
        };
        if path.extension().and_then(|value| value.to_str()) == Some("tmp") {
            if metadata
                .modified()
                .ok()
                .and_then(|modified| now.duration_since(modified).ok())
                .is_some_and(|age| age > Duration::from_secs(60 * 60))
            {
                let _ = std::fs::remove_file(path);
            }
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) != Some("mp3") {
            continue;
        }
        total = total.saturating_add(metadata.len());
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if now.duration_since(modified).unwrap_or_default() >= minimum_age {
            files.push((modified, path, metadata.len()));
        }
    }
    files.sort_by_key(|(modified, path, _)| (*modified, path.clone()));
    for (_, path, size) in files {
        if total <= max_bytes {
            break;
        }
        if path == protected {
            continue;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
    Ok(())
}
use crate::app::LocalApp;
use crate::library::indexer::{
    CatalogProgressSender, build_instant_library_preview,
    enrich_library_to_database_with_cancellation, hydrate_progressive_catalog_artwork,
    index_available_library_to_database,
    index_available_library_to_database_progressive_with_cancellation, index_library_to_database,
    repair_library_database_with_cancellation,
};
use crate::library::normalize::{LibraryIndexReport, normalize_library_data};
use crate::library::state::{
    LibraryCache, LibraryLifecycle, LibraryScanLease, library_unavailable_response,
};
use crate::library::storage::{
    fetch_library, get_libraries_config_path, refresh_cache, store_library,
};
use crate::persistence::connection::DbPool;

pub struct ProcessedLibrary {
    report: LibraryIndexReport,
}

#[derive(Serialize, Debug)]
pub struct LibraryRefreshSuccess {
    path: String,
    report: LibraryIndexReport,
}

#[derive(Serialize, Debug)]
pub struct LibraryRefreshFailure {
    path: String,
    message: String,
}

#[derive(Serialize, Debug)]
pub struct LibraryRefreshResult {
    refreshed: Vec<LibraryRefreshSuccess>,
    failures: Vec<LibraryRefreshFailure>,
}

fn classify_refresh_result(
    refreshed: Vec<LibraryRefreshSuccess>,
    failures: Vec<LibraryRefreshFailure>,
) -> Result<LibraryRefreshResult, std::io::Error> {
    if refreshed.is_empty() && !failures.is_empty() {
        return Err(std::io::Error::other(format!(
            "No libraries were refreshed. Failures: {}",
            failures
                .iter()
                .map(|failure| format!("{}: {}", failure.path, failure.message))
                .collect::<Vec<_>>()
                .join("; ")
        )));
    }
    Ok(LibraryRefreshResult {
        refreshed,
        failures,
    })
}

struct ScanFailure {
    message: String,
    code: &'static str,
}

impl ScanFailure {
    fn new(message: impl Into<String>, code: &'static str) -> Self {
        Self {
            message: message.into(),
            code,
        }
    }
}

fn merge_progressive_catalog(mut progress: Vec<Artist>, seed: &[Artist]) -> Vec<Artist> {
    let mut artist_positions = progress
        .iter()
        .enumerate()
        .map(|(position, artist)| (artist.id.clone(), position))
        .collect::<HashMap<_, _>>();
    for seed_artist in seed {
        let Some(artist_index) = artist_positions.get(&seed_artist.id).copied() else {
            artist_positions.insert(seed_artist.id.clone(), progress.len());
            progress.push(seed_artist.clone());
            continue;
        };
        let artist = &mut progress[artist_index];
        if artist.icon_url.is_empty() {
            artist.icon_url.clone_from(&seed_artist.icon_url);
        }
        let mut album_positions = artist
            .albums
            .iter()
            .enumerate()
            .map(|(position, album)| (album.id.clone(), position))
            .collect::<HashMap<_, _>>();
        for seed_album in &seed_artist.albums {
            if let Some(album_index) = album_positions.get(&seed_album.id).copied() {
                let album = &mut artist.albums[album_index];
                if album.cover_url.is_empty() {
                    album.cover_url.clone_from(&seed_album.cover_url);
                }
                let mut song_ids = album
                    .songs
                    .iter()
                    .map(|song| song.id.clone())
                    .collect::<HashSet<_>>();
                for seed_song in &seed_album.songs {
                    if song_ids.insert(seed_song.id.clone()) {
                        album.songs.push(seed_song.clone());
                    }
                }
                album.songs.sort_unstable_by(|left, right| {
                    left.track_number
                        .cmp(&right.track_number)
                        .then(left.name.cmp(&right.name))
                });
            } else {
                album_positions.insert(seed_album.id.clone(), artist.albums.len());
                artist.albums.push(seed_album.clone());
            }
        }
    }
    progress
}

/// Progressive batches represent large scans. Publish only presentation-ready
/// albums there; the bounded instant preview remains visible as a fallback
/// until at least one album with artwork is available.
fn retain_progressive_albums_with_artwork(catalog: &mut Vec<Artist>) -> bool {
    for artist in catalog.iter_mut() {
        artist
            .albums
            .retain(|album| !album.cover_url.trim().is_empty());
    }
    catalog.retain(|artist| !artist.albums.is_empty());
    !catalog.is_empty()
}

async fn run_index_scan(
    path: String,
    lifecycle: web::Data<LibraryLifecycle>,
    scan_lease: LibraryScanLease,
) -> Result<LibraryIndexReport, ScanFailure> {
    let cancellation = scan_lease.cancellation();
    lifecycle.set_indexing("Preparing your first albums.").await;
    let result = async {
        let preview_path = path.clone();
        let (mut preview, preview_report) =
            tokio::task::spawn_blocking(move || build_instant_library_preview(&preview_path))
                .await
                .map_err(|error| {
                    ScanFailure::new(
                        format!("Instant library task stopped unexpectedly: {error}"),
                        "library_index_failed",
                    )
                })?
                .map_err(|error| {
                    ScanFailure::new(
                        format!("Failed to process library: {error:?}"),
                        "library_index_failed",
                    )
                })?;
        if cancellation.is_cancelled() {
            return Err(ScanFailure::new(
                "Library scan was replaced by a newer folder selection.",
                "library_scan_replaced",
            ));
        }
        normalize_library_data(&mut preview);
        store_library(preview).await;
        let preview_cache = LibraryCache::available().await.map_err(|error| {
            ScanFailure::new(
                format!("Failed to build instant library cache: {error}"),
                "library_cache_build_failed",
            )
        })?;
        lifecycle
            .set_available_with_message(
                preview_cache,
                "Your library is ready. Adding the rest in the background…",
            )
            .await;
        if let Err(error) = save_library_path(&path).await {
            error!(%error, path = %path, "failed to mirror library root to JSON config");
        }

        // Return after the preview is searchable; complete the scan in background.
        let background_lifecycle = lifecycle.clone();
        let background_path = path.clone();
        tokio::spawn(async move {
            let _scan_lease = scan_lease;
            let (progress_sender, mut progress_receiver) =
                tokio::sync::mpsc::channel::<Vec<Artist>>(1);
            let publication_lifecycle = background_lifecycle.clone();
            let publication_cancellation = cancellation.clone();
            let publisher = tokio::spawn(async move {
                while let Some(mut batch) = progress_receiver.recv().await {
                    if publication_cancellation.is_cancelled() {
                        break;
                    }
                    batch = match tokio::task::spawn_blocking(move || {
                        hydrate_progressive_catalog_artwork(&mut batch);
                        batch
                    })
                    .await
                    {
                        Ok(batch) => batch,
                        Err(error) => {
                            tracing::warn!(%error, "progressive artwork task stopped unexpectedly");
                            continue;
                        }
                    };
                    let seed = fetch_library().await.ok();
                    let mut catalog = seed
                        .as_deref()
                        .map_or(batch.clone(), |seed| merge_progressive_catalog(batch, seed));
                    if !retain_progressive_albums_with_artwork(&mut catalog) {
                        continue;
                    }
                    store_library(catalog).await;
                    match LibraryCache::available().await {
                        Ok(cache) => {
                            let songs = cache.songs_flat.len();
                            publication_lifecycle
                                .set_available_with_message(
                                    cache,
                                    format!("Your library is ready. Added {songs} songs so far…"),
                                )
                                .await
                        }
                        Err(error) => {
                            tracing::warn!(%error, "progressive catalog publication failed")
                        }
                    }
                }
            });
            match process_available_library_progressive_with_cancellation(
                &background_path,
                progress_sender,
                cancellation.clone(),
            )
            .await
            {
                Ok(_) => {
                    let _ = publisher.await;
                    if cancellation.is_cancelled() {
                        return;
                    }
                    // Re-read SQLite after draining a partial-publication race.
                    refresh_cache().await;
                    match LibraryCache::available().await {
                        Ok(cache) if !cancellation.is_cancelled() => {
                            background_lifecycle.set_available(cache).await
                        }
                        Ok(_) => return,
                        Err(error) => {
                            background_lifecycle
                                .set_enrichment_failed(error.to_string())
                                .await;
                            return;
                        }
                    }
                }
                Err(error) => {
                    publisher.abort();
                    if cancellation.is_cancelled() {
                        return;
                    }
                    background_lifecycle
                        .set_enrichment_failed(error.to_string())
                        .await;
                    return;
                }
            }
            match process_enriched_library_with_cancellation(&background_path, cancellation.clone())
                .await
            {
                Ok(_) if !cancellation.is_cancelled() => match LibraryCache::new().await {
                    Ok(cache) if !cancellation.is_cancelled() => {
                        background_lifecycle.set_ready_and_persist(cache).await
                    }
                    Ok(_) => (),
                    Err(error) => {
                        background_lifecycle
                            .set_enrichment_failed(error.to_string())
                            .await
                    }
                },
                Ok(_) => (),
                Err(error) => {
                    if cancellation.is_cancelled() {
                        return;
                    }
                    background_lifecycle
                        .set_enrichment_failed(error.to_string())
                        .await
                }
            }
        });
        Ok::<_, ScanFailure>(preview_report)
    }
    .await;
    if let Err(failure) = &result
        && failure.code != "library_scan_replaced"
    {
        error!(message = %failure.message, "library index failed");
        lifecycle.set_scan_failed(&failure.message).await;
    }
    result
}

async fn run_refresh_scan(
    lifecycle: web::Data<LibraryLifecycle>,
    scan_lease: LibraryScanLease,
    scan_message: &'static str,
) -> Result<LibraryRefreshResult, ScanFailure> {
    let cancellation = scan_lease.cancellation();
    lifecycle.set_indexing(scan_message).await;
    let result = async {
        refresh_libraries_with(false, false, Some(cancellation.clone()))
            .await
            .map_err(|error| {
                ScanFailure::new(
                    format!("Failed to refresh libraries: {error}"),
                    "library_refresh_failed",
                )
            })?;
        if cancellation.is_cancelled() {
            return Err(ScanFailure::new(
                "Library refresh was replaced by a newer folder selection.",
                "library_scan_replaced",
            ));
        }
        let cache = LibraryCache::available().await.map_err(|error| {
            ScanFailure::new(
                format!("Failed to build library cache: {error}"),
                "library_cache_build_failed",
            )
        })?;
        lifecycle.set_available(cache).await;
        let _scan_lease = scan_lease;
        let enriched = refresh_libraries_with(true, true, Some(cancellation.clone()))
            .await
            .map_err(|error| {
                ScanFailure::new(
                    format!("Failed to refresh library artwork and metadata: {error}"),
                    "library_refresh_failed",
                )
            })?;
        let cache = LibraryCache::new().await.map_err(|error| {
            ScanFailure::new(
                format!("Failed to build library cache: {error}"),
                "library_cache_build_failed",
            )
        })?;
        if enriched.failures.is_empty() {
            lifecycle.set_ready_and_persist(cache).await;
        } else {
            lifecycle
                .set_ready_with_message(
                    cache,
                    format!(
                        "Library refresh completed with {} failed root(s).",
                        enriched.failures.len()
                    ),
                )
                .await;
        }
        Ok::<_, ScanFailure>(enriched)
    }
    .await;
    if let Err(failure) = &result
        && failure.code != "library_scan_replaced"
    {
        error!(message = %failure.message, "library refresh failed");
        lifecycle.set_scan_failed(&failure.message).await;
    }
    result
}

async fn run_automatic_refresh_scan(
    lifecycle: Arc<LibraryLifecycle>,
    scan_lease: LibraryScanLease,
) -> Result<LibraryRefreshResult, ScanFailure> {
    let cancellation = scan_lease.cancellation();
    let _scan_lease = scan_lease;
    lifecycle.set_indexing("Adding newly detected music.").await;
    let result = match refresh_libraries_with(true, false, Some(cancellation.clone())).await {
        Ok(result) => match LibraryCache::new().await {
            Ok(cache) if result.failures.is_empty() => {
                lifecycle
                    .set_ready_with_message(cache, "New music was added automatically.")
                    .await;
                Ok(result)
            }
            Ok(cache) => {
                lifecycle
                    .set_ready_with_message(
                        cache,
                        format!(
                            "New music was added; {} library root(s) could not be refreshed.",
                            result.failures.len()
                        ),
                    )
                    .await;
                Ok(result)
            }
            Err(error) => Err(ScanFailure::new(
                format!("Automatic refresh completed but the cache could not be rebuilt: {error}"),
                "library_cache_build_failed",
            )),
        },
        Err(error) => Err(ScanFailure::new(
            format!("Failed to automatically refresh libraries: {error}"),
            "library_auto_refresh_failed",
        )),
    };
    if let Err(failure) = &result
        && !cancellation.is_cancelled()
    {
        lifecycle.set_scan_failed(&failure.message).await;
    }
    result
}

const AUTO_REFRESH_POLL_MS: u64 = 250;
const AUTO_REFRESH_ROOT_RELOAD_SECS: u64 = 5;
const AUTO_REFRESH_MIN_SCAN_INTERVAL_SECS: u64 = 10;
const AUTO_REFRESH_RETRY_SECS: u64 = 30;
const AUTO_REFRESH_FALLBACK_INITIAL_SECS: u64 = 60;
const AUTO_REFRESH_FALLBACK_MAX_SECS: u64 = 15 * 60;

fn auto_refresh_duration(name: &str, default: Duration) -> Duration {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map(Duration::from_millis)
        .unwrap_or(default)
}

fn select_auto_refresh_quiet_window(
    path_events: usize,
    overflowed: bool,
    single_file: Duration,
    album_copy: Duration,
    large_copy: Duration,
) -> Duration {
    if overflowed || path_events > 256 {
        large_copy
    } else if path_events > 8 {
        album_copy
    } else {
        single_file
    }
}

fn auto_refresh_quiet_window(path_events: usize, overflowed: bool) -> Duration {
    select_auto_refresh_quiet_window(
        path_events,
        overflowed,
        auto_refresh_duration("PARSON_AUTO_REFRESH_QUIET_MS", Duration::from_millis(1_500)),
        auto_refresh_duration("PARSON_AUTO_REFRESH_ALBUM_QUIET_MS", Duration::from_secs(4)),
        auto_refresh_duration("PARSON_AUTO_REFRESH_LARGE_QUIET_MS", Duration::from_secs(8)),
    )
}

fn automatic_change_is_settled(
    now: Instant,
    latest_change: Option<Instant>,
    path_events: usize,
    overflowed: bool,
) -> bool {
    latest_change.is_some_and(|changed| {
        now.saturating_duration_since(changed) >= auto_refresh_quiet_window(path_events, overflowed)
    })
}

/// Watches roots and coalesces changes for incremental discovery.
pub(crate) fn start_automatic_library_refresh(lifecycle: Arc<LibraryLifecycle>) {
    tokio::spawn(async move {
        let poll = auto_refresh_duration(
            "PARSON_AUTO_REFRESH_POLL_MS",
            Duration::from_millis(AUTO_REFRESH_POLL_MS),
        )
        .max(Duration::from_millis(50));
        let root_reload = auto_refresh_duration(
            "PARSON_AUTO_REFRESH_ROOT_RELOAD_MS",
            Duration::from_secs(AUTO_REFRESH_ROOT_RELOAD_SECS),
        )
        .max(Duration::from_secs(1));
        let min_scan_interval = auto_refresh_duration(
            "PARSON_AUTO_REFRESH_MIN_SCAN_INTERVAL_MS",
            Duration::from_secs(AUTO_REFRESH_MIN_SCAN_INTERVAL_SECS),
        );
        let retry_interval = auto_refresh_duration(
            "PARSON_AUTO_REFRESH_RETRY_MS",
            Duration::from_secs(AUTO_REFRESH_RETRY_SECS),
        );
        let fallback_initial = auto_refresh_duration(
            "PARSON_AUTO_REFRESH_FALLBACK_INITIAL_MS",
            Duration::from_secs(AUTO_REFRESH_FALLBACK_INITIAL_SECS),
        );
        let fallback_max = auto_refresh_duration(
            "PARSON_AUTO_REFRESH_FALLBACK_MAX_MS",
            Duration::from_secs(AUTO_REFRESH_FALLBACK_MAX_SECS),
        )
        .max(fallback_initial);
        let new_file_minimum_age = auto_refresh_duration(
            "PARSON_AUTO_REFRESH_NEW_FILE_MIN_AGE_MS",
            Duration::from_secs(5),
        );
        let mut ticker = tokio::time::interval(poll);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut roots = Vec::<PathBuf>::new();
        let mut next_root_reload = Instant::now();
        let mut last_scan_started = None::<Instant>;
        let mut retry_at = None::<Instant>;
        let mut fallback_interval = fallback_initial;
        let mut fallback_at = Instant::now() + fallback_initial;

        loop {
            ticker.tick().await;
            let now = Instant::now();
            if now >= next_root_reload {
                let configured = read_library_paths().await;
                let mut refreshed_roots = Vec::with_capacity(configured.len());
                for path in configured {
                    let path = PathBuf::from(path);
                    let canonical = tokio::fs::canonicalize(&path).await.unwrap_or(path);
                    if canonical.is_dir() {
                        crate::library::discovery::ensure_incremental_watcher(&canonical);
                        refreshed_roots.push(canonical);
                    }
                }
                refreshed_roots.sort_unstable();
                refreshed_roots.dedup();
                roots = refreshed_roots;
                next_root_reload = now + root_reload;
            }
            if roots.is_empty() {
                continue;
            }

            let mut event_count = 0_usize;
            let mut overflowed = false;
            let mut latest_change = None::<Instant>;
            let mut watcher_missing = false;
            let mut youngest_new_audio = None::<Duration>;
            for root in &roots {
                let Some(stats) = crate::library::discovery::pending_change_stats(root) else {
                    continue;
                };
                event_count = event_count.saturating_add(stats.path_events);
                overflowed |= stats.overflowed;
                watcher_missing |= !stats.watcher_active;
                latest_change = match (latest_change, stats.last_change) {
                    (Some(left), Some(right)) => Some(left.max(right)),
                    (None, right) => right,
                    (left, None) => left,
                };
                if let Some(age) = crate::library::discovery::youngest_pending_new_audio_age(root) {
                    youngest_new_audio =
                        Some(youngest_new_audio.map_or(age, |known| known.min(age)));
                }
            }

            let retry_due = retry_at.is_some_and(|deadline| now >= deadline);
            let fallback_due = watcher_missing && now >= fallback_at;
            let changes_settled =
                automatic_change_is_settled(now, latest_change, event_count, overflowed);
            if !retry_due && !fallback_due && !changes_settled {
                continue;
            }
            if !retry_due
                && !fallback_due
                && youngest_new_audio.is_some_and(|age| age < new_file_minimum_age)
            {
                continue;
            }
            if last_scan_started
                .is_some_and(|started| now.saturating_duration_since(started) < min_scan_interval)
            {
                continue;
            }
            let Some(scan_lease) = lifecycle.try_begin_scan() else {
                continue;
            };
            last_scan_started = Some(now);
            let reason = if retry_due {
                "retry"
            } else if fallback_due {
                "fallback_reconciliation"
            } else if overflowed {
                "notification_overflow"
            } else {
                "filesystem_change"
            };
            info!(
                reason,
                event_count,
                roots = roots.len(),
                "automatic library refresh started"
            );
            match run_automatic_refresh_scan(lifecycle.clone(), scan_lease).await {
                Ok(result) => {
                    let failed_roots = result.failures.len();
                    retry_at = (failed_roots > 0).then(|| Instant::now() + retry_interval);
                    let indexed_files = result
                        .refreshed
                        .iter()
                        .map(|success| success.report.indexed_files)
                        .sum::<usize>();
                    if fallback_due {
                        fallback_interval = if indexed_files > 0 {
                            fallback_initial
                        } else {
                            fallback_interval.saturating_mul(2).min(fallback_max)
                        };
                    }
                    fallback_at = Instant::now() + fallback_interval;
                    info!(
                        reason,
                        indexed_files, failed_roots, "automatic library refresh published"
                    );
                }
                Err(failure) => {
                    retry_at = Some(Instant::now() + retry_interval);
                    warn!(reason, message = %failure.message, "automatic library refresh will retry");
                }
            }
        }
    });
}

#[get("/status")]
pub async fn library_readiness(lifecycle: web::Data<LibraryLifecycle>) -> impl Responder {
    let readiness = lifecycle.readiness().await;
    let setup_required =
        readiness.state == crate::library::state::LibraryReadinessState::NoLibraryIndexed;

    HttpResponse::Ok().json(serde_json::json!({
        "state": readiness.state,
        "message": readiness.message,
        "enrichment": readiness.enrichment,
        "catalog_revision": lifecycle.catalog_revision(),
        "setup_required": setup_required,
    }))
}

#[derive(Serialize)]
pub struct LibraryRootResponse {
    path: String,
}

#[get("/roots")]
pub async fn library_roots() -> impl Responder {
    HttpResponse::Ok().json(
        read_library_paths()
            .await
            .into_iter()
            .map(|path| LibraryRootResponse { path })
            .collect::<Vec<_>>(),
    )
}

#[derive(Deserialize)]
pub struct CatalogQuery {
    pub offset: Option<usize>,
    pub limit: Option<usize>,
    pub section: Option<String>,
}

#[get("")]
pub async fn library_catalog(
    lifecycle: web::Data<LibraryLifecycle>,
    pool: web::Data<DbPool>,
    query: web::Query<CatalogQuery>,
) -> impl Responder {
    let app = LocalApp {
        database: pool.get_ref().clone(),
        library: lifecycle.into_inner(),
    };
    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(50);
    let result = match query.section.as_deref() {
        Some("albums") => app.catalog_albums(offset, limit).await,
        Some("songs") => app.catalog_songs(offset, limit).await,
        Some(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "invalid_catalog_section"
            }));
        }
        None => app.catalog(offset, limit).await,
    };
    match result {
        Ok(catalog) => HttpResponse::Ok().json(catalog),
        Err(error) => service_unavailable(error.to_string(), "library_catalog_unavailable"),
    }
}

#[get("/artists")]
pub async fn library_catalog_artists(
    lifecycle: web::Data<LibraryLifecycle>,
    pool: web::Data<DbPool>,
    query: web::Query<CatalogQuery>,
) -> impl Responder {
    let app = LocalApp {
        database: pool.get_ref().clone(),
        library: lifecycle.into_inner(),
    };
    match app
        .artists(query.offset.unwrap_or(0), query.limit.unwrap_or(50))
        .await
    {
        Ok(artists) => HttpResponse::Ok().json(artists),
        Err(error) => service_unavailable(error.to_string(), "library_artists_unavailable"),
    }
}

async fn process_music_library(
    path: &str,
) -> Result<ProcessedLibrary, Box<dyn std::error::Error + Send + Sync>> {
    process_library_with(path, index_library_to_database).await
}

async fn process_available_library(
    path: &str,
) -> Result<ProcessedLibrary, Box<dyn std::error::Error + Send + Sync>> {
    process_library_with(path, index_available_library_to_database).await
}

async fn process_available_library_with_cancellation(
    path: &str,
    cancellation: crate::library::indexer::ScanCancellation,
) -> Result<ProcessedLibrary, Box<dyn std::error::Error + Send + Sync>> {
    process_library_with(path, move |path| {
        crate::library::indexer::index_available_library_to_database_with_cancellation(
            path,
            &cancellation,
        )
    })
    .await
}

async fn process_available_library_progressive_with_cancellation(
    path: &str,
    progress: CatalogProgressSender,
    cancellation: crate::library::indexer::ScanCancellation,
) -> Result<ProcessedLibrary, Box<dyn std::error::Error + Send + Sync>> {
    process_library_with(path, move |path| {
        index_available_library_to_database_progressive_with_cancellation(
            path,
            progress,
            &cancellation,
        )
    })
    .await
}

async fn process_enriched_library_with_cancellation(
    path: &str,
    cancellation: crate::library::indexer::ScanCancellation,
) -> Result<ProcessedLibrary, Box<dyn std::error::Error + Send + Sync>> {
    process_library_with(path, move |path| {
        enrich_library_to_database_with_cancellation(path, &cancellation)
    })
    .await
}

async fn process_repaired_library_with_cancellation(
    path: &str,
    cancellation: crate::library::indexer::ScanCancellation,
) -> Result<ProcessedLibrary, Box<dyn std::error::Error + Send + Sync>> {
    process_library_with(path, move |path| {
        repair_library_database_with_cancellation(path, &cancellation)
    })
    .await
}

async fn process_library_with<F>(
    path: &str,
    indexer: F,
) -> Result<ProcessedLibrary, Box<dyn std::error::Error + Send + Sync>>
where
    F: FnOnce(
            &str,
        ) -> Result<
            (Vec<crate::domain::Artist>, LibraryIndexReport),
            Box<dyn std::error::Error + Send + Sync>,
        > + Send
        + 'static,
{
    let now = Instant::now();
    let path = path.to_owned();
    // Keep blocking library scans off Actix/Tokio workers.
    let (final_data, mut report) = tokio::task::spawn_blocking(move || {
        let (mut final_data, mut report) = indexer(&path)?;
        let normalization_started = Instant::now();
        normalize_library_data(&mut final_data);
        report.timing.normalization_inference_us =
            report.timing.normalization_inference_us.saturating_add(
                normalization_started
                    .elapsed()
                    .as_micros()
                    .min(u128::from(u64::MAX)) as u64,
            );
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>((final_data, report))
    })
    .await
    .map_err(|error| std::io::Error::other(format!("Library index task failed: {error}")))??;

    let elapsed = now.elapsed();
    report.timing.total_us = elapsed.as_micros().min(u128::from(u64::MAX)) as u64;
    let finished_log = format!(
        "Finished Indexing Library in {} seconds ({} indexed, {} skipped, {} warnings)",
        elapsed.as_secs(),
        report.indexed_files,
        report.skipped_files,
        report.warnings.len()
    );
    info!(finished_log);
    info!(
        run_kind = report.timing.run_kind.as_str(),
        total_us = elapsed.as_micros().min(u128::from(u64::MAX)) as u64,
        normalization_inference_us = report.timing.normalization_inference_us,
        "library request total timing"
    );

    if report.scanned_files == 0 {
        return Err(
            std::io::Error::other("The selected folder contains no supported audio files").into(),
        );
    }

    store_library(final_data).await;
    Ok(ProcessedLibrary { report })
}

#[derive(Deserialize)]
pub struct LibraryIndexRequest {
    path: String,
}

#[post("")]
pub async fn index(
    request: web::Json<LibraryIndexRequest>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    index_library(request, lifecycle).await
}

pub async fn index_library(
    request: web::Json<LibraryIndexRequest>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let requested_path = request.path.trim();
    if requested_path.is_empty() {
        return bad_request("Library path cannot be empty.", "library_path_empty");
    }
    let path_to_library = match tokio::fs::canonicalize(requested_path).await {
        Ok(path) if path.is_dir() => path.to_string_lossy().into_owned(),
        _ => {
            return bad_request(
                "Library path must be an accessible directory.",
                "library_path_invalid",
            );
        }
    };
    let Some(scan_lease) = lifecycle.begin_replacing_scan().await else {
        return conflict(
            "This library selection was replaced by a newer request.",
            "library_scan_replaced",
        );
    };
    info!("Indexing new library path...");
    let scan = tokio::spawn(run_index_scan(
        path_to_library,
        lifecycle.clone(),
        scan_lease,
    ));
    match scan.await {
        Ok(Ok(report)) => HttpResponse::Ok().json(serde_json::json!({
            "library": null,
            "report": report,
        })),
        Ok(Err(failure)) if failure.code == "library_scan_replaced" => {
            conflict(failure.message, failure.code)
        }
        Ok(Err(failure)) => internal_server_error(failure.message, failure.code),
        Err(error) => {
            let message = format!("Library scan coordinator stopped unexpectedly: {error}");
            lifecycle.set_scan_failed(&message).await;
            internal_server_error(message, "library_index_failed")
        }
    }
}

pub async fn refresh_libraries()
-> Result<LibraryRefreshResult, Box<dyn std::error::Error + Send + Sync>> {
    refresh_libraries_with(true, false, None).await
}

async fn refresh_libraries_with(
    enriched: bool,
    repair: bool,
    cancellation: Option<crate::library::indexer::ScanCancellation>,
) -> Result<LibraryRefreshResult, Box<dyn std::error::Error + Send + Sync>> {
    info!("Refreshing all library paths...");

    let paths = read_library_paths().await;
    if paths.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "No saved library paths found. Choose and index a library first.",
        )
        .into());
    }

    let mut refreshed = Vec::new();
    let mut failures = Vec::new();

    for path in paths {
        if cancellation
            .as_ref()
            .is_some_and(crate::library::indexer::ScanCancellation::is_cancelled)
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "Library refresh was replaced by a newer folder selection",
            )
            .into());
        }
        let processed = match (enriched, repair, cancellation.clone()) {
            (true, true, Some(cancellation)) => {
                process_repaired_library_with_cancellation(&path, cancellation).await
            }
            (true, false, Some(cancellation)) => {
                process_enriched_library_with_cancellation(&path, cancellation).await
            }
            (false, _, Some(cancellation)) => {
                process_available_library_with_cancellation(&path, cancellation).await
            }
            (true, _, None) => process_music_library(&path).await,
            (false, _, None) => process_available_library(&path).await,
        };
        match processed {
            Ok(processed) => {
                // Persist roots recovered from the database after refresh.
                if let Err(error) = save_library_path(&path).await {
                    error!(%error, %path, "Could not repair libraries config after refresh");
                }
                refreshed.push(LibraryRefreshSuccess {
                    path,
                    report: processed.report,
                });
            }
            Err(e) => {
                error!("Failed to process library {}: {:?}", path, e);
                failures.push(LibraryRefreshFailure {
                    path,
                    message: e.to_string(),
                });
            }
        }
    }

    Ok(classify_refresh_result(refreshed, failures)?)
}

#[post("/refresh")]
pub async fn library_refresh(lifecycle: web::Data<LibraryLifecycle>) -> impl Responder {
    let Some(scan_lease) = lifecycle.try_begin_scan() else {
        return conflict(
            "A library scan is already running. Wait for it to finish before starting another.",
            "library_scan_in_progress",
        );
    };
    let scan = tokio::spawn(run_refresh_scan(
        lifecycle.clone(),
        scan_lease,
        "Refreshing the indexed libraries.",
    ));
    match scan.await {
        Ok(Ok(result)) if result.failures.is_empty() => HttpResponse::Ok().json(result),
        Ok(Ok(result)) => HttpResponse::MultiStatus().json(result),
        Ok(Err(failure)) => internal_server_error(failure.message, failure.code),
        Err(error) => {
            let message = format!("Library refresh coordinator stopped unexpectedly: {error}");
            lifecycle.set_scan_failed(&message).await;
            internal_server_error(message, "library_refresh_failed")
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct Libraries {
    pub paths: Vec<String>,
}

#[derive(QueryableByName)]
struct LibraryRootPathRow {
    #[diesel(sql_type = Text)]
    path: String,
}

async fn read_database_library_paths() -> Vec<String> {
    match tokio::task::spawn_blocking(|| {
        let pool = crate::persistence::connection::connect()?;
        let mut connection = pool.get()?;
        let rows = diesel::sql_query("SELECT path FROM library_root ORDER BY id")
            .load::<LibraryRootPathRow>(&mut connection)?;
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>(
            rows.into_iter().map(|row| row.path).collect::<Vec<_>>(),
        )
    })
    .await
    {
        Ok(Ok(paths)) => paths,
        Ok(Err(error)) => {
            error!(%error, "Could not recover library paths from the database");
            Vec::new()
        }
        Err(error) => {
            error!(%error, "Database library-path task failed");
            Vec::new()
        }
    }
}

pub async fn read_library_paths() -> Vec<String> {
    let libraries_file = get_libraries_config_path();

    if !libraries_file.exists() {
        return read_database_library_paths().await;
    }

    let content = match fs::read_to_string(&libraries_file) {
        Ok(content) => content,
        Err(e) => {
            error!(
                "Could not read libraries config file {:?}; treating it as empty: {}",
                libraries_file, e
            );
            return read_database_library_paths().await;
        }
    };
    let libraries: Libraries = match serde_json::from_str(&content) {
        Ok(libraries) => libraries,
        Err(e) => {
            error!(
                "Could not parse libraries config file {:?}; treating it as empty: {}",
                libraries_file, e
            );
            return read_database_library_paths().await;
        }
    };

    if libraries.paths.is_empty() {
        read_database_library_paths().await
    } else {
        libraries.paths
    }
}

async fn save_library_path(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let libraries_file = get_libraries_config_path();

    let mut libraries = if libraries_file.exists() {
        let content = fs::read_to_string(&libraries_file)?;
        // Preserve damaged configuration for manual recovery.
        serde_json::from_str(&content)?
    } else {
        Libraries { paths: Vec::new() }
    };

    if !libraries.paths.iter().any(|existing| existing == path) {
        libraries.paths.push(path.to_string());
        let json = serde_json::to_string_pretty(&libraries)?;
        if let Some(parent) = libraries_file.parent() {
            fs::create_dir_all(parent)?;
        }
        let temporary = libraries_file.with_extension("json.tmp");
        fs::write(&temporary, json)?;
        // Keep the previous contents until replacement succeeds.
        let backup = libraries_file.with_extension("json.bak");
        if libraries_file.exists() {
            let _ = fs::remove_file(&backup);
            fs::rename(&libraries_file, &backup)?;
        }
        if let Err(error) = fs::rename(&temporary, &libraries_file) {
            if backup.exists() {
                let _ = fs::rename(&backup, &libraries_file);
            }
            return Err(error.into());
        }
        let _ = fs::remove_file(backup);
    }

    Ok(())
}

#[derive(Deserialize)]
pub struct BitrateQueryParams {
    pub bitrate: u32,
    pub slowed_reverb: Option<bool>,
    pub audio_effect: Option<StreamAudioEffect>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StreamAudioEffect {
    #[default]
    None,
    LightReverb,
    Reverb,
    DeepReverb,
    PitchDown,
    SlowedReverb,
}

impl StreamAudioEffect {
    fn cache_name(self) -> &'static str {
        match self {
            Self::None => "original",
            Self::LightReverb => "light-reverb-v1",
            Self::Reverb => "reverb-v1",
            Self::DeepReverb => "deep-reverb-v1",
            Self::PitchDown => "pitch-down-v1",
            Self::SlowedReverb => "slowed-reverb-v2",
        }
    }

    fn ffmpeg_filter(self) -> Option<&'static str> {
        match self {
            Self::None => None,
            // Mirror the web preset's mix and speed.
            Self::LightReverb => Some("aecho=0.98:0.08:70:0.20"),
            Self::Reverb => Some("aecho=0.80:0.46:70:0.28"),
            Self::DeepReverb => Some("aecho=0.62:0.76:70:0.38"),
            // Restore duration after changing sample rate for pitch-only control.
            Self::PitchDown => Some("asetrate=44100*0.82,aresample=44100,atempo=1.219512195"),
            Self::SlowedReverb => {
                Some("asetrate=44100*0.82,aresample=44100,aecho=0.65:0.42:70:0.28")
            }
        }
    }
}

const MAX_STREAM_BITRATE: u32 = 320;
const MIN_STREAM_BITRATE: u32 = 32;
const STREAM_BUFFER_SIZE: usize = 131072;

async fn resolve_stream_song(
    song_key: &str,
    cache: &LibraryCache,
) -> Result<(String, PathBuf), HttpResponse> {
    let song = cache
        .song(song_key)
        .or_else(|| {
            cache
                .songs_flat
                .iter()
                .filter_map(|song_id| cache.song(song_id))
                .find(|song| song.path == song_key)
        })
        .ok_or_else(|| not_found("Song not found.", "song_not_found"))?;

    let canonical_song = tokio::fs::canonicalize(&song.path)
        .await
        .map_err(|_| not_found("Song file not found.", "song_file_not_found"))?;

    let metadata = tokio::fs::metadata(&canonical_song)
        .await
        .map_err(|_| not_found("Song file not found.", "song_file_not_found"))?;
    if !metadata.is_file() {
        return Err(not_found("Song file not found.", "song_file_not_found"));
    }

    let library_paths = read_library_paths().await;
    for library_path in library_paths {
        let Ok(canonical_library) = tokio::fs::canonicalize(library_path).await else {
            continue;
        };

        if canonical_song.starts_with(canonical_library) {
            return Ok((song.id.clone(), canonical_song));
        }
    }

    for indexed_song in cache
        .songs_flat
        .iter()
        .filter_map(|song_id| cache.song(song_id))
    {
        let Ok(indexed_path) = tokio::fs::canonicalize(&indexed_song.path).await else {
            continue;
        };

        if indexed_path == canonical_song {
            return Ok((song.id.clone(), canonical_song));
        }
    }

    Err(forbidden(
        "Song file is outside configured library paths.",
        "song_path_forbidden",
    ))
}

fn parse_range(
    range_header: Option<&str>,
    file_size: u64,
) -> Result<(u64, u64, bool), HttpResponse> {
    if file_size == 0 {
        return Err(range_not_satisfiable(
            "Cannot stream an empty file.",
            "empty_file_range",
        ));
    }

    let Some(range_header) = range_header else {
        return Ok((0, file_size - 1, false));
    };

    let Some(bytes_range) = range_header.trim().strip_prefix("bytes=") else {
        return Ok((0, file_size - 1, false));
    };

    let mut parts = bytes_range.splitn(2, '-');
    let start_part = parts.next().unwrap_or_default();
    let end_part = parts.next().unwrap_or_default();

    let (start, end) = if start_part.is_empty() {
        let suffix_len = end_part
            .parse::<u64>()
            .map_err(|_| range_not_satisfiable("Invalid range header.", "invalid_range"))?;
        if suffix_len == 0 {
            return Err(range_not_satisfiable(
                "Invalid range header.",
                "invalid_range",
            ));
        }
        (file_size.saturating_sub(suffix_len), file_size - 1)
    } else {
        let start = start_part
            .parse::<u64>()
            .map_err(|_| range_not_satisfiable("Invalid range header.", "invalid_range"))?;
        let end = if end_part.is_empty() {
            file_size - 1
        } else {
            end_part
                .parse::<u64>()
                .map_err(|_| range_not_satisfiable("Invalid range header.", "invalid_range"))?
        };
        (start, end.min(file_size - 1))
    };

    if start > end || start >= file_size {
        return Err(range_not_satisfiable(
            "Requested range is not satisfiable.",
            "range_not_satisfiable",
        ));
    }

    Ok((start, end, true))
}

async fn stream_file_range(
    req: &HttpRequest,
    path: &Path,
    etag_key: &str,
    content_type: &'static str,
) -> HttpResponse {
    use tokio::io::AsyncSeekExt;

    let metadata = match tokio::fs::metadata(path).await {
        Ok(metadata) => metadata,
        Err(_) => return not_found("Song file not found.", "song_file_not_found"),
    };
    let file_size = metadata.len();

    let range = req.headers().get("Range").and_then(|v| v.to_str().ok());
    let (start, end, partial) = match parse_range(range, file_size) {
        Ok(range) => range,
        Err(mut response) => {
            if let Ok(value) = header::HeaderValue::from_str(&format!("bytes */{file_size}")) {
                response.headers_mut().insert(header::CONTENT_RANGE, value);
            }
            response.headers_mut().insert(
                header::ACCEPT_RANGES,
                header::HeaderValue::from_static("bytes"),
            );
            return response;
        }
    };

    let mut file = match tokio::fs::File::open(path).await {
        Ok(file) => file,
        Err(_) => return not_found("Song file not found.", "song_file_not_found"),
    };

    if start > 0 && file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
        return internal_server_error("Failed to seek audio stream.", "stream_seek_failed");
    }

    let stream = ReaderStream::with_capacity(file.take(end - start + 1), STREAM_BUFFER_SIZE);
    let modified = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let mut response = if partial {
        HttpResponse::PartialContent()
    } else {
        HttpResponse::Ok()
    };
    response
        .insert_header((header::ACCEPT_RANGES, "bytes"))
        .insert_header((header::CONTENT_TYPE, content_type))
        .insert_header((header::CONTENT_LENGTH, (end - start + 1).to_string()))
        .insert_header((header::ETAG, format!("\"{}-{}\"", etag_key, modified)));
    if partial {
        response.insert_header((
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{}", start, end, file_size),
        ));
    }

    response.streaming(stream)
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("flac") => "audio/flac",
        Some("mp3") => "audio/mpeg",
        Some("aac") => "audio/aac",
        Some("m4a") | Some("mp4") => "audio/mp4",
        Some("wav") => "audio/wav",
        Some("ogg") | Some("oga") => "audio/ogg",
        Some("opus") => "audio/opus",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        _ => "application/octet-stream",
    }
}

fn transcode_cache_path(song_id: &str, path: &Path, bitrate: u32) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(song_id.as_bytes());
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(bitrate.to_le_bytes());
    if let Ok(metadata) = std::fs::metadata(path) {
        hasher.update(metadata.len().to_le_bytes());
        if let Ok(modified) = metadata.modified()
            && let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH)
        {
            hasher.update(duration.as_nanos().to_le_bytes());
        }
    }
    let cache_key = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();

    let mut cache_dir = dirs::cache_dir().unwrap_or_else(std::env::temp_dir);
    cache_dir.push("Parson");
    cache_dir.push("Transcodes");
    cache_dir.push(format!("{}.mp3", cache_key));
    cache_dir
}

#[cfg(test)]
mod reliability_tests {
    use std::path::Path;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use tokio::sync::Mutex;

    use super::{
        LibraryRefreshFailure, LibraryRefreshSuccess, MAX_CONCURRENT_TRANSCODES, StreamAudioEffect,
        TranscodeCleanup, automatic_change_is_settled, classify_refresh_result,
        merge_progressive_catalog, parse_range, prune_transcode_cache, release_transcode_lock,
        retain_progressive_albums_with_artwork, select_auto_refresh_quiet_window,
        transcode_cache_locks, transcode_cache_path, transcode_slots,
    };
    use crate::domain::{Album, Artist, Song};
    use crate::library::normalize::LibraryIndexReport;

    #[test]
    fn stream_audio_effects_keep_speed_pitch_and_reverb_distinct() {
        assert!(StreamAudioEffect::None.ffmpeg_filter().is_none());
        let reverb = StreamAudioEffect::Reverb.ffmpeg_filter().unwrap();
        assert!(reverb.contains("aecho"));
        assert!(!reverb.contains("asetrate"));
        assert!(
            StreamAudioEffect::LightReverb
                .ffmpeg_filter()
                .unwrap()
                .contains("0.08")
        );
        assert!(
            StreamAudioEffect::DeepReverb
                .ffmpeg_filter()
                .unwrap()
                .contains("0.76")
        );
        let pitch = StreamAudioEffect::PitchDown.ffmpeg_filter().unwrap();
        assert!(pitch.contains("asetrate"));
        assert!(pitch.contains("atempo"));
        assert!(!pitch.contains("aecho"));
        let combined = StreamAudioEffect::SlowedReverb.ffmpeg_filter().unwrap();
        assert!(combined.contains("asetrate"));
        assert!(combined.contains("aecho"));
    }

    #[test]
    fn partial_refreshes_preserve_root_diagnostics_but_total_failures_error() {
        let failure = || LibraryRefreshFailure {
            path: "offline-library".into(),
            message: "drive unavailable".into(),
        };
        let partial = classify_refresh_result(
            vec![LibraryRefreshSuccess {
                path: "available-library".into(),
                report: LibraryIndexReport::default(),
            }],
            vec![failure()],
        )
        .expect("partial refresh result");
        assert_eq!(partial.refreshed.len(), 1);
        assert_eq!(partial.failures.len(), 1);
        assert!(classify_refresh_result(Vec::new(), vec![failure()]).is_err());
    }

    #[test]
    fn progressive_catalog_keeps_seed_artwork_and_visible_seed_entities() {
        let seed = vec![
            Artist {
                id: "artist-a".into(),
                name: "A".into(),
                icon_url: "artist-a.jpg".into(),
                albums: vec![Album {
                    id: "album-a".into(),
                    name: "A album".into(),
                    cover_url: "album-a.jpg".into(),
                    songs: vec![Song {
                        id: "old-song".into(),
                        name: "Old song".into(),
                        ..Song::default()
                    }],
                    ..Album::default()
                }],
                ..Artist::default()
            },
            Artist {
                id: "artist-c".into(),
                name: "C".into(),
                icon_url: "artist-c.jpg".into(),
                ..Artist::default()
            },
        ];
        let progress = vec![
            Artist {
                id: "artist-a".into(),
                name: "A".into(),
                albums: vec![Album {
                    id: "album-a".into(),
                    name: "A album".into(),
                    songs: vec![Song {
                        id: "new-song".into(),
                        name: "New song".into(),
                        ..Song::default()
                    }],
                    ..Album::default()
                }],
                ..Artist::default()
            },
            Artist {
                id: "artist-b".into(),
                name: "B".into(),
                ..Artist::default()
            },
        ];
        let merged = merge_progressive_catalog(progress, &seed);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].icon_url, "artist-a.jpg");
        assert_eq!(merged[0].albums[0].cover_url, "album-a.jpg");
        assert_eq!(merged[0].albums[0].songs.len(), 2);
        assert_eq!(merged[2].icon_url, "artist-c.jpg");
    }

    #[test]
    fn large_progressive_publications_hide_albums_without_artwork() {
        let mut catalog = vec![Artist {
            id: "artist-a".into(),
            name: "A".into(),
            albums: vec![
                Album {
                    id: "covered".into(),
                    name: "Covered".into(),
                    cover_url: "cover.jpg".into(),
                    ..Album::default()
                },
                Album {
                    id: "uncovered".into(),
                    name: "Uncovered".into(),
                    cover_url: "  ".into(),
                    ..Album::default()
                },
            ],
            ..Artist::default()
        }];

        assert!(retain_progressive_albums_with_artwork(&mut catalog));
        assert_eq!(catalog.len(), 1);
        assert_eq!(catalog[0].albums.len(), 1);
        assert_eq!(catalog[0].albums[0].id, "covered");
    }

    #[test]
    fn progressive_publication_keeps_the_preview_when_no_artwork_is_ready() {
        let mut catalog = vec![Artist {
            id: "artist-a".into(),
            name: "A".into(),
            albums: vec![Album {
                id: "uncovered".into(),
                name: "Uncovered".into(),
                ..Album::default()
            }],
            ..Artist::default()
        }];

        assert!(!retain_progressive_albums_with_artwork(&mut catalog));
        assert!(catalog.is_empty());
    }

    #[test]
    fn automatic_refresh_debounce_scales_with_copy_size_and_waits_for_quiet() {
        let single = Duration::from_millis(1_500);
        let album = Duration::from_secs(4);
        let large = Duration::from_secs(8);
        assert_eq!(
            select_auto_refresh_quiet_window(8, false, single, album, large),
            single
        );
        assert_eq!(
            select_auto_refresh_quiet_window(9, false, single, album, large),
            album
        );
        assert_eq!(
            select_auto_refresh_quiet_window(257, false, single, album, large),
            large
        );
        assert_eq!(
            select_auto_refresh_quiet_window(1, true, single, album, large),
            large
        );

        let now = Instant::now();
        assert!(!automatic_change_is_settled(now, Some(now), 1, false));
        assert!(automatic_change_is_settled(
            now,
            Some(now - Duration::from_secs(20)),
            1,
            false
        ));
    }

    #[test]
    fn transcode_cache_key_includes_bitrate() {
        let source = Path::new("library/song.flac");
        assert_ne!(
            transcode_cache_path("song", source, 128),
            transcode_cache_path("song", source, 320)
        );
        assert_eq!(
            transcode_cache_path("song", source, 128),
            transcode_cache_path("song", source, 128)
        );
    }

    #[test]
    fn transcode_cache_key_changes_when_the_source_changes() {
        let directory =
            std::env::temp_dir().join(format!("music-transcode-key-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("cache key directory");
        let source = directory.join("song.flac");
        std::fs::write(&source, [1u8]).expect("first source version");
        let first = transcode_cache_path("song", &source, 128);
        std::fs::write(&source, [1u8, 2u8]).expect("second source version");
        let second = transcode_cache_path("song", &source, 128);
        assert_ne!(first, second);
        std::fs::remove_dir_all(directory).expect("cache key cleanup");
    }

    #[test]
    fn transcode_capacity_is_bounded() {
        let slots = transcode_slots();
        let permits = (0..MAX_CONCURRENT_TRANSCODES)
            .map(|_| slots.clone().try_acquire_owned().expect("available slot"))
            .collect::<Vec<_>>();
        assert!(slots.clone().try_acquire_owned().is_err());
        drop(permits);
        assert!(slots.try_acquire_owned().is_ok());
    }

    #[test]
    fn full_and_partial_byte_ranges_are_distinguished() {
        assert_eq!(parse_range(None, 100).expect("full range"), (0, 99, false));
        assert_eq!(
            parse_range(Some("items=0-9"), 100).expect("ignored range unit"),
            (0, 99, false)
        );
        assert_eq!(
            parse_range(Some("bytes=10-19"), 100).expect("explicit range"),
            (10, 19, true)
        );
        assert_eq!(
            parse_range(Some("bytes=-10"), 100).expect("suffix range"),
            (90, 99, true)
        );
        assert!(parse_range(Some("bytes=100-"), 100).is_err());
        assert!(parse_range(Some("bytes=20-10"), 100).is_err());
    }

    #[test]
    fn transcode_cache_evicts_old_files_but_keeps_active_output() {
        let directory = std::env::temp_dir().join(format!(
            "music-transcode-prune-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).expect("test cache directory");
        let active = directory.join("active.mp3");
        std::fs::write(directory.join("a.mp3"), [0u8; 6]).expect("cache fixture");
        std::fs::write(directory.join("b.mp3"), [0u8; 6]).expect("cache fixture");
        std::fs::write(&active, [0u8; 6]).expect("cache fixture");

        prune_transcode_cache(&directory, &active, 8, std::time::Duration::ZERO)
            .expect("cache cleanup");

        let total = std::fs::read_dir(&directory)
            .expect("cache listing")
            .filter_map(Result::ok)
            .filter_map(|entry| entry.metadata().ok())
            .map(|metadata| metadata.len())
            .sum::<u64>();
        assert!(active.exists());
        assert!(total <= 8);
        std::fs::remove_dir_all(directory).expect("test cleanup");
    }

    #[actix_web::test]
    async fn transcode_lock_is_retained_until_the_last_waiter_finishes() {
        let path = std::env::temp_dir().join(format!(
            "music-transcode-lock-test-{}.mp3",
            uuid::Uuid::new_v4()
        ));
        let lock = Arc::new(Mutex::new(()));
        transcode_cache_locks()
            .lock()
            .await
            .insert(path.clone(), lock.clone());
        let waiter = lock.clone();

        release_transcode_lock(&path, &lock).await;
        assert!(transcode_cache_locks().lock().await.contains_key(&path));

        drop(lock);
        release_transcode_lock(&path, &waiter).await;
        assert!(!transcode_cache_locks().lock().await.contains_key(&path));
    }

    #[actix_web::test]
    async fn abandoned_transcodes_remove_temporary_files_and_lock_entries() {
        let identity = uuid::Uuid::new_v4();
        let cache_path = std::env::temp_dir().join(format!("music-transcode-{identity}.mp3"));
        let temp_path = std::env::temp_dir().join(format!("music-transcode-{identity}.tmp"));
        std::fs::write(&temp_path, b"partial transcode").expect("temporary transcode fixture");
        let cache_lock = Arc::new(Mutex::new(()));
        transcode_cache_locks()
            .lock()
            .await
            .insert(cache_path.clone(), cache_lock.clone());

        drop(TranscodeCleanup {
            cache_lock,
            cache_path: cache_path.clone(),
            committed: false,
            temp_path: temp_path.clone(),
        });

        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if !temp_path.exists()
                    && !transcode_cache_locks()
                        .lock()
                        .await
                        .contains_key(&cache_path)
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("abandoned transcode cleanup");
    }
}

async fn stream_cached_transcode(
    req: &HttpRequest,
    input_path: &Path,
    cache_path: &Path,
    etag_key: &str,
    bitrate: u32,
    audio_effect: StreamAudioEffect,
) -> HttpResponse {
    if tokio::fs::metadata(cache_path).await.is_ok() {
        return stream_file_range(req, cache_path, etag_key, "audio/mpeg").await;
    }

    let cache_lock = {
        let mut locks = transcode_cache_locks().lock().await;
        locks
            .entry(cache_path.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };
    let cache_guard = cache_lock.clone().lock_owned().await;
    if tokio::fs::metadata(cache_path).await.is_ok() {
        drop(cache_guard);
        release_transcode_lock(cache_path, &cache_lock).await;
        return stream_file_range(req, cache_path, etag_key, "audio/mpeg").await;
    }
    let Some(parent) = cache_path.parent() else {
        drop(cache_guard);
        release_transcode_lock(cache_path, &cache_lock).await;
        return internal_server_error("Failed to prepare transcoded stream.", "transcode_failed");
    };

    if tokio::fs::create_dir_all(parent).await.is_err() {
        drop(cache_guard);
        release_transcode_lock(cache_path, &cache_lock).await;
        return internal_server_error("Failed to prepare transcoded stream.", "transcode_failed");
    }

    let permit = match transcode_slots().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            drop(cache_guard);
            release_transcode_lock(cache_path, &cache_lock).await;
            return service_unavailable(
                "The transcoder is busy. Retry shortly.",
                "transcode_capacity_reached",
            );
        }
    };

    let temp_path = cache_path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let bitrate_arg = format!("{}k", bitrate);
    let mut command = Command::new("ffmpeg");
    command.kill_on_drop(true);
    command.args(["-y", "-i"]).arg(input_path);
    if let Some(filter) = audio_effect.ffmpeg_filter() {
        command.args([
            "-filter_complex",
            &format!("[0:a:0]{filter}[a]"),
            "-map",
            "[a]",
        ]);
    } else {
        command.args(["-map", "0:a:0"]);
    }
    command.args([
        "-b:a",
        &bitrate_arg,
        "-f",
        "mp3",
        "-c:a",
        "libmp3lame",
        "-compression_level",
        "0",
        "-write_xing",
        "0",
        "-flush_packets",
        "1",
        "-threads",
        "2",
        "-v",
        "error",
        "pipe:1",
    ]);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let Ok(mut child) = command.spawn() else {
        drop(cache_guard);
        release_transcode_lock(cache_path, &cache_lock).await;
        return internal_server_error("Failed to start transcoder.", "transcode_failed");
    };
    let Some(stdout) = child.stdout.take() else {
        drop(cache_guard);
        release_transcode_lock(cache_path, &cache_lock).await;
        return internal_server_error("Failed to start transcoder.", "transcode_failed");
    };
    let Ok(output) = tokio::fs::File::create(&temp_path).await else {
        drop(child);
        drop(cache_guard);
        release_transcode_lock(cache_path, &cache_lock).await;
        return internal_server_error("Failed to prepare transcode cache.", "transcode_failed");
    };

    struct LiveTranscode {
        cache_guard: tokio::sync::OwnedMutexGuard<()>,
        child: tokio::process::Child,
        cleanup: TranscodeCleanup,
        failed: bool,
        output: tokio::fs::File,
        permit: tokio::sync::OwnedSemaphorePermit,
        stdout: tokio::process::ChildStdout,
    }

    let state = LiveTranscode {
        cache_guard,
        child,
        cleanup: TranscodeCleanup {
            cache_lock,
            cache_path: cache_path.to_path_buf(),
            committed: false,
            temp_path,
        },
        failed: false,
        output,
        permit,
        stdout,
    };
    let stream = futures::stream::unfold(state, |mut state| async move {
        if state.failed {
            let _ = state.child.kill().await;
            return None;
        }
        let mut buffer = vec![0; STREAM_BUFFER_SIZE];
        match state.stdout.read(&mut buffer).await {
            Ok(0) => {
                let success = state
                    .child
                    .wait()
                    .await
                    .is_ok_and(|status| status.success())
                    && state.output.flush().await.is_ok();
                drop(state.output);
                let promoted = success
                    && tokio::fs::rename(&state.cleanup.temp_path, &state.cleanup.cache_path)
                        .await
                        .is_ok();
                if promoted {
                    state.cleanup.committed = true;
                    let directory = state.cleanup.cache_path.parent().map(Path::to_path_buf);
                    let protected = state.cleanup.cache_path.clone();
                    if let Some(directory) = directory {
                        tokio::spawn(async move {
                            let max_bytes = transcode_cache_max_bytes();
                            let cleanup = tokio::task::spawn_blocking(move || {
                                prune_transcode_cache(
                                    &directory,
                                    &protected,
                                    max_bytes,
                                    Duration::from_secs(10 * 60),
                                )
                            })
                            .await;
                            match cleanup {
                                Ok(Ok(())) => {}
                                Ok(Err(error)) => {
                                    tracing::warn!(%error, "transcode cache cleanup failed")
                                }
                                Err(error) => {
                                    tracing::warn!(%error, "transcode cache cleanup task failed")
                                }
                            }
                        });
                    }
                }
                drop(state.permit);
                drop(state.cache_guard);
                None
            }
            Ok(size) => {
                buffer.truncate(size);
                if let Err(error) = state.output.write_all(&buffer).await {
                    let _ = state.child.kill().await;
                    state.failed = true;
                    return Some((Err(error), state));
                }
                Some((Ok(web::Bytes::from(buffer)), state))
            }
            Err(error) => {
                state.failed = true;
                Some((Err(error), state))
            }
        }
    });

    HttpResponse::Ok()
        .insert_header((header::CONTENT_TYPE, "audio/mpeg"))
        .insert_header((header::CACHE_CONTROL, "no-store"))
        .streaming(stream)
}

async fn release_transcode_lock(cache_path: &Path, cache_lock: &Arc<Mutex<()>>) {
    let mut locks = transcode_cache_locks().lock().await;
    let is_current = locks
        .get(cache_path)
        .is_some_and(|current| Arc::ptr_eq(current, cache_lock));
    // Additional references belong to callers sharing this mutex.
    if is_current && Arc::strong_count(cache_lock) == 2 {
        locks.remove(cache_path);
    }
}

#[get("/media/songs/{song}/stream")]
async fn stream_song(
    req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<BitrateQueryParams>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> impl Responder {
    let song_key = path.into_inner();
    let bitrate = query.bitrate;
    let audio_effect = query.audio_effect.unwrap_or_else(|| {
        if query.slowed_reverb.unwrap_or(false) {
            StreamAudioEffect::SlowedReverb
        } else {
            StreamAudioEffect::None
        }
    });

    if bitrate > MAX_STREAM_BITRATE || (bitrate > 0 && bitrate < MIN_STREAM_BITRATE) {
        return bad_request("Invalid bitrate.", "invalid_bitrate");
    }

    stream_song_profile(&req, &song_key, bitrate, audio_effect, &lifecycle).await
}

#[head("/media/songs/{song}/stream")]
async fn head_stream_song(
    path: web::Path<String>,
    query: web::Query<BitrateQueryParams>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let bitrate = query.bitrate;
    let audio_effect = query.audio_effect.unwrap_or_else(|| {
        if query.slowed_reverb.unwrap_or(false) {
            StreamAudioEffect::SlowedReverb
        } else {
            StreamAudioEffect::None
        }
    });
    if bitrate > MAX_STREAM_BITRATE || (bitrate > 0 && bitrate < MIN_STREAM_BITRATE) {
        return bad_request("Invalid bitrate.", "invalid_bitrate");
    }

    let song_key = path.into_inner();
    let (song_id, song_path) = match resolve_stream_song_with_refresh(&song_key, &lifecycle).await {
        Ok(resolved) => resolved,
        Err(response) => return response,
    };
    if bitrate == 0 && audio_effect == StreamAudioEffect::None {
        let metadata = match tokio::fs::metadata(&song_path).await {
            Ok(metadata) => metadata,
            Err(_) => return not_found("Song file not found.", "song_file_not_found"),
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        return HttpResponse::Ok()
            .insert_header((header::ACCEPT_RANGES, "bytes"))
            .insert_header((header::CONTENT_TYPE, content_type_for_path(&song_path)))
            .insert_header((header::CONTENT_LENGTH, metadata.len().to_string()))
            .insert_header((header::ETAG, format!("\"{}-{}\"", song_id, modified)))
            .finish();
    }

    let output_bitrate = if audio_effect != StreamAudioEffect::None {
        192
    } else {
        bitrate
    };
    let cache_identity = if audio_effect == StreamAudioEffect::None {
        song_id
    } else {
        format!("{song_id}-{}", audio_effect.cache_name())
    };
    let cache_path = transcode_cache_path(&cache_identity, &song_path, output_bitrate);
    if let Ok(metadata) = tokio::fs::metadata(&cache_path).await {
        let modified = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        return HttpResponse::Ok()
            .insert_header((header::ACCEPT_RANGES, "bytes"))
            .insert_header((header::CONTENT_TYPE, "audio/mpeg"))
            .insert_header((header::CONTENT_LENGTH, metadata.len().to_string()))
            .insert_header((
                header::ETAG,
                format!("\"{}-{}k-{}\"", cache_identity, output_bitrate, modified),
            ))
            .finish();
    }
    HttpResponse::Ok()
        .insert_header((header::CONTENT_TYPE, "audio/mpeg"))
        .finish()
}

async fn resolve_stream_song_with_refresh(
    song_key: &str,
    lifecycle: &web::Data<LibraryLifecycle>,
) -> Result<(String, PathBuf), HttpResponse> {
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return Err(library_unavailable_response(readiness)),
    };
    match resolve_stream_song(song_key, cache.as_ref()).await {
        Ok(resolved) => Ok(resolved),
        Err(response) if response.status() == actix_web::http::StatusCode::NOT_FOUND => {
            match LibraryCache::new().await {
                Ok(fresh_cache) => {
                    lifecycle.set_ready_and_persist(fresh_cache).await;
                    let cache = match lifecycle.cache().await {
                        Ok(cache) => cache,
                        Err(readiness) => return Err(library_unavailable_response(readiness)),
                    };
                    resolve_stream_song(song_key, cache.as_ref()).await
                }
                Err(_) => Err(response),
            }
        }
        Err(response) => Err(response),
    }
}

async fn stream_song_profile(
    req: &HttpRequest,
    song_key: &str,
    bitrate: u32,
    audio_effect: StreamAudioEffect,
    lifecycle: &web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let (song_id, song_path) = match resolve_stream_song_with_refresh(song_key, lifecycle).await {
        Ok(resolved) => resolved,
        Err(response) => return response,
    };

    if bitrate == 0 && audio_effect == StreamAudioEffect::None {
        stream_file_range(req, &song_path, &song_id, content_type_for_path(&song_path)).await
    } else {
        let output_bitrate = if audio_effect != StreamAudioEffect::None {
            192
        } else {
            bitrate
        };
        let cache_identity = if audio_effect == StreamAudioEffect::None {
            song_id.clone()
        } else {
            format!("{song_id}-{}", audio_effect.cache_name())
        };
        let cache_path = transcode_cache_path(&cache_identity, &song_path, output_bitrate);
        stream_cached_transcode(
            req,
            &song_path,
            &cache_path,
            &format!("{}-{}k", cache_identity, output_bitrate),
            output_bitrate,
            audio_effect,
        )
        .await
    }
}

/// Streams receiver-safe audio for Google Cast.
pub(crate) async fn stream_cast_compatible(
    req: &HttpRequest,
    song_key: &str,
    lifecycle: &web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let direct = lifecycle
        .cache()
        .await
        .ok()
        .and_then(|cache| cache.song(song_key).map(|song| song.path.clone()))
        .and_then(|path| {
            Path::new(&path)
                .extension()
                .and_then(|extension| extension.to_str())
                .map(str::to_ascii_lowercase)
        })
        .is_some_and(|extension| matches!(extension.as_str(), "mp3" | "aac" | "m4a" | "mp4"));
    stream_song_profile(
        req,
        song_key,
        if direct { 0 } else { 192 },
        StreamAudioEffect::None,
        lifecycle,
    )
    .await
}
