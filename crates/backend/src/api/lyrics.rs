use std::collections::{HashMap, HashSet, VecDeque};
use std::error::Error;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use actix_web::{HttpResponse, get, web};
use diesel::connection::SimpleConnection;
use diesel::deserialize::QueryableByName;
use diesel::prelude::*;
use diesel::r2d2::{self, ConnectionManager};
use diesel::sql_types::{BigInt, Binary, Integer, Text};
use diesel::sqlite::SqliteConnection;
use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, Semaphore};

use crate::api::error::{internal_server_error, not_found};
use crate::library::search::normalize;
use crate::library::state::{LibraryCache, LibraryLifecycle, library_unavailable_response};
use crate::persistence::connection::DbPool;
use crate::settings::data_path;

const LRCLIB_GET_URL: &str = "https://lrclib.net/api/get";
const LRCLIB_SEARCH_URL: &str = "https://lrclib.net/api/search";
const MAX_CONCURRENT_LYRICS_REQUESTS: usize = 8;
const MAX_LYRICS_RESPONSE_BYTES: usize = 1024 * 1024;
const LYRICS_LOOKUP_LOCK_STRIPES: usize = 64;
const MEMORY_CACHE_SHARDS: usize = 64;
const MAX_MEMORY_CACHE_ENTRIES: usize = 4096;
const MAX_MEMORY_CACHE_BYTES: usize = 64 * 1024 * 1024;
const MEMORY_CACHE_TTL: Duration = Duration::from_secs(30 * 60);
const POSITIVE_CACHE_TTL: Duration = Duration::from_secs(365 * 24 * 60 * 60);
const NEGATIVE_CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const EXPIRED_PURGE_INTERVAL: u64 = 256;
const EXPIRED_PURGE_BATCH: usize = 1024;
const ZSTD_COMPRESSION_LEVEL: i32 = 3;
const ZSTD_JSON_CODEC: i32 = 1;
const LRCLIB_CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
// LRCLIB may consult slow external sources.
const LRCLIB_REQUEST_TIMEOUT: Duration = Duration::from_secs(25);
const LRCLIB_SEARCH_DURATION_TOLERANCE_SECONDS: f64 = 5.0;
const MAX_LYRICS_SEARCH_CANDIDATES: i64 = 100;
const MAX_INDEXED_LYRICS_CHARACTERS: usize = 512 * 1024;
const MAX_LYRICS_SNIPPET_CHARACTERS: usize = 180;

type CacheKey = [u8; 32];
type BoxError = Box<dyn Error + Send + Sync>;

const LYRICS_CACHE_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS lrclib_lyrics_cache (
    cache_key BLOB NOT NULL PRIMARY KEY CHECK(length(cache_key) = 32),
    response_kind INTEGER NOT NULL CHECK(response_kind IN (0, 1)),
    payload BLOB NOT NULL,
    uncompressed_bytes INTEGER NOT NULL CHECK(uncompressed_bytes >= 0 AND uncompressed_bytes <= 1048576),
    codec INTEGER NOT NULL DEFAULT 1 CHECK(codec = 1),
    stored_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_lrclib_lyrics_cache_expiry
    ON lrclib_lyrics_cache(expires_at);
CREATE VIRTUAL TABLE IF NOT EXISTS lrclib_lyrics_search USING fts5(
    song_id UNINDEXED,
    cache_key UNINDEXED,
    expires_at UNINDEXED,
    lyrics UNINDEXED,
    search_text,
    tokenize = 'unicode61 remove_diacritics 2'
);";

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LyricsSearchHit {
    pub song_id: String,
    pub score: f32,
    pub snippet: String,
    pub exact_phrase: bool,
}

#[derive(Debug)]
struct ConfigureLyricsCacheConnection;

impl r2d2::CustomizeConnection<SqliteConnection, diesel::r2d2::Error>
    for ConfigureLyricsCacheConnection
{
    fn on_acquire(&self, connection: &mut SqliteConnection) -> Result<(), diesel::r2d2::Error> {
        connection
            .batch_execute(
                "PRAGMA synchronous = NORMAL;
                 PRAGMA busy_timeout = 10000;
                 PRAGMA cache_size = -32768;
                 PRAGMA temp_store = MEMORY;
                 PRAGMA mmap_size = 536870912;
                 PRAGMA wal_autocheckpoint = 4000;
                 PRAGMA journal_size_limit = 67108864;",
            )
            .map_err(diesel::r2d2::Error::QueryError)
    }
}

fn connect_lyrics_cache() -> Result<DbPool, BoxError> {
    let path = data_path(&["Cache", "Lyrics", "lyrics.db"]);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let url = path
        .to_str()
        .ok_or_else(|| std::io::Error::other("lyrics cache path is not valid UTF-8"))?;
    let new_database = !path.exists() || path.metadata().is_ok_and(|metadata| metadata.len() == 0);
    let mut connection = SqliteConnection::establish(url)?;
    if new_database {
        connection.batch_execute("PRAGMA auto_vacuum = INCREMENTAL; VACUUM;")?;
    }
    connection.batch_execute(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 10000;",
    )?;
    connection.batch_execute(LYRICS_CACHE_SCHEMA)?;

    let manager = ConnectionManager::<SqliteConnection>::new(url);
    Ok(Arc::new(
        r2d2::Pool::builder()
            .max_size(8)
            .connection_customizer(Box::new(ConfigureLyricsCacheConnection))
            .build(manager)?,
    ))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsResponse {
    pub id: i64,
    pub track_name: String,
    pub artist_name: String,
    pub album_name: String,
    pub duration: f64,
    pub instrumental: bool,
    pub plain_lyrics: Option<String>,
    pub synced_lyrics: Option<String>,
}

fn strip_synced_lyrics(value: &str) -> String {
    value
        .lines()
        .filter_map(|line| {
            let mut text = line.trim();
            while let Some(rest) = text.strip_prefix('[') {
                let closing = rest.find(']')?;
                text = rest[closing + 1..].trim_start();
            }
            (!text.is_empty()).then_some(text)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn searchable_lyrics(lyrics: &LyricsResponse) -> Option<String> {
    let value = lyrics
        .plain_lyrics
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            lyrics
                .synced_lyrics
                .as_deref()
                .map(strip_synced_lyrics)
                .filter(|value| !value.is_empty())
        })?;
    let value = value.replace('\0', " ");
    let mut end = value.len();
    if value.chars().count() > MAX_INDEXED_LYRICS_CHARACTERS {
        end = value
            .char_indices()
            .nth(MAX_INDEXED_LYRICS_CHARACTERS)
            .map_or(value.len(), |(index, _)| index);
    }
    Some(value[..end].to_string())
}

fn normalized_phrase_in(value: &str, phrase: &str) -> bool {
    value == phrase
        || value.starts_with(&format!("{phrase} "))
        || value.ends_with(&format!(" {phrase}"))
        || value.contains(&format!(" {phrase} "))
}

fn lyric_query_is_confident(query: &str) -> bool {
    let normalized = normalize(query);
    let tokens = normalized.split_whitespace().collect::<Vec<_>>();
    let characters = tokens
        .iter()
        .map(|token| token.chars().count())
        .sum::<usize>();
    match tokens.len() {
        0 => false,
        1 => characters >= 10,
        2 => characters >= 10,
        _ => characters >= 9,
    }
}

fn lyrics_match_expression(query: &str) -> Option<String> {
    let normalized = normalize(query);
    let tokens = normalized.split_whitespace().collect::<Vec<_>>();
    lyric_query_is_confident(&normalized).then(|| {
        tokens
            .into_iter()
            .map(|token| format!("\"{token}\""))
            .collect::<Vec<_>>()
            .join(" AND ")
    })
}

fn lyric_snippet(lyrics: &str, query: &str) -> String {
    let normalized_query = normalize(query);
    let query_tokens = normalized_query
        .split_whitespace()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let best = lyrics
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .max_by_key(|line| {
            let normalized = normalize(line);
            let matches = query_tokens
                .iter()
                .filter(|token| {
                    normalized
                        .split_whitespace()
                        .any(|word| word == token.as_str())
                })
                .count();
            (
                usize::from(normalized_phrase_in(&normalized, &normalized_query)),
                matches,
            )
        })
        .unwrap_or(lyrics.trim());
    let collapsed = best.split_whitespace().collect::<Vec<_>>().join(" ");
    let sanitized = collapsed
        .chars()
        .filter(|character| !character.is_control())
        .collect::<String>();
    let mut snippet = sanitized
        .chars()
        .take(MAX_LYRICS_SNIPPET_CHARACTERS)
        .collect::<String>();
    if sanitized.chars().count() > MAX_LYRICS_SNIPPET_CHARACTERS {
        snippet.push('…');
    }
    snippet
}

#[derive(Clone)]
enum CachedLyrics {
    Found(Arc<LyricsResponse>),
    Missing,
}

struct MemoryEntry {
    value: CachedLyrics,
    weight: usize,
    generation: u64,
    expires_at: Instant,
}

#[derive(Default)]
struct MemoryCacheShard {
    entries: HashMap<CacheKey, MemoryEntry>,
    recency: VecDeque<(CacheKey, u64)>,
    bytes: usize,
    generation: u64,
}

struct LyricsMemoryCache {
    shards: Vec<StdMutex<MemoryCacheShard>>,
}

impl LyricsMemoryCache {
    fn new() -> Self {
        Self {
            shards: (0..MEMORY_CACHE_SHARDS)
                .map(|_| StdMutex::new(MemoryCacheShard::default()))
                .collect(),
        }
    }

    fn shard_index(key: &CacheKey) -> usize {
        let prefix = u64::from_le_bytes(key[..8].try_into().expect("cache key prefix"));
        prefix as usize % MEMORY_CACHE_SHARDS
    }

    fn get(&self, key: &CacheKey) -> Option<CachedLyrics> {
        let mut shard = self.shards[Self::shard_index(key)]
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        shard.generation = shard.generation.wrapping_add(1);
        let generation = shard.generation;
        let expired = shard
            .entries
            .get(key)
            .is_some_and(|entry| entry.expires_at <= Instant::now());
        if expired && let Some(removed) = shard.entries.remove(key) {
            shard.bytes = shard.bytes.saturating_sub(removed.weight);
        }
        let value = shard.entries.get_mut(key).map(|entry| {
            entry.generation = generation;
            entry.value.clone()
        });
        if value.is_some() {
            shard.recency.push_back((*key, generation));
            compact_recency_queue(&mut shard);
        }
        value
    }

    fn insert(&self, key: CacheKey, value: CachedLyrics) {
        self.insert_for(key, value, MEMORY_CACHE_TTL);
    }

    fn insert_for(&self, key: CacheKey, value: CachedLyrics, ttl: Duration) {
        if ttl.is_zero() {
            return;
        }
        let weight = cached_lyrics_weight(&value);
        let per_shard_bytes = MAX_MEMORY_CACHE_BYTES / MEMORY_CACHE_SHARDS;
        if weight > per_shard_bytes {
            return;
        }

        let mut shard = self.shards[Self::shard_index(&key)]
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        shard.generation = shard.generation.wrapping_add(1);
        let generation = shard.generation;
        if let Some(previous) = shard.entries.remove(&key) {
            shard.bytes = shard.bytes.saturating_sub(previous.weight);
        }
        shard.bytes = shard.bytes.saturating_add(weight);
        shard.entries.insert(
            key,
            MemoryEntry {
                value,
                weight,
                generation,
                expires_at: Instant::now() + ttl,
            },
        );
        shard.recency.push_back((key, generation));

        let per_shard_entries = MAX_MEMORY_CACHE_ENTRIES / MEMORY_CACHE_SHARDS;
        while shard.entries.len() > per_shard_entries || shard.bytes > per_shard_bytes {
            let Some((oldest_key, oldest_generation)) = shard.recency.pop_front() else {
                break;
            };
            let is_current = shard
                .entries
                .get(&oldest_key)
                .is_some_and(|entry| entry.generation == oldest_generation);
            if is_current && let Some(removed) = shard.entries.remove(&oldest_key) {
                shard.bytes = shard.bytes.saturating_sub(removed.weight);
            }
        }
        compact_recency_queue(&mut shard);
    }

    #[cfg(test)]
    fn totals(&self) -> (usize, usize) {
        self.shards.iter().fold((0, 0), |totals, shard| {
            let shard = shard
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            (totals.0 + shard.entries.len(), totals.1 + shard.bytes)
        })
    }
}

fn compact_recency_queue(shard: &mut MemoryCacheShard) {
    if shard.recency.len() <= shard.entries.len().saturating_mul(4).saturating_add(64) {
        return;
    }
    let mut current = shard
        .entries
        .iter()
        .map(|(key, entry)| (*key, entry.generation))
        .collect::<Vec<_>>();
    current.sort_by_key(|(_, generation)| *generation);
    shard.recency = current.into();
}

fn cached_lyrics_weight(value: &CachedLyrics) -> usize {
    const ENTRY_OVERHEAD: usize = 192;
    match value {
        CachedLyrics::Missing => ENTRY_OVERHEAD,
        CachedLyrics::Found(lyrics) => {
            ENTRY_OVERHEAD
                + lyrics.track_name.len()
                + lyrics.artist_name.len()
                + lyrics.album_name.len()
                + lyrics.plain_lyrics.as_ref().map_or(0, String::len)
                + lyrics.synced_lyrics.as_ref().map_or(0, String::len)
        }
    }
}

pub struct LyricsService {
    client: Client,
    cache: LyricsMemoryCache,
    persistent: DbPool,
    lookup_locks: Vec<Mutex<()>>,
    slots: Semaphore,
    persistent_writes: AtomicU64,
}

impl LyricsService {
    pub fn new() -> Result<Self, BoxError> {
        let client = Client::builder()
            .connect_timeout(LRCLIB_CONNECT_TIMEOUT)
            .timeout(LRCLIB_REQUEST_TIMEOUT)
            .tcp_keepalive(Duration::from_secs(60))
            .pool_idle_timeout(Duration::from_secs(90))
            .user_agent(concat!("Parson/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self {
            client,
            cache: LyricsMemoryCache::new(),
            persistent: connect_lyrics_cache()?,
            lookup_locks: (0..LYRICS_LOOKUP_LOCK_STRIPES)
                .map(|_| Mutex::new(()))
                .collect(),
            slots: Semaphore::new(MAX_CONCURRENT_LYRICS_REQUESTS),
            persistent_writes: AtomicU64::new(0),
        })
    }

    fn should_purge_expired(&self) -> bool {
        self.persistent_writes.fetch_add(1, Ordering::Relaxed) % EXPIRED_PURGE_INTERVAL
            == EXPIRED_PURGE_INTERVAL - 1
    }

    pub(crate) async fn search(&self, query: &str) -> Result<Vec<LyricsSearchHit>, BoxError> {
        if !lyric_query_is_confident(query) {
            return Ok(Vec::new());
        }
        let pool = self.persistent.clone();
        let query = query.to_string();
        tokio::task::spawn_blocking(move || {
            let mut connection = pool.get()?;
            search_persisted_lyrics(&mut connection, &query, unix_seconds())
        })
        .await
        .map_err(|error| std::io::Error::other(format!("lyrics search task failed: {error}")))?
    }

    pub(crate) async fn backfill_search_index(
        &self,
        library: Arc<LibraryCache>,
    ) -> Result<usize, BoxError> {
        let pool = self.persistent.clone();
        tokio::task::spawn_blocking(move || {
            let mut songs = Vec::with_capacity(library.songs_flat.len());
            for artist in library.artists.iter() {
                for album in &artist.albums {
                    for song in &album.songs {
                        let signature =
                            lyrics_signature(&song.name, &artist.name, &album.name, song.duration);
                        songs.push((song.id.clone(), lyrics_cache_key(&signature)));
                    }
                }
            }

            let mut connection = pool.get()?;
            let already_indexed =
                diesel::sql_query("SELECT song_id, cache_key FROM lrclib_lyrics_search")
                    .load::<IndexedLyricsKeyRow>(&mut connection)?
                    .into_iter()
                    .map(|row| (row.song_id, row.cache_key))
                    .collect::<HashSet<_>>();
            let now = unix_seconds();
            let mut indexed = 0;
            for (song_id, key) in songs {
                let key_text = lyrics_cache_key_text(key);
                if already_indexed.contains(&(song_id.clone(), key_text)) {
                    continue;
                }
                let Some((value @ CachedLyrics::Found(_), valid_for)) =
                    load_persisted_lyrics(&mut connection, key, now)?
                else {
                    continue;
                };
                let expires_at =
                    now.saturating_add(valid_for.as_secs().min(i64::MAX as u64) as i64);
                update_lyrics_search_document(&mut connection, &song_id, key, &value, expires_at)?;
                indexed += 1;
            }
            Ok(indexed)
        })
        .await
        .map_err(|error| std::io::Error::other(format!("lyrics backfill task failed: {error}")))?
    }
}

#[derive(Serialize)]
struct LrclibQuery<'a> {
    track_name: &'a str,
    artist_name: &'a str,
    album_name: &'a str,
    duration: u64,
}

#[derive(Serialize)]
struct LrclibSearchQuery<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    q: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    track_name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    artist_name: Option<&'a str>,
}

fn has_lyrics(lyrics: &LyricsResponse) -> bool {
    lyrics.instrumental
        || lyrics
            .synced_lyrics
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        || lyrics
            .plain_lyrics
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
}

fn select_lrclib_search_match(
    candidates: Vec<LyricsResponse>,
    track_name: &str,
    artist_name: &str,
    album_name: &str,
    duration: f64,
) -> Option<LyricsResponse> {
    let track_name = normalize(track_name);
    let artist_name = normalize(artist_name);
    let album_name = normalize(album_name);

    candidates
        .into_iter()
        .filter(|candidate| {
            normalize(&candidate.track_name) == track_name
                && normalize(&candidate.artist_name) == artist_name
                && (candidate.duration - duration).abs() <= LRCLIB_SEARCH_DURATION_TOLERANCE_SECONDS
                && has_lyrics(candidate)
        })
        .max_by(|left, right| {
            let rank = |candidate: &LyricsResponse| {
                (
                    candidate
                        .synced_lyrics
                        .as_deref()
                        .is_some_and(|value| !value.trim().is_empty()),
                    normalize(&candidate.album_name) == album_name,
                )
            };
            rank(left).cmp(&rank(right)).then_with(|| {
                let left_delta = (left.duration - duration).abs();
                let right_delta = (right.duration - duration).abs();
                right_delta
                    .partial_cmp(&left_delta)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
        })
}

async fn read_lrclib_json<T: DeserializeOwned>(
    mut response: reqwest::Response,
) -> Result<T, BoxError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_LYRICS_RESPONSE_BYTES as u64)
    {
        return Err(std::io::Error::other("LRCLIB response exceeds size limit").into());
    }

    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if body.len().saturating_add(chunk.len()) > MAX_LYRICS_RESPONSE_BYTES {
            return Err(std::io::Error::other("LRCLIB response exceeds size limit").into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&body)?)
}

async fn search_lrclib_fallback(
    service: &LyricsService,
    track_name: &str,
    artist_name: &str,
    album_name: &str,
    duration: f64,
) -> Result<Option<LyricsResponse>, BoxError> {
    let broad_query = format!("{track_name} {artist_name}");
    let attempts = [
        (
            "track_artist",
            LrclibSearchQuery {
                q: None,
                track_name: Some(track_name),
                artist_name: Some(artist_name),
            },
        ),
        (
            "broad_track_artist",
            LrclibSearchQuery {
                q: Some(&broad_query),
                track_name: None,
                artist_name: None,
            },
        ),
        (
            "broad_track",
            LrclibSearchQuery {
                q: Some(track_name),
                track_name: None,
                artist_name: None,
            },
        ),
    ];
    let mut successful_request = false;
    let mut last_error = None;

    for (query_kind, query) in attempts {
        let started = Instant::now();
        let response = match service
            .client
            .get(LRCLIB_SEARCH_URL)
            .query(&query)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(
                    query_kind,
                    elapsed_ms = started.elapsed().as_millis() as u64,
                    timeout = error.is_timeout(),
                    connect = error.is_connect(),
                    %error,
                    "LRCLIB fallback search request failed"
                );
                last_error = Some(error.to_string());
                continue;
            }
        };
        if !response.status().is_success() {
            let error = format!("LRCLIB fallback search returned {}", response.status());
            tracing::warn!(query_kind, status = %response.status(), "{error}");
            last_error = Some(error);
            continue;
        }
        successful_request = true;
        let candidates = match read_lrclib_json::<Vec<LyricsResponse>>(response).await {
            Ok(candidates) => candidates,
            Err(error) => {
                tracing::warn!(query_kind, %error, "could not read LRCLIB fallback search response");
                last_error = Some(error.to_string());
                continue;
            }
        };
        if let Some(matched) =
            select_lrclib_search_match(candidates, track_name, artist_name, album_name, duration)
        {
            tracing::info!(
                query_kind,
                lrclib_id = matched.id,
                synced = matched.synced_lyrics.is_some(),
                elapsed_ms = started.elapsed().as_millis() as u64,
                "matched lyrics through LRCLIB fallback search"
            );
            return Ok(Some(matched));
        }
    }

    if successful_request {
        Ok(None)
    } else {
        Err(std::io::Error::other(
            last_error.unwrap_or_else(|| "all LRCLIB fallback searches failed".into()),
        )
        .into())
    }
}

#[derive(QueryableByName)]
struct PersistedLyricsRow {
    #[diesel(sql_type = Integer)]
    response_kind: i32,
    #[diesel(sql_type = Binary)]
    payload: Vec<u8>,
    #[diesel(sql_type = BigInt)]
    uncompressed_bytes: i64,
    #[diesel(sql_type = BigInt)]
    expires_at: i64,
}

#[derive(QueryableByName)]
struct PersistedLyricsSearchRow {
    #[diesel(sql_type = Text)]
    song_id: String,
    #[diesel(sql_type = Text)]
    lyrics: String,
}

#[derive(QueryableByName)]
struct IndexedLyricsKeyRow {
    #[diesel(sql_type = Text)]
    song_id: String,
    #[diesel(sql_type = Text)]
    cache_key: String,
}

fn lyrics_cache_key(signature: &str) -> CacheKey {
    Sha256::digest(signature.as_bytes()).into()
}

fn lyrics_cache_key_text(key: CacheKey) -> String {
    key.iter().map(|byte| format!("{byte:02X}")).collect()
}

fn lyrics_signature(
    track_name: &str,
    artist_name: &str,
    album_name: &str,
    duration: f64,
) -> String {
    format!(
        "{track_name}\0{artist_name}\0{album_name}\0{}",
        duration.round()
    )
}

fn search_persisted_lyrics(
    conn: &mut SqliteConnection,
    query: &str,
    now: i64,
) -> Result<Vec<LyricsSearchHit>, BoxError> {
    let Some(expression) = lyrics_match_expression(query) else {
        return Ok(Vec::new());
    };
    let normalized_query = normalize(query);
    let rows = diesel::sql_query(
        "SELECT song_id, lyrics
         FROM lrclib_lyrics_search
         WHERE lrclib_lyrics_search MATCH ?
           AND CAST(expires_at AS INTEGER) > ?
         ORDER BY bm25(lrclib_lyrics_search)
         LIMIT ?",
    )
    .bind::<Text, _>(expression)
    .bind::<BigInt, _>(now)
    .bind::<BigInt, _>(MAX_LYRICS_SEARCH_CANDIDATES)
    .load::<PersistedLyricsSearchRow>(conn)?;

    let mut best_by_song = HashMap::<String, LyricsSearchHit>::new();
    for row in rows {
        let normalized_lyrics = normalize(&row.lyrics);
        let exact_phrase = normalized_phrase_in(&normalized_lyrics, &normalized_query);
        let token_count = normalized_query.split_whitespace().count() as f32;
        let score = if exact_phrase {
            (330.0 + token_count.min(10.0)).min(340.0)
        } else {
            (180.0 + token_count.min(10.0) * 3.0).min(210.0)
        };
        let candidate = LyricsSearchHit {
            song_id: row.song_id.clone(),
            score,
            snippet: lyric_snippet(&row.lyrics, &normalized_query),
            exact_phrase,
        };
        best_by_song
            .entry(row.song_id)
            .and_modify(|current| {
                if candidate.score > current.score {
                    *current = candidate.clone();
                }
            })
            .or_insert(candidate);
    }
    let mut hits = best_by_song.into_values().collect::<Vec<_>>();
    hits.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.song_id.cmp(&right.song_id))
    });
    Ok(hits)
}

fn update_lyrics_search_document(
    conn: &mut SqliteConnection,
    song_id: &str,
    key: CacheKey,
    value: &CachedLyrics,
    expires_at: i64,
) -> Result<(), BoxError> {
    let key_text = lyrics_cache_key_text(key);
    let CachedLyrics::Found(lyrics) = value else {
        diesel::sql_query("DELETE FROM lrclib_lyrics_search WHERE song_id = ? OR cache_key = ?")
            .bind::<Text, _>(song_id)
            .bind::<Text, _>(key_text)
            .execute(conn)?;
        return Ok(());
    };
    diesel::sql_query("DELETE FROM lrclib_lyrics_search WHERE song_id = ?")
        .bind::<Text, _>(song_id)
        .execute(conn)?;
    let Some(searchable) = searchable_lyrics(lyrics) else {
        return Ok(());
    };
    diesel::sql_query(
        "INSERT INTO lrclib_lyrics_search
            (song_id, cache_key, expires_at, lyrics, search_text)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind::<Text, _>(song_id)
    .bind::<Text, _>(key_text)
    .bind::<BigInt, _>(expires_at)
    .bind::<Text, _>(&searchable)
    .bind::<Text, _>(normalize(&searchable))
    .execute(conn)?;
    Ok(())
}

fn unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .min(i64::MAX as u64) as i64
}

fn encode_lyrics(lyrics: &LyricsResponse) -> Result<(Vec<u8>, usize), BoxError> {
    let json = serde_json::to_vec(lyrics)?;
    if json.len() > MAX_LYRICS_RESPONSE_BYTES {
        return Err(std::io::Error::other("lyrics payload exceeds storage limit").into());
    }
    let compressed = zstd::bulk::compress(&json, ZSTD_COMPRESSION_LEVEL)?;
    Ok((compressed, json.len()))
}

fn decode_lyrics(payload: &[u8], uncompressed_bytes: i64) -> Result<LyricsResponse, BoxError> {
    let expected = usize::try_from(uncompressed_bytes)
        .ok()
        .filter(|size| *size <= MAX_LYRICS_RESPONSE_BYTES)
        .ok_or_else(|| std::io::Error::other("invalid persisted lyrics size"))?;
    let json = zstd::bulk::decompress(payload, expected)?;
    if json.len() != expected {
        return Err(std::io::Error::other("persisted lyrics size mismatch").into());
    }
    Ok(serde_json::from_slice(&json)?)
}

fn load_persisted_lyrics(
    conn: &mut SqliteConnection,
    key: CacheKey,
    now: i64,
) -> Result<Option<(CachedLyrics, Duration)>, BoxError> {
    let rows = diesel::sql_query(
        "SELECT response_kind, payload, uncompressed_bytes, expires_at
         FROM lrclib_lyrics_cache
         WHERE cache_key = ? AND expires_at > ?",
    )
    .bind::<Binary, _>(key.to_vec())
    .bind::<BigInt, _>(now)
    .load::<PersistedLyricsRow>(conn)?;
    let Some(row) = rows.into_iter().next() else {
        return Ok(None);
    };
    let valid_for = Duration::from_secs(row.expires_at.saturating_sub(now) as u64);
    let value = match row.response_kind {
        0 => CachedLyrics::Missing,
        1 => CachedLyrics::Found(Arc::new(decode_lyrics(
            &row.payload,
            row.uncompressed_bytes,
        )?)),
        _ => return Err(std::io::Error::other("invalid persisted lyrics kind").into()),
    };
    Ok(Some((value, valid_for)))
}

fn store_persisted_lyrics(
    conn: &mut SqliteConnection,
    key: CacheKey,
    value: &CachedLyrics,
    song_id: Option<&str>,
    now: i64,
    purge_expired: bool,
) -> Result<(), BoxError> {
    let (response_kind, payload, uncompressed_bytes, ttl) = match value {
        CachedLyrics::Missing => (0, Vec::new(), 0_i64, NEGATIVE_CACHE_TTL),
        CachedLyrics::Found(lyrics) => {
            let (payload, size) = encode_lyrics(lyrics)?;
            (1, payload, size as i64, POSITIVE_CACHE_TTL)
        }
    };
    let expires_at = now.saturating_add(ttl.as_secs().min(i64::MAX as u64) as i64);
    conn.transaction::<_, diesel::result::Error, _>(|conn| {
        diesel::sql_query(
            "INSERT INTO lrclib_lyrics_cache
                (cache_key, response_kind, payload, uncompressed_bytes, codec, stored_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(cache_key) DO UPDATE SET
                response_kind = excluded.response_kind,
                payload = excluded.payload,
                uncompressed_bytes = excluded.uncompressed_bytes,
                codec = excluded.codec,
                stored_at = excluded.stored_at,
                expires_at = excluded.expires_at",
        )
        .bind::<Binary, _>(key.to_vec())
        .bind::<Integer, _>(response_kind)
        .bind::<Binary, _>(payload)
        .bind::<BigInt, _>(uncompressed_bytes)
        .bind::<Integer, _>(ZSTD_JSON_CODEC)
        .bind::<BigInt, _>(now)
        .bind::<BigInt, _>(expires_at)
        .execute(conn)?;

        if let Some(song_id) = song_id {
            update_lyrics_search_document(conn, song_id, key, value, expires_at)
                .map_err(|_| diesel::result::Error::RollbackTransaction)?;
        }

        if purge_expired {
            diesel::sql_query(format!(
                "DELETE FROM lrclib_lyrics_search
                 WHERE cache_key IN (
                    SELECT hex(cache_key) FROM lrclib_lyrics_cache
                    WHERE expires_at <= {now}
                    ORDER BY expires_at
                    LIMIT {EXPIRED_PURGE_BATCH}
                 )"
            ))
            .execute(conn)?;
            diesel::sql_query(format!(
                "DELETE FROM lrclib_lyrics_cache
                 WHERE cache_key IN (
                    SELECT cache_key FROM lrclib_lyrics_cache
                    WHERE expires_at <= {now}
                    ORDER BY expires_at
                    LIMIT {EXPIRED_PURGE_BATCH}
                 )"
            ))
            .execute(conn)?;
            conn.batch_execute("PRAGMA incremental_vacuum(256);")?;
        }
        Ok(())
    })?;
    Ok(())
}

async fn load_persisted(
    pool: DbPool,
    key: CacheKey,
) -> Result<Option<(CachedLyrics, Duration)>, BoxError> {
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get()?;
        load_persisted_lyrics(&mut conn, key, unix_seconds())
    })
    .await
    .map_err(|error| std::io::Error::other(format!("lyrics cache read task failed: {error}")))?
}

async fn index_cached_lyrics(
    pool: DbPool,
    key: CacheKey,
    song_id: String,
    value: CachedLyrics,
    valid_for: Duration,
) -> Result<(), BoxError> {
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get()?;
        let expires_at =
            unix_seconds().saturating_add(valid_for.as_secs().min(i64::MAX as u64) as i64);
        update_lyrics_search_document(&mut conn, &song_id, key, &value, expires_at)
    })
    .await
    .map_err(|error| std::io::Error::other(format!("lyrics index task failed: {error}")))?
}

async fn store_persisted(
    pool: DbPool,
    key: CacheKey,
    value: CachedLyrics,
    song_id: String,
    purge_expired: bool,
) -> Result<(), BoxError> {
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get()?;
        store_persisted_lyrics(
            &mut conn,
            key,
            &value,
            Some(&song_id),
            unix_seconds(),
            purge_expired,
        )
    })
    .await
    .map_err(|error| std::io::Error::other(format!("lyrics cache write task failed: {error}")))?
}

fn cached_http_response(value: CachedLyrics) -> HttpResponse {
    match value {
        CachedLyrics::Found(lyrics) => HttpResponse::Ok().json(lyrics.as_ref()),
        CachedLyrics::Missing => not_found("Lyrics not found.", "lyrics_not_found"),
    }
}

#[get("/lyrics/{song_id}")]
async fn find_lyrics(
    song_id: web::Path<String>,
    lifecycle: web::Data<LibraryLifecycle>,
    service: web::Data<LyricsService>,
) -> HttpResponse {
    let library = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let song_id = song_id.into_inner();
    let Some(song) = library.song(&song_id) else {
        return not_found("Song not found.", "song_not_found");
    };
    let Some((artist_id, album_id)) = library.song_map.get(&song_id) else {
        return not_found("Song context not found.", "song_context_not_found");
    };
    let (Some(artist), Some(album)) = (library.artist(artist_id), library.album(album_id)) else {
        return not_found("Song context not found.", "song_context_not_found");
    };

    let signature = lyrics_signature(&song.name, &artist.name, &album.name, song.duration);
    let cache_key = lyrics_cache_key(&signature);
    if let Some(cached) = service.cache.get(&cache_key) {
        return cached_http_response(cached);
    }

    let lock_index = LyricsMemoryCache::shard_index(&cache_key) % service.lookup_locks.len();
    let _lookup_guard = service.lookup_locks[lock_index].lock().await;
    if let Some(cached) = service.cache.get(&cache_key) {
        return cached_http_response(cached);
    }

    match load_persisted(service.persistent.clone(), cache_key).await {
        Ok(Some((cached, valid_for))) => {
            service
                .cache
                .insert_for(cache_key, cached.clone(), valid_for.min(MEMORY_CACHE_TTL));
            if let Err(error) = index_cached_lyrics(
                service.persistent.clone(),
                cache_key,
                song_id.clone(),
                cached.clone(),
                valid_for,
            )
            .await
            {
                tracing::warn!(%error, "could not index persisted lyrics");
            }
            return cached_http_response(cached);
        }
        Ok(None) => {}
        Err(error) => tracing::warn!(%error, "could not read the persistent lyrics cache"),
    }

    let _permit = match service.slots.try_acquire() {
        Ok(permit) => permit,
        Err(_) => {
            return crate::api::error::service_unavailable(
                "Too many lyrics lookups are in progress. Retry shortly.",
                "lyrics_capacity_reached",
            );
        }
    };

    let started = Instant::now();
    let exact_response = service
        .client
        .get(LRCLIB_GET_URL)
        .query(&LrclibQuery {
            track_name: &song.name,
            artist_name: &artist.name,
            album_name: &album.name,
            duration: song.duration.round().max(0.0) as u64,
        })
        .send()
        .await;

    let exact_lyrics = match exact_response {
        Ok(response) if response.status().is_success() => {
            tracing::debug!(
                elapsed_ms = started.elapsed().as_millis() as u64,
                status = %response.status(),
                "LRCLIB exact lyrics request completed"
            );
            match read_lrclib_json::<LyricsResponse>(response).await {
                Ok(lyrics) => Some(lyrics),
                Err(error) => {
                    tracing::warn!(%error, "could not read LRCLIB exact lyrics response");
                    None
                }
            }
        }
        Ok(response) => {
            tracing::debug!(
                elapsed_ms = started.elapsed().as_millis() as u64,
                status = %response.status(),
                "LRCLIB exact lyrics request did not match"
            );
            None
        }
        Err(error) => {
            tracing::warn!(
                elapsed_ms = started.elapsed().as_millis() as u64,
                timeout = error.is_timeout(),
                connect = error.is_connect(),
                %error,
                "LRCLIB exact lyrics request failed; trying search fallbacks"
            );
            None
        }
    };

    let lyrics = match exact_lyrics {
        Some(lyrics) => Some(lyrics),
        None => match search_lrclib_fallback(
            service.get_ref(),
            &song.name,
            &artist.name,
            &album.name,
            song.duration,
        )
        .await
        {
            Ok(lyrics) => lyrics,
            Err(error) => {
                tracing::warn!(%error, "all LRCLIB lyrics lookup strategies failed");
                return internal_server_error(
                    "Lyrics provider unavailable.",
                    "lyrics_provider_unavailable",
                );
            }
        },
    };

    let Some(lyrics) = lyrics else {
        let missing = CachedLyrics::Missing;
        service.cache.insert(cache_key, missing.clone());
        if let Err(error) = store_persisted(
            service.persistent.clone(),
            cache_key,
            missing,
            song_id.clone(),
            service.should_purge_expired(),
        )
        .await
        {
            tracing::warn!(%error, "could not persist a negative lyrics lookup");
        }
        return not_found("Lyrics not found.", "lyrics_not_found");
    };

    let cached = CachedLyrics::Found(Arc::new(lyrics));
    service.cache.insert(cache_key, cached.clone());
    if let Err(error) = store_persisted(
        service.persistent.clone(),
        cache_key,
        cached.clone(),
        song_id,
        service.should_purge_expired(),
    )
    .await
    {
        tracing::warn!(%error, "could not persist lyrics");
    }
    cached_http_response(cached)
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(find_lyrics);
}

#[cfg(test)]
mod tests {
    use diesel::Connection;
    use diesel::RunQueryDsl;
    use diesel::connection::SimpleConnection;
    use diesel::deserialize::QueryableByName;
    use diesel::sql_types::{BigInt, Integer, Text};
    use diesel::sqlite::SqliteConnection;

    use super::{
        CachedLyrics, LYRICS_CACHE_SCHEMA, LyricsMemoryCache, LyricsResponse,
        MAX_MEMORY_CACHE_BYTES, MAX_MEMORY_CACHE_ENTRIES, POSITIVE_CACHE_TTL, decode_lyrics,
        encode_lyrics, load_persisted_lyrics, lyric_query_is_confident, lyrics_cache_key,
        search_persisted_lyrics, select_lrclib_search_match, store_persisted_lyrics,
    };
    use std::sync::Arc;
    use std::time::Duration;

    #[derive(QueryableByName)]
    struct CountRow {
        #[diesel(sql_type = BigInt)]
        count: i64,
    }

    #[derive(QueryableByName)]
    #[allow(dead_code)]
    struct QueryPlanRow {
        #[diesel(sql_type = Integer)]
        id: i32,
        #[diesel(sql_type = Integer)]
        parent: i32,
        #[diesel(sql_type = Integer)]
        notused: i32,
        #[diesel(sql_type = Text)]
        detail: String,
    }

    fn lyrics(id: i64, repeated_lines: usize) -> LyricsResponse {
        LyricsResponse {
            id,
            track_name: format!("track-{id}"),
            artist_name: "artist".into(),
            album_name: "album".into(),
            duration: 60.0,
            instrumental: false,
            plain_lyrics: Some("A repeated lyrical line\n".repeat(repeated_lines)),
            synced_lyrics: Some("[00:01.00] A repeated lyrical line\n".repeat(repeated_lines)),
        }
    }

    fn cache_database() -> SqliteConnection {
        let mut connection = SqliteConnection::establish(":memory:").expect("lyrics cache db");
        connection
            .batch_execute(LYRICS_CACHE_SCHEMA)
            .expect("lyrics cache schema");
        connection
    }

    #[test]
    fn lrclib_search_fallback_selects_the_best_match_from_noisy_results() {
        let candidates = vec![
            LyricsResponse {
                id: 315_198,
                track_name: "One Clear Line (Copper Sky Remix)".into(),
                artist_name: "Nora Reed".into(),
                album_name: "Open Letters (Deluxe)".into(),
                duration: 256.0,
                instrumental: false,
                plain_lyrics: Some("wrong song".into()),
                synced_lyrics: Some("[00:01.00] wrong song".into()),
            },
            LyricsResponse {
                id: 36_127_943,
                track_name: "Crimson Tide".into(),
                artist_name: "Casey Rivers".into(),
                album_name: "City Festival: Live 2013".into(),
                duration: 301.0,
                instrumental: false,
                plain_lyrics: Some("live version".into()),
                synced_lyrics: Some("[00:01.00] live version".into()),
            },
            LyricsResponse {
                id: 555_474,
                track_name: "Crimson Tide".into(),
                artist_name: "Casey Rivers".into(),
                album_name: "Twin Horizons - 2 of 2".into(),
                duration: 571.0,
                instrumental: false,
                plain_lyrics: Some("correct song".into()),
                synced_lyrics: Some("[00:01.00] correct song".into()),
            },
        ];

        let matched = select_lrclib_search_match(
            candidates,
            "Crimson Tide",
            "Casey Rivers",
            "Twin Horizons 2 of 2",
            571.0,
        )
        .expect("Crimson Tide search match");
        assert_eq!(matched.id, 555_474);
        assert!(matched.synced_lyrics.is_some());
    }

    #[test]
    fn lrclib_search_fallback_rejects_wrong_artist_and_bad_duration() {
        let candidates = vec![
            LyricsResponse {
                id: 1,
                track_name: "Crimson Tide".into(),
                artist_name: "Harbor Lines".into(),
                album_name: "Open Questions".into(),
                duration: 571.0,
                instrumental: false,
                plain_lyrics: Some("wrong artist".into()),
                synced_lyrics: Some("[00:01.00] wrong artist".into()),
            },
            LyricsResponse {
                id: 2,
                track_name: "Crimson Tide".into(),
                artist_name: "Casey Rivers".into(),
                album_name: "Live".into(),
                duration: 301.0,
                instrumental: false,
                plain_lyrics: Some("wrong duration".into()),
                synced_lyrics: Some("[00:01.00] wrong duration".into()),
            },
        ];

        assert!(
            select_lrclib_search_match(
                candidates,
                "Crimson Tide",
                "Casey Rivers",
                "Twin Horizons 2 of 2",
                571.0,
            )
            .is_none()
        );
    }

    #[test]
    fn memory_cache_stays_bounded_by_entries_and_estimated_bytes() {
        let cache = LyricsMemoryCache::new();
        for id in 0..(MAX_MEMORY_CACHE_ENTRIES as i64 + 500) {
            cache.insert(
                lyrics_cache_key(&id.to_string()),
                CachedLyrics::Found(Arc::new(lyrics(id, 16))),
            );
        }
        let (entries, bytes) = cache.totals();
        assert!(entries <= MAX_MEMORY_CACHE_ENTRIES, "{entries}");
        assert!(bytes <= MAX_MEMORY_CACHE_BYTES, "{bytes}");
    }

    #[test]
    fn zstd_payloads_round_trip_and_materially_reduce_lyrics_storage() {
        let original = lyrics(7, 100);
        let raw = serde_json::to_vec(&original).unwrap();
        let (compressed, uncompressed_bytes) = encode_lyrics(&original).unwrap();
        assert!(
            compressed.len() * 3 < raw.len(),
            "{} vs {}",
            compressed.len(),
            raw.len()
        );
        let decoded = decode_lyrics(&compressed, uncompressed_bytes as i64).unwrap();
        assert_eq!(decoded.id, original.id);
        assert_eq!(decoded.plain_lyrics, original.plain_lyrics);
        assert_eq!(decoded.synced_lyrics, original.synced_lyrics);
    }

    #[test]
    fn persistent_cache_round_trips_hits_and_negative_results() {
        let mut connection = cache_database();
        let found_key = lyrics_cache_key("found");
        let missing_key = lyrics_cache_key("missing");
        let found = CachedLyrics::Found(Arc::new(lyrics(9, 20)));
        store_persisted_lyrics(&mut connection, found_key, &found, None, 1_000, false).unwrap();
        store_persisted_lyrics(
            &mut connection,
            missing_key,
            &CachedLyrics::Missing,
            None,
            1_000,
            false,
        )
        .unwrap();

        assert!(matches!(
            load_persisted_lyrics(&mut connection, found_key, 1_001).unwrap(),
            Some((CachedLyrics::Found(_), _))
        ));
        assert!(matches!(
            load_persisted_lyrics(&mut connection, missing_key, 1_001).unwrap(),
            Some((CachedLyrics::Missing, _))
        ));
        assert!(
            load_persisted_lyrics(&mut connection, missing_key, 22_601)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn locally_cached_lyrics_are_searchable_without_a_provider_request() {
        let mut connection = cache_database();
        let found = CachedLyrics::Found(Arc::new(LyricsResponse {
            plain_lyrics: Some(
                "Hello from the other side\nI must have called a thousand times".into(),
            ),
            ..lyrics(10, 0)
        }));
        store_persisted_lyrics(
            &mut connection,
            lyrics_cache_key("searchable"),
            &found,
            Some("song-hello"),
            1_000,
            false,
        )
        .unwrap();

        let hits =
            search_persisted_lyrics(&mut connection, "hello from the other side", 1_001).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].song_id, "song-hello");
        assert!(hits[0].exact_phrase);
        assert!(hits[0].snippet.contains("Hello from the other side"));
    }

    #[test]
    fn lyric_search_requires_enough_evidence_and_never_uses_fts_syntax() {
        assert!(!lyric_query_is_confident("love"));
        assert!(!lyric_query_is_confident("you and"));
        assert!(lyric_query_is_confident("violet weather"));
        assert!(lyric_query_is_confident("supercalifragilistic"));

        let mut connection = cache_database();
        assert!(
            search_persisted_lyrics(&mut connection, "love OR *", 1_000)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn synced_only_lyrics_are_indexed_without_timestamps() {
        let mut connection = cache_database();
        let found = CachedLyrics::Found(Arc::new(LyricsResponse {
            plain_lyrics: None,
            synced_lyrics: Some(
                "[00:01.00]Ground control to Major Tom\n[00:05.00]Commencing countdown engines on"
                    .into(),
            ),
            ..lyrics(11, 0)
        }));
        store_persisted_lyrics(
            &mut connection,
            lyrics_cache_key("synced"),
            &found,
            Some("song-space"),
            1_000,
            false,
        )
        .unwrap();

        let hits = search_persisted_lyrics(&mut connection, "ground control major", 1_001).unwrap();
        assert_eq!(hits[0].song_id, "song-space");
        assert!(!hits[0].snippet.contains("00:01"));
    }

    #[test]
    fn legacy_cached_lyrics_can_be_backfilled_without_downloading_again() {
        let mut connection = cache_database();
        let key = lyrics_cache_key("legacy");
        let found = CachedLyrics::Found(Arc::new(LyricsResponse {
            plain_lyrics: Some("Words retained inside the legacy local cache".into()),
            ..lyrics(13, 0)
        }));
        store_persisted_lyrics(&mut connection, key, &found, None, 1_000, false).unwrap();
        assert!(
            search_persisted_lyrics(&mut connection, "retained legacy local", 1_001)
                .unwrap()
                .is_empty()
        );

        let (cached, valid_for) = load_persisted_lyrics(&mut connection, key, 1_001)
            .unwrap()
            .unwrap();
        super::update_lyrics_search_document(
            &mut connection,
            "song-legacy",
            key,
            &cached,
            1_001 + valid_for.as_secs() as i64,
        )
        .unwrap();

        let hits =
            search_persisted_lyrics(&mut connection, "retained legacy local", 1_002).unwrap();
        assert_eq!(hits[0].song_id, "song-legacy");
    }

    #[test]
    fn a_negative_shared_cache_result_removes_every_stale_duplicate() {
        let mut connection = cache_database();
        let key = lyrics_cache_key("shared-signature");
        let found = CachedLyrics::Found(Arc::new(LyricsResponse {
            plain_lyrics: Some("Shared signature has uniquely searchable words".into()),
            ..lyrics(14, 0)
        }));
        for song_id in ["duplicate-a", "duplicate-b"] {
            store_persisted_lyrics(&mut connection, key, &found, Some(song_id), 1_000, false)
                .unwrap();
        }
        assert_eq!(
            search_persisted_lyrics(&mut connection, "uniquely searchable words", 1_001)
                .unwrap()
                .len(),
            2
        );

        store_persisted_lyrics(
            &mut connection,
            key,
            &CachedLyrics::Missing,
            Some("duplicate-a"),
            1_002,
            false,
        )
        .unwrap();
        assert!(
            search_persisted_lyrics(&mut connection, "uniquely searchable words", 1_003)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn cache_replacements_and_expiry_cannot_leave_searchable_stale_lyrics() {
        let mut connection = cache_database();
        let key = lyrics_cache_key("replace");
        let found = CachedLyrics::Found(Arc::new(LyricsResponse {
            plain_lyrics: Some("Distinctive words from vanished lyrics".into()),
            ..lyrics(12, 0)
        }));
        store_persisted_lyrics(
            &mut connection,
            key,
            &found,
            Some("song-replaced"),
            1_000,
            false,
        )
        .unwrap();
        assert!(
            !search_persisted_lyrics(&mut connection, "distinctive vanished lyrics", 1_001)
                .unwrap()
                .is_empty()
        );
        store_persisted_lyrics(
            &mut connection,
            key,
            &CachedLyrics::Missing,
            Some("song-replaced"),
            1_002,
            false,
        )
        .unwrap();
        assert!(
            search_persisted_lyrics(&mut connection, "distinctive vanished lyrics", 1_003)
                .unwrap()
                .is_empty()
        );

        let expiring_key = lyrics_cache_key("expiring");
        store_persisted_lyrics(
            &mut connection,
            expiring_key,
            &found,
            Some("song-expired"),
            1_000,
            false,
        )
        .unwrap();
        assert!(
            search_persisted_lyrics(
                &mut connection,
                "distinctive vanished lyrics",
                1_000 + POSITIVE_CACHE_TTL.as_secs() as i64 + 1,
            )
            .unwrap()
            .is_empty()
        );
    }

    #[test]
    fn persistent_cache_uses_compact_primary_key_and_indexed_expiry_access() {
        let mut connection = cache_database();
        let schema = diesel::sql_query(
            "SELECT COALESCE(sql, '') AS detail, 0 AS id, 0 AS parent, 0 AS notused
             FROM sqlite_master WHERE name = 'lrclib_lyrics_cache'",
        )
        .get_result::<QueryPlanRow>(&mut connection)
        .unwrap();
        assert!(schema.detail.contains("WITHOUT ROWID"));

        let lookup = diesel::sql_query(
            "EXPLAIN QUERY PLAN
             SELECT response_kind, payload, uncompressed_bytes
             FROM lrclib_lyrics_cache
             WHERE cache_key = X'0000000000000000000000000000000000000000000000000000000000000000'
               AND expires_at > 0",
        )
        .load::<QueryPlanRow>(&mut connection)
        .unwrap();
        assert!(
            lookup.iter().any(|row| row.detail.contains("PRIMARY KEY")),
            "{:?}",
            lookup.iter().map(|row| &row.detail).collect::<Vec<_>>()
        );

        let expiry = diesel::sql_query(
            "EXPLAIN QUERY PLAN
             SELECT cache_key FROM lrclib_lyrics_cache
             WHERE expires_at <= 0 ORDER BY expires_at LIMIT 1024",
        )
        .load::<QueryPlanRow>(&mut connection)
        .unwrap();
        assert!(
            expiry
                .iter()
                .any(|row| row.detail.contains("idx_lrclib_lyrics_cache_expiry")),
            "{:?}",
            expiry.iter().map(|row| &row.detail).collect::<Vec<_>>()
        );
    }

    #[test]
    fn expired_cleanup_is_bounded_and_preserves_live_entries() {
        let mut connection = cache_database();
        for id in 0..1_100 {
            store_persisted_lyrics(
                &mut connection,
                lyrics_cache_key(&format!("expired-{id}")),
                &CachedLyrics::Missing,
                None,
                0,
                false,
            )
            .unwrap();
        }
        store_persisted_lyrics(
            &mut connection,
            lyrics_cache_key("live"),
            &CachedLyrics::Missing,
            None,
            30_000,
            true,
        )
        .unwrap();

        let remaining =
            diesel::sql_query("SELECT CAST(COUNT(*) AS BIGINT) AS count FROM lrclib_lyrics_cache")
                .get_result::<CountRow>(&mut connection)
                .unwrap()
                .count;
        assert_eq!(remaining, 77);
    }

    #[test]
    #[ignore = "ten-million-row on-disk lyrics cache benchmark"]
    fn ten_million_row_cache_keeps_point_reads_index_bounded() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../target")
            .join(format!("lyrics-scale-{}.db", uuid::Uuid::new_v4()));
        let mut connection = SqliteConnection::establish(path.to_str().unwrap()).unwrap();
        connection
            .batch_execute(
                "PRAGMA journal_mode = OFF;
                 PRAGMA synchronous = OFF;
                 PRAGMA temp_store = MEMORY;",
            )
            .unwrap();
        connection.batch_execute(LYRICS_CACHE_SCHEMA).unwrap();

        let target_key = lyrics_cache_key("ten-million-target");
        store_persisted_lyrics(
            &mut connection,
            target_key,
            &CachedLyrics::Missing,
            None,
            1_000,
            false,
        )
        .unwrap();
        connection
            .batch_execute(
                "WITH RECURSIVE sequence(value) AS (
                    SELECT 1
                    UNION ALL
                    SELECT value + 1 FROM sequence WHERE value < 9999999
                 )
                 INSERT INTO lrclib_lyrics_cache
                    (cache_key, response_kind, payload, uncompressed_bytes, codec, stored_at, expires_at)
                 SELECT CAST(printf('%032d', value) AS BLOB), 0, X'', 0, 1, 1000, 22600
                 FROM sequence;",
            )
            .unwrap();

        let started = std::time::Instant::now();
        for _ in 0..1_000 {
            assert!(matches!(
                load_persisted_lyrics(&mut connection, target_key, 1_001).unwrap(),
                Some((CachedLyrics::Missing, _))
            ));
        }
        let elapsed = started.elapsed();
        let bytes = path.metadata().unwrap().len();
        println!("10M lyrics cache: {bytes} bytes, 1000 indexed reads in {elapsed:?}");
        assert!(elapsed < Duration::from_secs(10), "{elapsed:?}");

        drop(connection);
        std::fs::remove_file(path).unwrap();
    }
}
