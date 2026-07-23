use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::error::Error;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::Datelike;
use diesel::connection::SimpleConnection;
use diesel::connection::TransactionManager;
use diesel::deserialize::QueryableByName;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, PooledConnection};
use diesel::sql_types::{BigInt, Double, Integer, Nullable, Text};
use diesel::sqlite::SqliteConnection;
use id3::TagLike;
use lofty::config::ParseOptions;
use lofty::file::TaggedFileExt;
use lofty::prelude::{Accessor, AudioFile};
use lofty::probe::Probe;
use parson_core::{FileId, LibraryRegistration};
use rayon::prelude::*;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use tracing::{info, warn};
use uuid::Uuid;

use crate::domain::{Album, Artist, Song};
use crate::library::artist_names::format_contributing_artists;
use crate::library::identity::{
    hash_album, hash_artist, hash_normalized_album, hash_normalized_artist, hash_normalized_song,
    hash_song, normalize_album_identity, normalize_artist_identity, normalize_song_identity,
};
use crate::library::normalize::{
    LibraryIndexReport, LibraryIndexRunKind, LibraryIndexTiming, LibraryIndexWarning,
    ReleaseClassification, ReleaseEvidence, ReleaseTitleAnalysis, analyze_release_title,
    classify_release_details, classify_release_type, edition_primary_type,
};
use crate::library::search::normalize as normalize_search_text;
use crate::library::storage::get_cover_art_path;
use crate::persistence::connection::{DbPool, connect};

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "ogg", "m4a", "opus", "wav", "aiff", "alac"];
const TAG_PARSER_VERSION: &str = "13";
const COVER_RESOLVER_VERSION: &str = "5";
// Bump when release inference semantics change.
const CLASSIFICATION_VERSION: &str = "7";
const DATABASE_BATCH_SIZE: usize = 10_000;
const MAX_WARNING_DETAILS: usize = 100;
type MetadataOverrides = HashMap<String, HashMap<String, HashMap<String, String>>>;
type PooledSqliteConnection = PooledConnection<ConnectionManager<SqliteConnection>>;
static DISC_DIRECTORY: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
static TRAILING_FEATURE_CREDIT: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
#[cfg(target_os = "linux")]
static IO_URING_AVAILABLE: OnceLock<bool> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IndexMode {
    Incremental,
    Repair,
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum AudioFormat {
    Mp3,
    Flac,
    Ogg,
    M4a,
    Opus,
    Wav,
    Aiff,
    Alac,
    Unknown,
}

impl AudioFormat {
    fn from_extension(extension: &str) -> Self {
        match extension {
            "mp3" => Self::Mp3,
            "flac" => Self::Flac,
            "ogg" => Self::Ogg,
            "m4a" => Self::M4a,
            "opus" => Self::Opus,
            "wav" => Self::Wav,
            "aiff" => Self::Aiff,
            "alac" => Self::Alac,
            _ => Self::Unknown,
        }
    }

    const fn as_str(self) -> &'static str {
        match self {
            Self::Mp3 => "mp3",
            Self::Flac => "flac",
            Self::Ogg => "ogg",
            Self::M4a => "m4a",
            Self::Opus => "opus",
            Self::Wav => "wav",
            Self::Aiff => "aiff",
            Self::Alac => "alac",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone)]
struct DiscoveredFile {
    native_path: PathBuf,
    native_directory: PathBuf,
    path: Arc<str>,
    directory: Arc<str>,
    file_name: Arc<str>,
    format: AudioFormat,
    size_bytes: i64,
    modified_at_ns: i64,
    stable_identity: Option<String>,
    tag_fingerprint: Option<String>,
}

#[derive(Debug, Clone)]
struct DiscoveredImage {
    path: PathBuf,
    size_bytes: i64,
    modified_at_ns: i64,
}

#[derive(Debug, Default)]
struct FilesystemInventory {
    audio_files: Vec<DiscoveredFile>,
    images_by_directory: HashMap<PathBuf, Vec<DiscoveredImage>>,
}

#[derive(Debug, Clone, Default)]
struct CoverResolution {
    path: String,
    content_hash: String,
    preferred: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum CoverSuitability {
    Fallback,
    NearSquare,
    Square,
    Preferred,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CoverCrop {
    HorizontalRight,
    VerticalTopClockwise,
}

#[derive(Debug, QueryableByName)]
struct CoverCacheRow {
    #[diesel(sql_type = Text)]
    directory: String,
    #[diesel(sql_type = Text)]
    inventory_signature: String,
    #[diesel(sql_type = Text)]
    cover_path: String,
    #[diesel(sql_type = Nullable<Text>)]
    content_hash: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum DurationSource {
    Exact,
    HeaderDerived,
    Estimated,
    Unavailable,
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
enum ParserStrategy {
    #[default]
    Unknown,
    Mp3Fast,
    FlacFast,
    Mp4Fast,
    OggVorbisFast,
    OggOpusFast,
    WavFast,
    AiffFast,
    Lofty,
    LoftyFlacFallback,
    LoftyMp4Fallback,
    Reused,
    #[cfg(test)]
    Test,
}

impl ParserStrategy {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Mp3Fast => "mp3_fast",
            Self::FlacFast => "flac_fast",
            Self::Mp4Fast => "mp4_fast",
            Self::OggVorbisFast => "ogg_vorbis_fast",
            Self::OggOpusFast => "ogg_opus_fast",
            Self::WavFast => "wav_fast",
            Self::AiffFast => "aiff_fast",
            Self::Lofty => "lofty",
            Self::LoftyFlacFallback => "lofty_flac_fallback",
            Self::LoftyMp4Fallback => "lofty_mp4_fallback",
            Self::Reused => "reused",
            #[cfg(test)]
            Self::Test => "test",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
struct EmbeddedArtworkRegion {
    offset: u64,
    length: u64,
}

impl DurationSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Exact => "exact",
            Self::HeaderDerived => "header_derived",
            Self::Estimated => "estimated",
            Self::Unavailable => "unavailable",
        }
    }

    fn from_str(value: &str) -> Self {
        match value {
            "exact" => Self::Exact,
            "header_derived" => Self::HeaderDerived,
            "estimated" => Self::Estimated,
            _ => Self::Unavailable,
        }
    }

    fn needs_repair(self) -> bool {
        matches!(self, Self::Estimated | Self::Unavailable)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ParsedFile {
    path: Arc<str>,
    title: String,
    album: String,
    track_artists: Vec<String>,
    album_artists: Vec<String>,
    genres: Vec<String>,
    release_date: String,
    track_number: u16,
    disc_number: u16,
    duration_seconds: f64,
    duration_source: DurationSource,
    cover_url: String,
    musicbrainz_recording_id: String,
    musicbrainz_release_id: String,
    musicbrainz_artist_id: String,
    musicbrainz_album_artist_id: String,
    error: Option<String>,
    embedded_artwork: Option<EmbeddedArtworkRegion>,
    #[serde(skip)]
    tag_parse_us: u64,
    #[serde(skip)]
    duration_us: u64,
    #[serde(skip)]
    parse_strategy: ParserStrategy,
    #[serde(skip)]
    bytes_read: u64,
    #[serde(skip)]
    read_calls: u64,
    #[serde(skip)]
    seeks: u64,
    #[serde(skip)]
    file_opens: u64,
    #[serde(skip)]
    parser_fallbacks: u64,
    #[serde(skip)]
    fast_path_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OwnedReleaseEvidence {
    album_name: String,
    album_artist: String,
    paths: Vec<String>,
    track_titles: Vec<String>,
    #[serde(default)]
    track_durations: Vec<f64>,
    #[serde(default)]
    genres: Vec<String>,
    release_dates: Vec<String>,
    #[serde(default)]
    directory_years: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReleasePresentation {
    title: String,
    normalized_title: String,
    primary_type: String,
    original_album_id: Option<String>,
    release_group_id: String,
    release_group_title: String,
    normalized_release_group_title: String,
    release_group_type: String,
    metadata_json: String,
    first_release_date: String,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct AlbumGroupingKey {
    normalized_album: Arc<str>,
    release_directory: Arc<str>,
}

#[derive(Debug, Clone)]
struct PreparedGenre {
    name: Arc<str>,
    normalized_name: Arc<str>,
}

#[derive(Debug)]
struct PreparedTrackSeed<'a> {
    parsed: &'a ParsedFile,
    normalized_title: Arc<str>,
    normalized_album: Arc<str>,
    release_year: Option<Arc<str>>,
    album_grouping_key: AlbumGroupingKey,
    primary_track_artist: Arc<str>,
    normalized_primary_track_artist: Arc<str>,
    primary_album_artist: Arc<str>,
    normalized_primary_album_artist: Arc<str>,
    genres: Vec<PreparedGenre>,
}

#[derive(Debug)]
struct PreparedTrack<'a> {
    parsed: &'a ParsedFile,
    normalized_title: Arc<str>,
    normalized_album: Arc<str>,
    release_year: Option<Arc<str>>,
    album_grouping_key: AlbumGroupingKey,
    normalized_primary_track_artist: Arc<str>,
    resolved_track_artist: Arc<str>,
    normalized_track_artist: Arc<str>,
    resolved_album_artist: Arc<str>,
    normalized_album_artist: Arc<str>,
    artist_id: Arc<str>,
    track_artist_id: Arc<str>,
    album_id: Arc<str>,
    track_id: Arc<str>,
    recording_id: Arc<str>,
    duplicate_identity: Arc<str>,
    genres: Vec<PreparedGenre>,
}

#[derive(Default)]
struct StringInterner {
    values: HashSet<Arc<str>>,
}

/// Arena for records owned until the scan boundary.
struct ScanRecordArena<T> {
    records: Vec<T>,
}

impl<T> ScanRecordArena<T> {
    fn from_records(mut records: Vec<T>, capacity: usize) -> Self {
        records.reserve_exact(capacity.saturating_sub(records.len()));
        Self { records }
    }
}

impl<T> std::ops::Deref for ScanRecordArena<T> {
    type Target = Vec<T>;

    fn deref(&self) -> &Self::Target {
        &self.records
    }
}

impl<T> std::ops::DerefMut for ScanRecordArena<T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.records
    }
}

impl StringInterner {
    fn with_capacity(capacity: usize) -> Self {
        Self {
            values: HashSet::with_capacity(capacity),
        }
    }

    fn intern(&mut self, value: impl AsRef<str>) -> Arc<str> {
        let value = value.as_ref();
        if let Some(interned) = self.values.get(value) {
            return Arc::clone(interned);
        }
        let interned = Arc::<str>::from(value);
        self.values.insert(Arc::clone(&interned));
        interned
    }
}

#[derive(Debug, Clone)]
struct TrackPresentation {
    id: String,
    recording_id: String,
    title: String,
    normalized_title: String,
    duration_seconds: f64,
    musicbrainz_recording_id: String,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct TrackDuplicateKey {
    album_id: String,
    track_artist: String,
    track_number: u16,
    disc_number: u16,
}

#[derive(Debug, QueryableByName)]
struct ArtistAliasDecisionRow {
    #[diesel(sql_type = Text)]
    normalized_alias: String,
    #[diesel(sql_type = Text)]
    canonical_name: String,
}

#[derive(Debug, QueryableByName)]
struct AlbumInferenceCacheRow {
    #[diesel(sql_type = Text)]
    album_id: String,
    #[diesel(sql_type = Text)]
    evidence_json: String,
    #[diesel(sql_type = Text)]
    presentation_json: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LibraryIndexPhase {
    Available,
    Enriched,
}

/// Cooperative cancellation at database batch boundaries.
#[derive(Clone, Debug, Default)]
pub struct ScanCancellation(Arc<AtomicBool>);

impl ScanCancellation {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

impl LibraryIndexPhase {
    fn parser_version(self) -> &'static str {
        // Persist parsed tags so enrichment does not reopen media files.
        TAG_PARSER_VERSION
    }

    fn cover_resolver_version(self) -> &'static str {
        match self {
            Self::Available => "deferred",
            Self::Enriched => COVER_RESOLVER_VERSION,
        }
    }

    fn classification_version(self) -> &'static str {
        match self {
            Self::Available => "deferred",
            Self::Enriched => CLASSIFICATION_VERSION,
        }
    }
}

impl OwnedReleaseEvidence {
    fn classify(&self) -> ReleaseClassification {
        classify_release_details(&ReleaseEvidence {
            album_name: &self.album_name,
            album_artist: &self.album_artist,
            paths: &self.paths,
            track_titles: &self.track_titles,
            track_durations: &self.track_durations,
            genres: &self.genres,
        })
    }
}

fn plausible_release_year(year: i32) -> bool {
    (1000..=chrono::Utc::now().year() + 1).contains(&year)
}

fn normalized_release_date(value: &str) -> Option<String> {
    let value = value.trim();
    let year_text = value.get(..4)?;
    if value
        .as_bytes()
        .get(4)
        .is_some_and(|separator| !matches!(separator, b'-' | b'T' | b' '))
    {
        return None;
    }
    let year = year_text.parse::<i32>().ok()?;
    plausible_release_year(year).then(|| format!("{year:04}"))
}

fn release_directory_year(path: &str) -> Option<String> {
    let path = Path::new(path);
    let is_audio_file = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            AUDIO_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
        });
    let mut directory = if is_audio_file { path.parent()? } else { path };
    let directory_name = directory.file_name()?.to_str()?;
    let normalized = normalize_song_identity(directory_name);
    let first_word = normalized.split_whitespace().next().unwrap_or_default();
    let numbered_disc = ["cd", "disc", "disk"].iter().any(|prefix| {
        first_word
            .strip_prefix(prefix)
            .is_some_and(|suffix| !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()))
    });
    if matches!(first_word, "cd" | "disc" | "disk") || numbered_disc {
        directory = directory.parent()?;
    }
    let name = directory.file_name()?.to_str()?;
    let years = name
        .split(|character: char| !character.is_ascii_digit())
        .filter(|token| token.len() == 4)
        .filter_map(|token| token.parse::<i32>().ok())
        .filter(|year| plausible_release_year(*year))
        .collect::<HashSet<_>>();
    (years.len() == 1).then(|| format!("{:04}", years.into_iter().next().unwrap_or_default()))
}

fn consensus_date_candidates(dates: &[String]) -> String {
    if dates.is_empty() {
        return String::new();
    }

    let mut year_counts = BTreeMap::<i32, usize>::new();
    for date in dates {
        if let Ok(year) = date.parse::<i32>() {
            *year_counts.entry(year).or_default() += 1;
        }
    }
    let support = year_counts.values().copied().max().unwrap_or_default();
    let Some(year) = year_counts
        .into_iter()
        .filter(|(_, count)| *count == support)
        .map(|(year, _)| year)
        .min()
    else {
        return String::new();
    };
    format!("{year:04}")
}

#[cfg(test)]
fn consensus_release_date(tag_dates: &[String], paths: &[String]) -> String {
    let directory_years = paths
        .iter()
        .filter_map(|path| release_directory_year(path))
        .collect::<Vec<_>>();
    consensus_release_date_from_years(tag_dates, &directory_years)
}

fn consensus_release_date_from_years(tag_dates: &[String], directory_years: &[String]) -> String {
    let tagged = consensus_date_candidates(
        &tag_dates
            .iter()
            .filter_map(|date| normalized_release_date(date))
            .collect::<Vec<_>>(),
    );
    let directory = consensus_date_candidates(directory_years);

    if directory.is_empty() {
        tagged
    } else {
        directory
    }
}

#[cfg(test)]
fn resolve_release_presentations(
    evidence: &HashMap<String, OwnedReleaseEvidence>,
) -> HashMap<String, ReleasePresentation> {
    let affected = evidence.keys().cloned().collect::<HashSet<_>>();
    resolve_release_presentations_for(evidence, &HashMap::new(), &affected)
}

fn resolve_release_presentations_for(
    evidence: &HashMap<String, OwnedReleaseEvidence>,
    retained: &HashMap<String, ReleasePresentation>,
    affected: &HashSet<String>,
) -> HashMap<String, ReleasePresentation> {
    let mut original_candidates = HashMap::<(String, String), Vec<String>>::new();
    for (id, release) in evidence {
        let analysis = analyze_release_title(&release.album_name);
        if analysis.is_edition {
            continue;
        }
        let candidates = original_candidates
            .entry((
                normalize_artist_identity(&release.album_artist),
                normalize_album_identity(&analysis.canonical_title),
            ))
            .or_default();
        if !candidates.contains(id) {
            candidates.push(id.clone());
        }
    }
    let originals = original_candidates
        .into_iter()
        .filter_map(|(key, candidates)| {
            (candidates.len() == 1).then(|| (key, candidates[0].clone()))
        })
        .collect::<HashMap<_, _>>();

    evidence
        .iter()
        .map(|(id, release)| {
            if !affected.contains(id)
                && let Some(presentation) = retained.get(id)
            {
                return (id.clone(), presentation.clone());
            }
            let classification = release.classify();
            let analysis = analyze_release_title(&release.album_name);
            let first_release_date =
                consensus_release_date_from_years(&release.release_dates, &release.directory_years);
            let canonical_title = analysis.canonical_title.clone();
            let group_id = hash_album(&canonical_title, &release.album_artist);
            let metadata_json = serde_json::to_string(&serde_json::json!({
                "title_analysis": &analysis,
                "classification": &classification,
            }))
            .unwrap_or_else(|_| "{}".to_string());
            let edition_changes_release_form = analysis.variant_kinds.iter().any(|kind| {
                !matches!(
                    kind,
                    crate::library::normalize::ReleaseVariantKind::Regional
                        | crate::library::normalize::ReleaseVariantKind::Format
                        | crate::library::normalize::ReleaseVariantKind::Disc
                )
            });
            let presentation = if analysis.is_edition
                && (classification.primary_type == "Album" || edition_changes_release_form)
            {
                let original_album_id = originals
                    .get(&(
                        normalize_artist_identity(&release.album_artist),
                        normalize_album_identity(&canonical_title),
                    ))
                    .cloned();
                if original_album_id.is_some() {
                    ReleasePresentation {
                        title: analysis.display_title.clone(),
                        normalized_title: normalize_album_identity(&analysis.display_title),
                        primary_type: edition_primary_type(&analysis),
                        original_album_id,
                        release_group_id: group_id,
                        normalized_release_group_title: normalize_album_identity(&canonical_title),
                        release_group_title: canonical_title,
                        release_group_type: classification.primary_type.clone(),
                        metadata_json,
                        first_release_date,
                    }
                } else {
                    ReleasePresentation {
                        // Hide the qualifier when this is the only edition.
                        title: canonical_title.clone(),
                        normalized_title: normalize_album_identity(&canonical_title),
                        primary_type: classification.primary_type.clone(),
                        original_album_id: None,
                        release_group_id: group_id,
                        normalized_release_group_title: normalize_album_identity(&canonical_title),
                        release_group_title: canonical_title,
                        release_group_type: classification.primary_type.clone(),
                        metadata_json,
                        first_release_date,
                    }
                }
            } else {
                ReleasePresentation {
                    title: analysis.display_title.clone(),
                    normalized_title: normalize_album_identity(&analysis.display_title),
                    primary_type: classification.primary_type.clone(),
                    original_album_id: None,
                    release_group_id: group_id,
                    normalized_release_group_title: normalize_album_identity(&canonical_title),
                    release_group_title: canonical_title,
                    release_group_type: classification.primary_type.clone(),
                    metadata_json,
                    first_release_date,
                }
            };
            (id.clone(), presentation)
        })
        .collect()
}

#[derive(Debug, QueryableByName)]
struct ExistingFileSnapshot {
    #[diesel(sql_type = Integer)]
    file_id: i32,
    #[diesel(sql_type = Text)]
    path: String,
    #[diesel(sql_type = BigInt)]
    size_bytes: i64,
    #[diesel(sql_type = BigInt)]
    modified_at_ns: i64,
    #[diesel(sql_type = Nullable<Text>)]
    stable_identity: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    tag_fingerprint: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    title: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    album: Option<String>,
    #[diesel(sql_type = Text)]
    track_artists_json: String,
    #[diesel(sql_type = Text)]
    album_artists_json: String,
    #[diesel(sql_type = Text)]
    genres_json: String,
    #[diesel(sql_type = Nullable<Text>)]
    release_date: Option<String>,
    #[diesel(sql_type = Nullable<Integer>)]
    track_number: Option<i32>,
    #[diesel(sql_type = Nullable<Integer>)]
    disc_number: Option<i32>,
    #[diesel(sql_type = Double)]
    duration_seconds: f64,
    #[diesel(sql_type = Text)]
    duration_source: String,
    #[diesel(sql_type = Nullable<Text>)]
    cover_url: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    parser_version: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    cover_resolver_version: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    classification_version: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    musicbrainz_recording_id: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    musicbrainz_release_id: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    musicbrainz_artist_id: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    musicbrainz_album_artist_id: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    error: Option<String>,
    #[diesel(sql_type = Nullable<BigInt>)]
    embedded_artwork_offset: Option<i64>,
    #[diesel(sql_type = Nullable<BigInt>)]
    embedded_artwork_length: Option<i64>,
}

#[derive(Debug, QueryableByName)]
struct IdRow {
    #[diesel(sql_type = Integer)]
    id: i32,
}

#[derive(Debug, QueryableByName)]
struct CountRow {
    #[diesel(sql_type = BigInt)]
    count: i64,
}

#[derive(Debug, QueryableByName)]
struct TextIdRow {
    #[diesel(sql_type = Text)]
    id: String,
}

#[cfg(test)]
#[derive(Debug, QueryableByName)]
struct AlbumDurationsRow {
    #[diesel(sql_type = Text)]
    id: String,
    #[diesel(sql_type = Text)]
    durations_json: String,
}

#[cfg(test)]
#[derive(Debug, QueryableByName)]
struct ArtworkIdentityRow {
    #[diesel(sql_type = Text)]
    id: String,
    #[diesel(sql_type = Text)]
    uri: String,
}

#[derive(Debug, QueryableByName)]
struct MetadataOverrideRow {
    #[diesel(sql_type = Text)]
    entity_type: String,
    #[diesel(sql_type = Text)]
    entity_id: String,
    #[diesel(sql_type = Text)]
    field_name: String,
    #[diesel(sql_type = Text)]
    value_json: String,
}

#[derive(Debug, QueryableByName)]
struct AlbumRow {
    #[diesel(sql_type = Text)]
    artist_id: String,
    #[diesel(sql_type = Text)]
    id: String,
    #[diesel(sql_type = Text)]
    title: String,
    #[diesel(sql_type = Nullable<Text>)]
    cover_url: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    primary_type: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    description: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    first_release_date: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    musicbrainz_id: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    wikidata_id: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    release_album_json: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StoredReleaseMetadata {
    title_analysis: Option<ReleaseTitleAnalysis>,
}

fn catalog_album_title(stored_title: String, metadata: Option<&StoredReleaseMetadata>) -> String {
    let Some(analysis) = metadata.and_then(|metadata| metadata.title_analysis.as_ref()) else {
        return stored_title;
    };

    // Preserve canonical titles for albums with one edition.
    if analysis.is_edition
        && normalize_album_identity(&stored_title)
            == normalize_album_identity(&analysis.canonical_title)
    {
        return stored_title;
    }

    let display_title = analysis.display_title.trim();
    if display_title.is_empty() {
        stored_title
    } else {
        display_title.to_string()
    }
}

#[derive(Debug, QueryableByName)]
struct TrackRow {
    #[diesel(sql_type = Text)]
    album_id: String,
    #[diesel(sql_type = Text)]
    id: String,
    #[diesel(sql_type = Text)]
    title: String,
    #[diesel(sql_type = Text)]
    artist: String,
    #[diesel(sql_type = Integer)]
    track_number: i32,
    #[diesel(sql_type = Double)]
    duration_seconds: f64,
    #[diesel(sql_type = Nullable<Text>)]
    path: Option<String>,
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn raw_metadata_reusable(
    snapshot: &ExistingFileSnapshot,
    file: &DiscoveredFile,
    phase: LibraryIndexPhase,
) -> bool {
    snapshot.size_bytes == file.size_bytes
        && snapshot.modified_at_ns == file.modified_at_ns
        && (file.stable_identity.is_none() || snapshot.stable_identity == file.stable_identity)
        && (file.tag_fingerprint.is_none()
            || file.tag_fingerprint.as_deref() == snapshot.tag_fingerprint.as_deref())
        && snapshot.parser_version.as_deref() == Some(phase.parser_version())
}

fn reconcile_reused_cover(
    parsed: &mut ParsedFile,
    local_cover: String,
    force_reselection: bool,
) -> bool {
    if force_reselection {
        if local_cover == parsed.cover_url {
            return false;
        }
        parsed.cover_url = local_cover;
        return true;
    }
    if local_cover.is_empty() || local_cover == parsed.cover_url {
        return false;
    }
    parsed.cover_url = local_cover;
    true
}

fn discover_files(path_to_library: &str) -> FilesystemInventory {
    let discovered = crate::library::discovery::discover_incremental(Path::new(path_to_library));
    adapt_discovered_files(discovered)
}

fn reconcile_files(path_to_library: &str) -> FilesystemInventory {
    let discovered = crate::library::discovery::reconcile(Path::new(path_to_library));
    adapt_discovered_files(discovered)
}

fn adapt_discovered_files(
    discovered: crate::library::discovery::FilesystemInventory,
) -> FilesystemInventory {
    FilesystemInventory {
        audio_files: discovered
            .audio_files
            .into_iter()
            .map(adapt_discovered_file)
            .collect(),
        images_by_directory: discovered
            .images_by_ancestor
            .into_iter()
            .map(|(directory, images)| {
                (
                    directory,
                    images
                        .into_iter()
                        .map(|image| DiscoveredImage {
                            path: image.path,
                            size_bytes: image.size_bytes,
                            modified_at_ns: image.modified_at_ns,
                        })
                        .collect(),
                )
            })
            .collect(),
    }
}

fn adapt_discovered_file(file: crate::library::discovery::DiscoveredFile) -> DiscoveredFile {
    DiscoveredFile {
        native_path: file.path,
        native_directory: file.directory,
        path: Arc::from(file.database_path),
        directory: Arc::from(file.database_directory),
        file_name: Arc::from(file.file_name),
        format: AudioFormat::from_extension(&file.extension),
        size_bytes: file.size_bytes,
        modified_at_ns: file.modified_at_ns,
        stable_identity: file.stable_identity,
        tag_fingerprint: None,
    }
}

fn fallback_title(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Unknown Title")
        .to_string()
}

fn fallback_album(path: &Path) -> String {
    path.parent()
        .and_then(|parent| parent.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("Unknown Album")
        .to_string()
}

#[derive(Debug, Default)]
struct RawAudioMetadata {
    title: Option<String>,
    album: Option<String>,
    track_artists: Vec<String>,
    album_artists: Vec<String>,
    genre: String,
    release_date: Option<String>,
    track_number: u16,
    disc_number: u16,
    duration_seconds: f64,
    duration_source: Option<DurationSource>,
    tag_parse_us: u64,
    duration_us: u64,
    parse_strategy: ParserStrategy,
    embedded_artwork: Option<EmbeddedArtworkRegion>,
}

fn elapsed_us(duration: Duration) -> u64 {
    duration.as_micros().min(u128::from(u64::MAX)) as u64
}

#[cfg(target_os = "linux")]
fn process_cpu_time_us() -> Option<u64> {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } != 0 {
        return None;
    }
    let usage = unsafe { usage.assume_init() };
    let time = |value: libc::timeval| {
        (value.tv_sec.max(0) as u64)
            .saturating_mul(1_000_000)
            .saturating_add(value.tv_usec.max(0) as u64)
    };
    Some(time(usage.ru_utime).saturating_add(time(usage.ru_stime)))
}

#[cfg(windows)]
fn process_cpu_time_us() -> Option<u64> {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    if unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    } == 0
    {
        return None;
    }
    let ticks =
        |value: FILETIME| (u64::from(value.dwHighDateTime) << 32) | u64::from(value.dwLowDateTime);
    Some(ticks(kernel).saturating_add(ticks(user)) / 10)
}

#[cfg(not(any(target_os = "linux", windows)))]
fn process_cpu_time_us() -> Option<u64> {
    None
}

fn thread_pinning_enabled() -> bool {
    !std::env::var("PARSON_PIN_INDEX_THREADS").is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "0" | "false" | "no" | "off"
        )
    })
}

#[cfg(target_os = "linux")]
fn pin_index_thread(index: usize) {
    if !thread_pinning_enabled() {
        return;
    }
    let cores = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(1);
    let mut set = unsafe { std::mem::zeroed::<libc::cpu_set_t>() };
    unsafe {
        libc::CPU_ZERO(&mut set);
        libc::CPU_SET(index % cores, &mut set);
        libc::sched_setaffinity(0, std::mem::size_of::<libc::cpu_set_t>(), &set);
    }
}

#[cfg(windows)]
fn pin_index_thread(index: usize) {
    if !thread_pinning_enabled() {
        return;
    }
    use windows_sys::Win32::System::Threading::{GetCurrentThread, SetThreadAffinityMask};
    let cores = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(1)
        .min(usize::BITS as usize);
    unsafe {
        SetThreadAffinityMask(GetCurrentThread(), 1usize << (index % cores));
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
fn pin_index_thread(_index: usize) {}

/// Reader-level I/O accounting for metadata parsing.
struct MeasuredReader<R> {
    inner: R,
    bytes_read: u64,
    read_calls: u64,
    seeks: u64,
}

impl<R> MeasuredReader<R> {
    fn new(inner: R) -> Self {
        Self {
            inner,
            bytes_read: 0,
            read_calls: 0,
            seeks: 0,
        }
    }
}

impl<R: Read> Read for MeasuredReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let read = self.inner.read(buffer)?;
        self.read_calls = self.read_calls.saturating_add(1);
        self.bytes_read = self.bytes_read.saturating_add(read as u64);
        Ok(read)
    }
}

impl<R: Seek> Seek for MeasuredReader<R> {
    fn seek(&mut self, position: SeekFrom) -> std::io::Result<u64> {
        self.seeks = self.seeks.saturating_add(1);
        self.inner.seek(position)
    }
}

static PARSER_POOLS: OnceLock<Mutex<HashMap<usize, Arc<rayon::ThreadPool>>>> = OnceLock::new();

fn parser_pool(threads: usize) -> Result<Arc<rayon::ThreadPool>, rayon::ThreadPoolBuildError> {
    let pools = PARSER_POOLS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut pools = pools
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(pool) = pools.get(&threads) {
        return Ok(Arc::clone(pool));
    }
    let pool = Arc::new(
        rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .thread_name(|index| format!("parson-metadata-{index}"))
            .start_handler(|index| pin_index_thread(index + 1))
            .build()?,
    );
    pools.insert(threads, Arc::clone(&pool));
    Ok(pool)
}

#[cfg(windows)]
fn storage_incurs_seek_penalty(path: &Path) -> Option<bool> {
    use std::mem::size_of;
    use std::path::{Component, Prefix};
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::IO::DeviceIoControl;
    use windows_sys::Win32::System::Ioctl::{
        DEVICE_SEEK_PENALTY_DESCRIPTOR, IOCTL_STORAGE_QUERY_PROPERTY, PropertyStandardQuery,
        STORAGE_PROPERTY_QUERY, StorageDeviceSeekPenaltyProperty,
    };

    let drive = match path.components().next()? {
        Component::Prefix(prefix) => match prefix.kind() {
            Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => drive,
            _ => return None,
        },
        _ => return None,
    };
    let device = format!(r"\\.\{}:", char::from(drive))
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    // SAFETY: `device` is NUL-terminated, and the optional security/template
    // pointers are null. The owned handle is closed below on every path.
    let handle = unsafe {
        CreateFileW(
            device.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            0,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return None;
    }
    let query = STORAGE_PROPERTY_QUERY {
        PropertyId: StorageDeviceSeekPenaltyProperty,
        QueryType: PropertyStandardQuery,
        AdditionalParameters: [0],
    };
    let mut descriptor = DEVICE_SEEK_PENALTY_DESCRIPTOR::default();
    let mut returned = 0_u32;
    // SAFETY: input and output point to initialized values of the exact sizes
    // passed to DeviceIoControl; synchronous operation uses no OVERLAPPED.
    let succeeded = unsafe {
        DeviceIoControl(
            handle,
            IOCTL_STORAGE_QUERY_PROPERTY,
            std::ptr::from_ref(&query).cast(),
            size_of::<STORAGE_PROPERTY_QUERY>() as u32,
            std::ptr::from_mut(&mut descriptor).cast(),
            size_of::<DEVICE_SEEK_PENALTY_DESCRIPTOR>() as u32,
            &mut returned,
            std::ptr::null_mut(),
        )
    } != 0;
    // SAFETY: this function owns the valid handle returned by CreateFileW.
    unsafe { CloseHandle(handle) };
    (succeeded && returned as usize >= size_of::<DEVICE_SEEK_PENALTY_DESCRIPTOR>())
        .then_some(descriptor.IncursSeekPenalty)
}

#[cfg(target_os = "linux")]
fn storage_incurs_seek_penalty(path: &Path) -> Option<bool> {
    use std::os::unix::fs::MetadataExt;
    let device = path.metadata().ok()?.dev();
    let major = (device >> 8) & 0xfff | (device >> 32) & 0xffff_f000;
    let minor = device & 0xff | (device >> 12) & 0xffff_ff00;
    std::fs::read_to_string(format!("/sys/dev/block/{major}:{minor}/queue/rotational"))
        .ok()
        .and_then(|value| match value.trim() {
            "0" => Some(false),
            "1" => Some(true),
            _ => None,
        })
}

#[cfg(not(any(windows, target_os = "linux")))]
fn storage_incurs_seek_penalty(_path: &Path) -> Option<bool> {
    None
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct DeviceIndexProfile {
    parse_threads: usize,
    queue_depth: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct DeviceIndexProfiles {
    devices: BTreeMap<String, DeviceIndexProfile>,
}

#[cfg(target_os = "linux")]
fn storage_device_key(path: &Path) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    let device = path.metadata().ok()?.dev();
    let major = (device >> 8) & 0xfff | (device >> 32) & 0xffff_f000;
    let minor = device & 0xff | (device >> 12) & 0xffff_ff00;
    Some(format!("linux:{major}:{minor}"))
}

#[cfg(windows)]
fn storage_device_key(path: &Path) -> Option<String> {
    use std::path::{Component, Prefix};
    match path.components().next()? {
        Component::Prefix(prefix) => match prefix.kind() {
            Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => Some(format!(
                "windows:{}",
                char::from(drive).to_ascii_uppercase()
            )),
            _ => None,
        },
        _ => None,
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
fn storage_device_key(path: &Path) -> Option<String> {
    path.canonicalize()
        .ok()
        .map(|path| format!("path:{}", path.display()))
}

fn device_profiles_path() -> PathBuf {
    crate::settings::data_path(&["Config", "indexer-device-profiles.json"])
}

fn load_device_profile(path: &Path) -> Option<DeviceIndexProfile> {
    let key = storage_device_key(path)?;
    let contents = std::fs::read_to_string(device_profiles_path()).ok()?;
    serde_json::from_str::<DeviceIndexProfiles>(&contents)
        .ok()?
        .devices
        .remove(&key)
}

#[cfg(not(windows))]
fn replace_profile_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_profile_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } != 0
    {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

fn store_device_profile(path: &Path, profile: DeviceIndexProfile) -> std::io::Result<()> {
    let key = storage_device_key(path)
        .ok_or_else(|| std::io::Error::other("could not identify storage device"))?;
    let profile_path = device_profiles_path();
    let mut profiles = std::fs::read_to_string(&profile_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<DeviceIndexProfiles>(&contents).ok())
        .unwrap_or_default();
    profiles.devices.insert(key, profile);
    if let Some(parent) = profile_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temporary = profile_path.with_extension("json.tmp");
    std::fs::write(&temporary, serde_json::to_vec_pretty(&profiles)?)?;
    replace_profile_file(&temporary, &profile_path)
}

fn parse_thread_count(library_path: &Path) -> (usize, Option<bool>) {
    let available = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(4);
    let incurs_seek_penalty = storage_incurs_seek_penalty(library_path);
    let profiled = load_device_profile(library_path);
    let threads = std::env::var("PARSON_PARSE_THREADS")
        .ok()
        .and_then(|value| value.parse().ok())
        .or_else(|| profiled.map(|profile| profile.parse_threads))
        .unwrap_or_else(|| match incurs_seek_penalty {
            Some(true) => available.min(4),
            Some(false) | None => available,
        })
        .clamp(1, 32);
    (threads, incurs_seek_penalty)
}

fn storage_queue_depth(path: &Path, incurs_seek_penalty: Option<bool>) -> usize {
    std::env::var("PARSON_IO_QUEUE_DEPTH")
        .ok()
        .and_then(|value| value.parse().ok())
        .or_else(|| load_device_profile(path).map(|profile| profile.queue_depth))
        .unwrap_or(match incurs_seek_penalty {
            Some(true) => 16,
            Some(false) => 64,
            None => 32,
        })
        .clamp(1, 128)
}

#[derive(Debug, Clone, Copy)]
enum TagRegion {
    Start(usize),
    End(usize),
}

#[derive(Debug)]
struct PrefetchedRegions {
    file_length: u64,
    regions: Vec<(u64, TagBuffer)>,
    bytes_read: u64,
    read_calls: u64,
}

struct SparseRegionReader {
    file_length: u64,
    position: u64,
    regions: Vec<(u64, TagBuffer)>,
    read_calls: u64,
    seeks: u64,
}

static TAG_BUFFER_POOL: OnceLock<Mutex<Vec<Vec<u8>>>> = OnceLock::new();

#[derive(Debug)]
struct TagBuffer {
    bytes: Vec<u8>,
}

impl TagBuffer {
    fn acquire(length: usize) -> Vec<u8> {
        let pool = TAG_BUFFER_POOL.get_or_init(|| Mutex::new(Vec::new()));
        let mut pool = pool.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut bytes = pool
            .iter()
            .rposition(|buffer| buffer.capacity() >= length)
            .map(|index| pool.swap_remove(index))
            .unwrap_or_default();
        bytes.resize(length, 0);
        bytes
    }

    fn new(bytes: Vec<u8>) -> Self {
        Self { bytes }
    }
}

impl std::ops::Deref for TagBuffer {
    type Target = [u8];

    fn deref(&self) -> &Self::Target {
        &self.bytes
    }
}

impl Drop for TagBuffer {
    fn drop(&mut self) {
        if self.bytes.capacity() > 256 * 1024 {
            return;
        }
        let pool = TAG_BUFFER_POOL.get_or_init(|| Mutex::new(Vec::new()));
        let mut pool = pool.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if pool.len() < 512 {
            let mut bytes = std::mem::take(&mut self.bytes);
            bytes.clear();
            pool.push(bytes);
        }
    }
}

struct InflightLimiter {
    state: Mutex<usize>,
    available: std::sync::Condvar,
    limit: usize,
}

impl InflightLimiter {
    fn acquire(self: &Arc<Self>) -> InflightPermit {
        let mut active = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while *active >= self.limit {
            active = self
                .available
                .wait(active)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
        *active += 1;
        InflightPermit(Arc::clone(self))
    }

    fn wait_idle(&self) {
        let mut active = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while *active != 0 {
            active = self
                .available
                .wait(active)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }
}

struct InflightPermit(Arc<InflightLimiter>);

impl Drop for InflightPermit {
    fn drop(&mut self) {
        let mut active = self
            .0
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *active = active.saturating_sub(1);
        self.0.available.notify_one();
    }
}

impl SparseRegionReader {
    fn new(prefetched: PrefetchedRegions) -> Self {
        Self {
            file_length: prefetched.file_length,
            position: 0,
            regions: prefetched.regions,
            read_calls: 0,
            seeks: 0,
        }
    }
}

impl Read for SparseRegionReader {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        self.read_calls = self.read_calls.saturating_add(1);
        if self.position >= self.file_length || buffer.is_empty() {
            return Ok(0);
        }
        for (offset, bytes) in &self.regions {
            let end = offset.saturating_add(bytes.len() as u64);
            if self.position >= *offset && self.position < end {
                let source = (self.position - offset) as usize;
                let length = buffer.len().min(bytes.len() - source);
                buffer[..length].copy_from_slice(&bytes[source..source + length]);
                self.position = self.position.saturating_add(length as u64);
                return Ok(length);
            }
        }
        Err(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "requested metadata lies outside prefetched tag regions",
        ))
    }
}

impl Seek for SparseRegionReader {
    fn seek(&mut self, position: SeekFrom) -> std::io::Result<u64> {
        self.seeks = self.seeks.saturating_add(1);
        let next = match position {
            SeekFrom::Start(value) => i128::from(value),
            SeekFrom::End(value) => i128::from(self.file_length) + i128::from(value),
            SeekFrom::Current(value) => i128::from(self.position) + i128::from(value),
        };
        if !(0..=i128::from(u64::MAX)).contains(&next) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid sparse metadata seek",
            ));
        }
        self.position = next as u64;
        Ok(self.position)
    }
}

fn tag_region_bytes() -> usize {
    std::env::var("PARSON_TAG_REGION_BYTES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(60 * 1024)
        .clamp(16 * 1024, 256 * 1024)
}

fn tag_region_plan(format: AudioFormat, file_length: u64) -> (usize, usize) {
    let budget = tag_region_bytes().min(file_length as usize);
    match format {
        AudioFormat::Ogg | AudioFormat::Opus | AudioFormat::M4a | AudioFormat::Alac => {
            (budget / 2, budget - budget / 2)
        }
        _ => (budget, 0),
    }
}

#[cfg(target_os = "linux")]
fn probe_io_uring() -> std::io::Result<()> {
    // `tokio_uring::start` unwraps runtime initialization failures. Probe the
    // same kernel interface first so restricted containers and kernels without
    // io_uring take the ordinary buffered-I/O path instead of panicking.
    let ring = tokio_uring::uring_builder().build(256)?;
    drop(ring);
    Ok(())
}

#[cfg(target_os = "linux")]
fn io_uring_probe_succeeded(result: std::io::Result<()>) -> bool {
    match result {
        Ok(()) => true,
        Err(error) => {
            warn!(
                %error,
                "io_uring is unavailable; falling back to buffered metadata reads"
            );
            false
        }
    }
}

#[cfg(target_os = "linux")]
fn io_uring_available() -> bool {
    *IO_URING_AVAILABLE.get_or_init(|| io_uring_probe_succeeded(probe_io_uring()))
}

#[cfg(target_os = "linux")]
fn prefetch_tag_regions(
    files: &[&DiscoveredFile],
    queue_depth: usize,
) -> Option<Vec<Option<PrefetchedRegions>>> {
    use std::ffi::CString;
    use std::os::fd::FromRawFd;
    use std::os::unix::ffi::OsStrExt;
    use tokio_uring::fs::File as UringFile;

    if !io_uring_available() {
        return None;
    }

    #[repr(C)]
    struct OpenHow {
        flags: u64,
        mode: u64,
        resolve: u64,
    }

    fn open_for_uring(path: &Path) -> std::io::Result<UringFile> {
        const RESOLVE_NO_MAGICLINKS: u64 = 0x02;
        let encoded = CString::new(path.as_os_str().as_bytes()).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "path contains NUL")
        })?;
        let how = OpenHow {
            flags: (libc::O_RDONLY | libc::O_CLOEXEC) as u64,
            mode: 0,
            resolve: RESOLVE_NO_MAGICLINKS,
        };
        // SAFETY: `encoded` and `how` remain valid for the syscall. A
        // successful descriptor is immediately transferred to `File`, which
        // owns and closes it. ENOSYS/EINVAL fall back for older kernels.
        let descriptor = unsafe {
            libc::syscall(
                libc::SYS_openat2,
                libc::AT_FDCWD,
                encoded.as_ptr(),
                &how,
                std::mem::size_of::<OpenHow>(),
            ) as libc::c_int
        };
        let file = if descriptor >= 0 {
            unsafe { std::fs::File::from_raw_fd(descriptor) }
        } else {
            std::fs::File::open(path)?
        };
        Ok(UringFile::from_std(file))
    }

    let requests = files
        .iter()
        .map(|file| {
            let file_length = u64::try_from(file.size_bytes).unwrap_or_default();
            let (start_length, end_length) = tag_region_plan(file.format, file_length);
            (
                file.native_path.clone(),
                file_length,
                start_length,
                end_length,
            )
        })
        .collect::<Vec<_>>();
    std::panic::catch_unwind(|| {
        tokio_uring::start(async move {
            let mut output = Vec::with_capacity(requests.len());
            for chunk in requests.chunks(queue_depth.clamp(1, 128)) {
                let mut tasks = Vec::with_capacity(chunk.len());
                for (path, file_length, start_length, end_length) in chunk.iter().cloned() {
                    tasks.push(tokio::task::spawn_local(async move {
                        let file = open_for_uring(&path).ok()?;
                        let (start_result, mut start) =
                            file.read_at(TagBuffer::acquire(start_length), 0).await;
                        let start_read = start_result.ok()?;
                        start.truncate(start_read);
                        let mut regions = vec![(0, TagBuffer::new(start))];
                        let mut end_read = 0;
                        if end_length > 0 {
                            let end_offset = file_length.saturating_sub(end_length as u64);
                            let (end_result, mut end) = file
                                .read_at(TagBuffer::acquire(end_length), end_offset)
                                .await;
                            end_read = end_result.ok()?;
                            end.truncate(end_read);
                            regions.push((end_offset, TagBuffer::new(end)));
                        }
                        Some(PrefetchedRegions {
                            file_length,
                            bytes_read: (start_read + end_read) as u64,
                            read_calls: u64::from(end_length > 0) + 1,
                            regions,
                        })
                    }));
                }
                for task in tasks {
                    output.push(task.await.ok().flatten());
                }
            }
            output
        })
    })
    .ok()
}

#[cfg(windows)]
fn prefetch_tag_regions(
    files: &[&DiscoveredFile],
    queue_depth: usize,
) -> Option<Vec<Option<PrefetchedRegions>>> {
    // Fixed-size reads are much slower than demand-driven parsing on Windows.
    if !std::env::var("PARSON_WINDOWS_QUEUED_IO").is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    }) {
        return None;
    }
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_IO_PENDING, GENERIC_READ, GetLastError, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_OVERLAPPED, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        OPEN_EXISTING, ReadFile,
    };
    use windows_sys::Win32::System::IO::{
        CreateIoCompletionPort, GetQueuedCompletionStatus, OVERLAPPED,
    };

    struct PendingRead {
        overlapped: Box<OVERLAPPED>,
        buffer: Vec<u8>,
        file_index: usize,
        offset: u64,
        transferred: Option<usize>,
    }

    let port = unsafe { CreateIoCompletionPort(INVALID_HANDLE_VALUE, std::ptr::null_mut(), 0, 0) };
    if port.is_null() {
        return None;
    }
    let mut output = (0..files.len()).map(|_| None).collect::<Vec<_>>();
    for base in (0..files.len()).step_by(queue_depth.clamp(1, 128)) {
        let end = (base + queue_depth.clamp(1, 128)).min(files.len());
        let mut handles = Vec::with_capacity(end - base);
        let mut operations = Vec::<PendingRead>::with_capacity((end - base) * 2);
        for (local_index, file) in files[base..end].iter().enumerate() {
            let wide = file
                .native_path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect::<Vec<_>>();
            let handle = unsafe {
                CreateFileW(
                    wide.as_ptr(),
                    GENERIC_READ,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    std::ptr::null(),
                    OPEN_EXISTING,
                    FILE_FLAG_OVERLAPPED,
                    std::ptr::null_mut(),
                )
            };
            if handle == INVALID_HANDLE_VALUE {
                handles.push(handle);
                continue;
            }
            if unsafe { CreateIoCompletionPort(handle, port, base + local_index, 0) }.is_null() {
                unsafe { CloseHandle(handle) };
                handles.push(INVALID_HANDLE_VALUE);
                continue;
            }
            handles.push(handle);
            let file_length = file.size_bytes.max(0) as u64;
            let (start_length, end_length) = tag_region_plan(file.format, file_length);
            let requests = [
                Some((0, start_length)),
                (end_length > 0)
                    .then(|| (file_length.saturating_sub(end_length as u64), end_length)),
            ];
            for (offset, length) in requests.into_iter().flatten() {
                let mut overlapped = Box::<OVERLAPPED>::default();
                overlapped.Anonymous.Anonymous.Offset = offset as u32;
                overlapped.Anonymous.Anonymous.OffsetHigh = (offset >> 32) as u32;
                operations.push(PendingRead {
                    overlapped,
                    buffer: TagBuffer::acquire(length),
                    file_index: base + local_index,
                    offset,
                    transferred: None,
                });
            }
        }
        let mut submitted = 0usize;
        let mut addresses = HashMap::<usize, usize>::with_capacity(operations.len());
        for (index, operation) in operations.iter_mut().enumerate() {
            let handle = handles[operation.file_index - base];
            if handle == INVALID_HANDLE_VALUE {
                continue;
            }
            let pointer = std::ptr::from_mut(operation.overlapped.as_mut());
            addresses.insert(pointer as usize, index);
            let accepted = unsafe {
                ReadFile(
                    handle,
                    operation.buffer.as_mut_ptr(),
                    operation.buffer.len() as u32,
                    std::ptr::null_mut(),
                    pointer,
                )
            } != 0;
            if accepted || unsafe { GetLastError() } == ERROR_IO_PENDING {
                submitted += 1;
            } else {
                addresses.remove(&(pointer as usize));
            }
        }
        for _ in 0..submitted {
            let mut transferred = 0u32;
            let mut key = 0usize;
            let mut overlapped = std::ptr::null_mut();
            let succeeded = unsafe {
                GetQueuedCompletionStatus(
                    port,
                    &mut transferred,
                    &mut key,
                    &mut overlapped,
                    u32::MAX,
                )
            } != 0;
            if succeeded && let Some(index) = addresses.get(&(overlapped as usize)).copied() {
                operations[index].transferred = Some(transferred as usize);
            }
        }
        for handle in handles {
            if handle != INVALID_HANDLE_VALUE {
                unsafe { CloseHandle(handle) };
            }
        }
        for file_index in base..end {
            let mut regions = operations
                .iter_mut()
                .filter(|operation| operation.file_index == file_index)
                .filter_map(|operation| {
                    let transferred = operation.transferred?;
                    operation.buffer.truncate(transferred);
                    Some((
                        operation.offset,
                        TagBuffer::new(std::mem::take(&mut operation.buffer)),
                    ))
                })
                .collect::<Vec<_>>();
            let (_, expected_end) = tag_region_plan(
                files[file_index].format,
                files[file_index].size_bytes.max(0) as u64,
            );
            let expected_regions = 1 + usize::from(expected_end > 0);
            if regions.len() == expected_regions {
                regions.sort_unstable_by_key(|(offset, _)| *offset);
                let bytes_read = regions.iter().map(|(_, bytes)| bytes.len() as u64).sum();
                output[file_index] = Some(PrefetchedRegions {
                    file_length: files[file_index].size_bytes.max(0) as u64,
                    regions,
                    bytes_read,
                    read_calls: expected_regions as u64,
                });
            }
        }
    }
    unsafe { CloseHandle(port) };
    Some(output)
}

#[cfg(not(any(target_os = "linux", windows)))]
fn prefetch_tag_regions(
    _files: &[&DiscoveredFile],
    _queue_depth: usize,
) -> Option<Vec<Option<PrefetchedRegions>>> {
    None
}

fn read_tag_region<R: Read + Seek>(
    reader: &mut R,
    file_length: u64,
    region: TagRegion,
) -> Result<Vec<u8>, String> {
    let (offset, requested) = match region {
        TagRegion::Start(length) => (0, length),
        TagRegion::End(length) => (file_length.saturating_sub(length as u64), length),
    };
    let available = file_length.saturating_sub(offset).min(requested as u64) as usize;
    reader
        .seek(SeekFrom::Start(offset))
        .map_err(|error| error.to_string())?;
    let mut bytes = vec![0; available];
    let read = reader.read(&mut bytes).map_err(|error| error.to_string())?;
    bytes.truncate(read);
    Ok(bytes)
}

fn parse_file_batch(
    files: &[&DiscoveredFile],
    local_covers: &HashMap<&str, String>,
    threads: usize,
) -> Result<Vec<ParsedFile>, rayon::ThreadPoolBuildError> {
    parse_file_batch_with_cancellation(files, local_covers, threads, None)
}

fn parse_file_batch_with_cancellation(
    files: &[&DiscoveredFile],
    local_covers: &HashMap<&str, String>,
    threads: usize,
    cancellation: Option<&ScanCancellation>,
) -> Result<Vec<ParsedFile>, rayon::ThreadPoolBuildError> {
    if files.is_empty() {
        return Ok(Vec::new());
    }
    let pool = parser_pool(threads)?;
    let seek_penalty = files
        .first()
        .and_then(|file| storage_incurs_seek_penalty(&file.native_path));
    let prefetched = prefetch_tag_regions(
        files,
        storage_queue_depth(&files[0].native_path, seek_penalty),
    )
    .filter(|regions| regions.len() == files.len())
    .unwrap_or_else(|| (0..files.len()).map(|_| None).collect());
    Ok(pool.install(|| {
        files
            .par_iter()
            .zip(prefetched.into_par_iter())
            .filter_map(|(file, regions)| {
                if cancellation.is_some_and(ScanCancellation::is_cancelled) {
                    return None;
                }
                let local_cover = local_covers
                    .get(file.directory.as_ref())
                    .map(String::as_str)
                    .unwrap_or_default();
                Some(regions.map_or_else(
                    || parse_audio_file(file, local_cover),
                    |regions| parse_audio_file_prefetched(file, local_cover, regions),
                ))
            })
            .collect()
    }))
}

/// Runs explicit offline device calibration.
pub fn benchmark_and_cache_indexer_device_profile(
    library_path: &Path,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let inventory = discover_files(
        library_path
            .to_str()
            .ok_or_else(|| std::io::Error::other("library path is not UTF-8"))?,
    );
    if inventory.audio_files.is_empty() {
        return Err(std::io::Error::other("device benchmark found no audio files").into());
    }
    let sample = inventory
        .audio_files
        .iter()
        .step_by((inventory.audio_files.len() / 512).max(1))
        .take(512)
        .collect::<Vec<_>>();
    let available = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(4)
        .min(32);
    let mut thread_candidates = vec![1, 2, 4, 8, 16, available];
    thread_candidates.retain(|threads| *threads <= available);
    thread_candidates.sort_unstable();
    thread_candidates.dedup();
    let mut thread_timings = BTreeMap::<usize, u64>::new();
    for threads in thread_candidates {
        let started = Instant::now();
        let parsed = parse_file_batch(&sample, &HashMap::new(), threads)?;
        if parsed.len() != sample.len() {
            return Err(std::io::Error::other("device benchmark lost parsed records").into());
        }
        thread_timings.insert(threads, elapsed_us(started.elapsed()));
    }
    let parse_threads = thread_timings
        .iter()
        .min_by_key(|(threads, elapsed)| (**elapsed, **threads))
        .map(|(threads, _)| *threads)
        .unwrap_or(available);

    let mut queue_timings = BTreeMap::<usize, u64>::new();
    for queue_depth in [16, 32, 64, 128] {
        let started = Instant::now();
        let prefetched = prefetch_tag_regions(&sample, queue_depth)
            .ok_or_else(|| std::io::Error::other("native queued I/O is unavailable"))?;
        if prefetched.iter().filter(|result| result.is_some()).count() != sample.len() {
            return Err(std::io::Error::other("native queued I/O benchmark was incomplete").into());
        }
        queue_timings.insert(queue_depth, elapsed_us(started.elapsed()));
    }
    let queue_depth = queue_timings
        .iter()
        .min_by_key(|(depth, elapsed)| (**elapsed, **depth))
        .map(|(depth, _)| *depth)
        .unwrap_or(32);
    store_device_profile(
        library_path,
        DeviceIndexProfile {
            parse_threads,
            queue_depth,
        },
    )?;
    info!(
        ?thread_timings,
        ?queue_timings,
        parse_threads,
        queue_depth,
        "offline indexer device profile cached"
    );
    Ok(())
}

struct ParseAutotuneResult {
    parsed: Vec<ParsedFile>,
    parsed_prefix: usize,
    threads: usize,
    autotuned: bool,
}

fn create_cold_parse_stage(conn: &mut SqliteConnection) -> QueryResult<()> {
    conn.batch_execute(
        "DROP TABLE IF EXISTS temp.cold_parsed_stage;
         CREATE TEMP TABLE cold_parsed_stage (
            path TEXT PRIMARY KEY, title TEXT NOT NULL, album TEXT NOT NULL,
            track_artists_json TEXT NOT NULL, album_artists_json TEXT NOT NULL,
            genres_json TEXT NOT NULL, release_date TEXT NOT NULL,
            track_number INTEGER NOT NULL, disc_number INTEGER NOT NULL,
            duration_seconds REAL NOT NULL, duration_source TEXT NOT NULL,
            cover_url TEXT NOT NULL, musicbrainz_recording_id TEXT NOT NULL,
            musicbrainz_release_id TEXT NOT NULL, musicbrainz_artist_id TEXT NOT NULL,
            musicbrainz_album_artist_id TEXT NOT NULL, error TEXT,
            embedded_artwork_offset INTEGER, embedded_artwork_length INTEGER
         ) WITHOUT ROWID;",
    )
}

fn stage_cold_parsed(conn: &mut SqliteConnection, parsed: &ParsedFile) -> QueryResult<()> {
    diesel::sql_query(
        "INSERT OR REPLACE INTO cold_parsed_stage VALUES
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind::<Text, _>(parsed.path.as_ref())
    .bind::<Text, _>(&parsed.title)
    .bind::<Text, _>(&parsed.album)
    .bind::<Text, _>(serialize_stage(&parsed.track_artists)?)
    .bind::<Text, _>(serialize_stage(&parsed.album_artists)?)
    .bind::<Text, _>(serialize_stage(&parsed.genres)?)
    .bind::<Text, _>(&parsed.release_date)
    .bind::<Integer, _>(i32::from(parsed.track_number))
    .bind::<Integer, _>(i32::from(parsed.disc_number))
    .bind::<Double, _>(parsed.duration_seconds)
    .bind::<Text, _>(parsed.duration_source.as_str())
    .bind::<Text, _>(&parsed.cover_url)
    .bind::<Text, _>(&parsed.musicbrainz_recording_id)
    .bind::<Text, _>(&parsed.musicbrainz_release_id)
    .bind::<Text, _>(&parsed.musicbrainz_artist_id)
    .bind::<Text, _>(&parsed.musicbrainz_album_artist_id)
    .bind::<Nullable<Text>, _>(parsed.error.as_deref())
    .bind::<Nullable<BigInt>, _>(
        parsed
            .embedded_artwork
            .and_then(|region| i64::try_from(region.offset).ok()),
    )
    .bind::<Nullable<BigInt>, _>(
        parsed
            .embedded_artwork
            .and_then(|region| i64::try_from(region.length).ok()),
    )
    .execute(conn)?;
    Ok(())
}

fn parse_autotuned_prefix(
    _files: &[&DiscoveredFile],
    _local_covers: &HashMap<&str, String>,
    initial_threads: usize,
    _enabled: bool,
) -> Result<ParseAutotuneResult, rayon::ThreadPoolBuildError> {
    // Use configured or static concurrency; never benchmark during indexing.
    Ok(ParseAutotuneResult {
        parsed: Vec::new(),
        parsed_prefix: 0,
        threads: initial_threads,
        autotuned: false,
    })
}

struct ColdParseResult {
    parsed: Vec<ParsedFile>,
    connection: Option<PooledSqliteConnection>,
    threads: usize,
    autotuned: bool,
    wall_us: u64,
    enumeration_overlap_us: u64,
    database_staging_us: u64,
    parsing_staging_overlap_us: u64,
}

type ColdWriterOutput = Result<
    (
        PooledSqliteConnection,
        Vec<ParsedFile>,
        u64,
        Option<Instant>,
        Option<Instant>,
    ),
    diesel::result::Error,
>;
type ColdWriterHandle = std::thread::JoinHandle<ColdWriterOutput>;

struct ColdParsePipeline {
    stream_buffer: Vec<DiscoveredFile>,
    pool: Option<Arc<rayon::ThreadPool>>,
    sender: std::sync::mpsc::SyncSender<ParsedFile>,
    writer: Option<ColdWriterHandle>,
    inflight: Arc<InflightLimiter>,
    selected_threads: usize,
    started: Instant,
    cancellation: ScanCancellation,
}

pub type CatalogProgressSender = tokio::sync::mpsc::Sender<Vec<Artist>>;

impl ColdParsePipeline {
    fn new_with_progress(
        library_path: &Path,
        mut connection: PooledSqliteConnection,
        progress: Option<CatalogProgressSender>,
        cancellation: ScanCancellation,
    ) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let (threads, _seek_penalty) = parse_thread_count(library_path);
        // Bound parsed-record memory with backpressure.
        let (sender, receiver) = std::sync::mpsc::sync_channel(512);
        create_cold_parse_stage(&mut connection)?;
        let writer = std::thread::Builder::new()
            .name("parson-sqlite-stage".to_string())
            .spawn(move || {
                pin_index_thread(0);
                let mut parsed = Vec::new();
                let mut aggregate_staging_us = 0_u64;
                let mut first_stage = None;
                let mut last_stage = None;
                let mut next_progress = 500_usize;
                let mut next_publication = 2_500_usize;
                let mut published_until = 0_usize;
                while let Ok(first) = receiver.recv() {
                    let mut batch = Vec::with_capacity(500);
                    batch.push(first);
                    while batch.len() < 500 {
                        match receiver.try_recv() {
                            Ok(record) => batch.push(record),
                            Err(std::sync::mpsc::TryRecvError::Empty) => break,
                            Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
                        }
                    }
                    let started = Instant::now();
                    first_stage.get_or_insert(started);
                    for record in &batch {
                        stage_cold_parsed(&mut connection, record)?;
                    }
                    aggregate_staging_us =
                        aggregate_staging_us.saturating_add(elapsed_us(started.elapsed()));
                    last_stage = Some(Instant::now());
                    parsed.extend(batch);
                    if parsed.len() >= next_publication {
                        if let Some(sender) = &progress
                            && sender.capacity() > 0
                        {
                            let catalog =
                                preview_catalog_from_parsed(&parsed[published_until..], usize::MAX);
                            // Coalesce UI deltas without blocking metadata parsing.
                            if sender.try_send(catalog).is_ok() {
                                published_until = parsed.len();
                            }
                        }
                        next_publication = next_publication.saturating_add(5_000);
                    }
                    while parsed.len() >= next_progress {
                        tracing::info!(
                            staged_files = next_progress,
                            "cold metadata stage progress"
                        );
                        next_progress = next_progress.saturating_add(500);
                    }
                }
                Ok((
                    connection,
                    parsed,
                    aggregate_staging_us,
                    first_stage,
                    last_stage,
                ))
            })?;
        let pipeline = Self {
            stream_buffer: Vec::with_capacity(256),
            pool: Some(parser_pool(threads)?),
            sender,
            writer: Some(writer),
            inflight: Arc::new(InflightLimiter {
                state: Mutex::new(0),
                available: std::sync::Condvar::new(),
                limit: std::env::var("PARSON_PARSE_QUEUE_DEPTH")
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(threads.saturating_mul(8))
                    .clamp(threads, 512),
            }),
            selected_threads: threads,
            started: Instant::now(),
            cancellation,
        };
        Ok(pipeline)
    }

    fn schedule(&mut self, file: DiscoveredFile, regions: Option<PrefetchedRegions>) {
        let permit = self.inflight.acquire();
        let sender = self.sender.clone();
        let cancellation = self.cancellation.clone();
        self.pool
            .as_ref()
            .expect("streaming pool initialized")
            .spawn_fifo(move || {
                let _permit = permit;
                if cancellation.is_cancelled() {
                    return;
                }
                let parsed = regions.map_or_else(
                    || parse_audio_file(&file, ""),
                    |regions| parse_audio_file_prefetched(&file, "", regions),
                );
                let _ = sender.send(parsed);
            });
    }

    fn schedule_batch(&mut self, mut files: Vec<DiscoveredFile>) {
        if files.is_empty() {
            return;
        }
        files.sort_unstable_by(|left, right| left.native_path.cmp(&right.native_path));
        let references = files.iter().collect::<Vec<_>>();
        let seek_penalty = files
            .first()
            .and_then(|file| storage_incurs_seek_penalty(&file.native_path));
        let regions = prefetch_tag_regions(
            &references,
            storage_queue_depth(&files[0].native_path, seek_penalty),
        )
        .filter(|regions| regions.len() == files.len())
        .unwrap_or_else(|| (0..files.len()).map(|_| None).collect());
        for (file, regions) in files.into_iter().zip(regions) {
            self.schedule(file, regions);
        }
    }

    fn flush_stream_buffer(&mut self) {
        let files = std::mem::take(&mut self.stream_buffer);
        self.schedule_batch(files);
    }

    fn push(
        &mut self,
        file: crate::library::discovery::DiscoveredFile,
    ) -> Result<(), rayon::ThreadPoolBuildError> {
        let file = adapt_discovered_file(file);
        self.stream_buffer.push(file);
        if self.stream_buffer.len() >= 256 {
            self.flush_stream_buffer();
        }
        Ok(())
    }

    fn finish(
        mut self,
        discovered: &[DiscoveredFile],
    ) -> Result<ColdParseResult, Box<dyn Error + Send + Sync>> {
        let enumeration_overlap_us = elapsed_us(self.started.elapsed());
        self.flush_stream_buffer();
        self.inflight.wait_idle();
        let parsing_finished = Instant::now();
        let (dummy_sender, _dummy_receiver) = std::sync::mpsc::sync_channel(1);
        drop(std::mem::replace(&mut self.sender, dummy_sender));
        let (mut connection, streamed, database_staging_us, first_stage, last_stage) = self
            .writer
            .take()
            .expect("cold stage writer exists")
            .join()
            .map_err(|_| std::io::Error::other("cold stage writer panicked"))??;
        let parsing_staging_overlap_us = first_stage
            .zip(last_stage)
            .and_then(|(first, last)| {
                parsing_finished
                    .min(last)
                    .checked_duration_since(self.started.max(first))
            })
            .map(elapsed_us)
            .unwrap_or_default();

        // Reconcile watcher changes reported during the initial walk.
        let mut parsed_by_path = streamed
            .into_iter()
            .map(|parsed| (parsed.path.clone(), parsed))
            .collect::<HashMap<_, _>>();
        let mut parsed = Vec::with_capacity(discovered.len());
        let mut missing = Vec::new();
        for file in discovered {
            if let Some(value) = parsed_by_path.remove(file.path.as_ref()) {
                parsed.push(value);
            } else {
                missing.push(file);
            }
        }
        if !missing.is_empty() {
            let missing_parsed =
                parse_file_batch(&missing, &HashMap::new(), self.selected_threads)?;
            for record in &missing_parsed {
                stage_cold_parsed(&mut connection, record)?;
            }
            parsed.extend(missing_parsed);
        }
        let wall_us = elapsed_us(self.started.elapsed());
        Ok(ColdParseResult {
            parsed,
            connection: Some(connection),
            threads: self.selected_threads,
            autotuned: false,
            wall_us,
            enumeration_overlap_us,
            database_staging_us,
            parsing_staging_overlap_us,
        })
    }
}

#[derive(Debug, Clone, Copy)]
struct MpegFrameHeader {
    bitrate_kbps: u32,
    sample_rate: u32,
    samples_per_frame: u32,
    xing_offset: usize,
}

fn parse_mpeg_frame_header(bytes: [u8; 4]) -> Option<MpegFrameHeader> {
    let value = u32::from_be_bytes(bytes);
    if value & 0xffe0_0000 != 0xffe0_0000 {
        return None;
    }
    let version = (value >> 19) & 0x3;
    let layer = (value >> 17) & 0x3;
    let bitrate_index = ((value >> 12) & 0xf) as usize;
    let sample_rate_index = ((value >> 10) & 0x3) as usize;
    if version == 1
        || layer != 1
        || bitrate_index == 0
        || bitrate_index == 15
        || sample_rate_index == 3
    {
        return None;
    }

    const MPEG1_LAYER3: [u32; 16] = [
        0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
    ];
    const MPEG2_LAYER3: [u32; 16] = [
        0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
    ];
    const SAMPLE_RATES: [u32; 3] = [44_100, 48_000, 32_000];

    let mpeg1 = version == 3;
    let divisor = if mpeg1 {
        1
    } else if version == 2 {
        2
    } else {
        4
    };
    let sample_rate = SAMPLE_RATES[sample_rate_index] / divisor;
    let mono = (value >> 6) & 0x3 == 3;
    let has_crc = (value >> 16) & 1 == 0;
    let side_information = match (mpeg1, mono) {
        (true, true) => 17,
        (true, false) => 32,
        (false, true) => 9,
        (false, false) => 17,
    };

    Some(MpegFrameHeader {
        bitrate_kbps: if mpeg1 { MPEG1_LAYER3 } else { MPEG2_LAYER3 }[bitrate_index],
        sample_rate,
        samples_per_frame: if mpeg1 { 1152 } else { 576 },
        xing_offset: 4 + usize::from(has_crc) * 2 + side_information,
    })
}

fn id3v2_region_length(header: &[u8; 10]) -> Option<u64> {
    if &header[..3] != b"ID3" || header[6..10].iter().any(|byte| byte & 0x80 != 0) {
        return None;
    }
    let payload = header[6..10]
        .iter()
        .fold(0u64, |size, byte| (size << 7) | u64::from(*byte));
    Some(10 + payload + if header[5] & 0x10 != 0 { 10 } else { 0 })
}

fn find_first_mpeg_frame<R: Read + Seek>(
    reader: &mut R,
) -> std::io::Result<Option<(u64, MpegFrameHeader, Vec<u8>)>> {
    reader.seek(SeekFrom::Start(0))?;
    let mut id3_header = [0u8; 10];
    let read = reader.read(&mut id3_header)?;
    let audio_start = (read == id3_header.len())
        .then(|| id3v2_region_length(&id3_header))
        .flatten()
        .unwrap_or_default();
    reader.seek(SeekFrom::Start(audio_start))?;

    // Read one page first and retain a 64 KiB fallback for leading junk.
    const INITIAL_PROBE_BYTES: usize = 8 * 1024;
    const MAX_PROBE_BYTES: usize = 64 * 1024;
    let mut header_region = vec![0u8; INITIAL_PROBE_BYTES];
    let mut count = reader.read(&mut header_region)?;
    header_region.truncate(count);

    let find_frame = |region: &[u8], start: usize| {
        (start..region.len().saturating_sub(3)).find_map(|offset| {
            let bytes = region[offset..offset + 4]
                .try_into()
                .expect("four-byte frame header");
            parse_mpeg_frame_header(bytes).map(|header| (offset, header))
        })
    };
    if let Some((offset, header)) = find_frame(&header_region, 0) {
        return Ok(Some((
            audio_start + offset as u64,
            header,
            header_region[offset..].to_vec(),
        )));
    }

    header_region.resize(MAX_PROBE_BYTES, 0);
    while count < MAX_PROBE_BYTES {
        let read = reader.read(&mut header_region[count..])?;
        if read == 0 {
            break;
        }
        count += read;
    }
    header_region.truncate(count);
    for offset in INITIAL_PROBE_BYTES.saturating_sub(3)..header_region.len().saturating_sub(3) {
        let bytes = header_region[offset..offset + 4]
            .try_into()
            .expect("four-byte frame header");
        if let Some(header) = parse_mpeg_frame_header(bytes) {
            return Ok(Some((
                audio_start + offset as u64,
                header,
                header_region[offset..].to_vec(),
            )));
        }
    }
    Ok(None)
}

fn mp3_duration<R: Read + Seek>(
    reader: &mut R,
    file_length: u64,
) -> std::io::Result<(f64, DurationSource)> {
    let Some((frame_offset, header, first_frame)) = find_first_mpeg_frame(reader)? else {
        return Ok((0.0, DurationSource::Unavailable));
    };

    let mut candidates = Vec::with_capacity(2);
    if first_frame.len() >= header.xing_offset + 18 {
        candidates.push(&first_frame[header.xing_offset..]);
    }
    // VBRI starts 32 bytes after the MPEG audio header.
    if first_frame.len() >= 4 + 32 + 18 {
        candidates.push(&first_frame[4 + 32..]);
    }
    for candidate in candidates {
        let frames = match candidate.get(..4) {
            Some(b"Xing" | b"Info") if candidate.len() >= 16 => {
                let flags = u32::from_be_bytes(candidate[4..8].try_into().unwrap());
                (flags & 1 != 0).then(|| u32::from_be_bytes(candidate[8..12].try_into().unwrap()))
            }
            Some(b"VBRI") if candidate.len() >= 18 => {
                Some(u32::from_be_bytes(candidate[14..18].try_into().unwrap()))
            }
            _ => None,
        };
        if let Some(frames) = frames.filter(|frames| *frames > 0) {
            let seconds =
                frames as f64 * header.samples_per_frame as f64 / header.sample_rate as f64;
            return Ok((seconds, DurationSource::HeaderDerived));
        }
    }

    if header.bitrate_kbps > 0 && file_length > frame_offset {
        let seconds =
            (file_length - frame_offset) as f64 * 8.0 / (header.bitrate_kbps as f64 * 1000.0);
        return Ok((seconds, DurationSource::Estimated));
    }
    Ok((0.0, DurationSource::Unavailable))
}

fn is_disc_directory(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    DISC_DIRECTORY
        .get_or_init(|| {
            regex::Regex::new(
                r"(?ix)^\s*(?:cd|disc|disk|volume|vol)\s*[-_. ]*(?:\d{1,2}|one|two|three|four)(?:\s+of\s+\d{1,2})?\s*$",
            )
            .expect("disc-directory regex should compile")
        })
        .is_match(name)
}

fn album_directory(directory: &Path) -> &Path {
    if is_disc_directory(directory) {
        directory.parent().unwrap_or(directory)
    } else {
        directory
    }
}

fn filename_cover_score(path: &Path, album_directory: &Path) -> i32 {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let normalized = stem
        .replace(['_', '-', '.', '(', ')', '[', ']'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let compact = normalized.replace(' ', "");
    let tokens = normalized.split_whitespace().collect::<HashSet<_>>();
    let mut score = 0;

    if matches!(normalized.as_str(), "f" | "front") {
        score += 1_400;
    } else if matches!(normalized.as_str(), "cover" | "folder" | "album") {
        score += 1_200;
    } else if tokens.contains("front") || compact.starts_with("front") || compact.ends_with("front")
    {
        score += 1_000;
    } else if tokens.contains("cover")
        || tokens.contains("folder")
        || tokens.contains("jacket")
        || tokens.contains("sleeve")
        || compact.starts_with("cover")
        || compact.starts_with("folder")
        || compact.starts_with("albumart")
        || compact.starts_with("jacket")
        || compact.starts_with("sleeve")
    {
        score += 850;
    }

    let non_front_prefix = [
        "back",
        "rear",
        "booklet",
        "tray",
        "inlay",
        "disc",
        "disk",
        "cd",
        "inside",
        "inner",
        "spine",
        "obi",
        "label",
        "matrix",
        "artist",
        "logo",
        "fanart",
        "banner",
        "wallpaper",
    ]
    .iter()
    .any(|prefix| compact.starts_with(prefix));
    if matches!(normalized.as_str(), "b" | "back" | "rear")
        || non_front_prefix
        || matches!(
            compact.as_str(),
            "coverback" | "coverrear" | "frontback" | "frontrear"
        )
        || tokens.iter().any(|token| {
            matches!(
                *token,
                "back"
                    | "rear"
                    | "tray"
                    | "inlay"
                    | "booklet"
                    | "disc"
                    | "disk"
                    | "cd"
                    | "inside"
                    | "inner"
                    | "spine"
                    | "obi"
                    | "label"
                    | "matrix"
                    | "artist"
                    | "logo"
                    | "fanart"
                    | "banner"
                    | "wallpaper"
            )
        })
    {
        score -= 1_600;
    }

    if path
        .parent()
        .is_some_and(|directory| directory != album_directory)
    {
        let parent_name = path
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if parent_name.contains("cover") || parent_name.contains("artwork") {
            score += 250;
        }
    }
    score
}

fn cover_candidate_score(path: &Path, album_directory: &Path) -> Option<(i32, CoverSuitability)> {
    let filename_score = filename_cover_score(path, album_directory);
    let mut score = filename_score;
    let (width, height) = image::image_dimensions(path).ok()?;
    let shortest = width.min(height);
    if shortest == 0 {
        return None;
    }
    let longest = width.max(height);
    let ratio = longest as f64 / shortest as f64;
    if ratio <= 1.08 {
        score += 500;
    } else if ratio <= 1.25 {
        score += 200;
    } else {
        score -= 250;
    }
    if shortest < 200 {
        score -= 250;
    }

    let suitability = if shortest < 200 || ratio > 1.25 {
        CoverSuitability::Fallback
    } else if ratio > 1.08 {
        CoverSuitability::NearSquare
    } else if filename_score >= 850 {
        CoverSuitability::Preferred
    } else {
        CoverSuitability::Square
    };
    Some((score, suitability))
}

fn cover_spread_crop(path: &Path) -> Option<CoverCrop> {
    let (width, height) = image::image_dimensions(path).ok()?;
    let shortest = width.min(height);
    if shortest < 400 {
        return None;
    }
    let ratio = width.max(height) as f64 / shortest as f64;
    if !(1.75..=2.25).contains(&ratio) {
        return None;
    }
    if width > height {
        Some(CoverCrop::HorizontalRight)
    } else {
        Some(CoverCrop::VerticalTopClockwise)
    }
}

fn spread_crop_for_candidate(
    candidate: &DiscoveredImage,
    candidates: &[DiscoveredImage],
    album_directory: &Path,
) -> Option<CoverCrop> {
    if filename_cover_score(&candidate.path, album_directory) < 0 {
        return None;
    }
    let crop = cover_spread_crop(&candidate.path)?;
    let has_back_companion = candidates.iter().any(|other| {
        other.path != candidate.path
            && other.path.parent() == candidate.path.parent()
            && filename_cover_score(&other.path, album_directory) <= -1_000
            && image::image_dimensions(&other.path).is_ok()
    });
    has_back_companion.then_some(crop)
}

fn inventory_candidates(
    inventory: &FilesystemInventory,
    album_directory: &Path,
) -> Vec<DiscoveredImage> {
    let mut candidates = inventory
        .images_by_directory
        .get(album_directory)
        .cloned()
        .unwrap_or_default();
    candidates.retain(|candidate| {
        let Some(parent) = candidate.path.parent() else {
            return false;
        };
        if parent == album_directory {
            return true;
        }
        if parent.parent() != Some(album_directory) {
            return false;
        }
        let name = parent
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        name.contains("cover") || name.contains("artwork")
    });
    candidates.sort_by(|left, right| left.path.cmp(&right.path));
    candidates.dedup_by(|left, right| left.path == right.path);
    candidates
}

fn inventory_signature(candidates: &[DiscoveredImage]) -> String {
    inventory_signature_for_version(candidates, COVER_RESOLVER_VERSION)
}

fn inventory_signature_for_version(
    candidates: &[DiscoveredImage],
    resolver_version: &str,
) -> String {
    let mut digest = Sha256::new();
    // Resolver changes invalidate cached selections.
    digest.update(b"parson-directory-cover\0");
    digest.update(resolver_version.as_bytes());
    digest.update(b"\0");
    for image in candidates {
        digest.update(normalize_path(&image.path).as_bytes());
        digest.update(image.size_bytes.to_le_bytes());
        digest.update(image.modified_at_ns.to_le_bytes());
    }
    hex_digest(digest.finalize().as_slice())
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn hash_file(path: &Path) -> String {
    let Ok(file) = File::open(path) else {
        return String::new();
    };
    let mut reader = BufReader::new(file);
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let Ok(read) = reader.read(&mut buffer) else {
            return String::new();
        };
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    hex_digest(digest.finalize().as_slice())
}

fn persist_cropped_cover(
    source: &Path,
    crop: CoverCrop,
    cover_directory: &Path,
) -> CoverResolution {
    let source_hash = hash_file(source);
    if source_hash.is_empty() {
        return CoverResolution::default();
    }
    let mut digest = Sha256::new();
    digest.update(b"parson-cropped-cover-v1\0");
    digest.update(source_hash.as_bytes());
    digest.update([match crop {
        CoverCrop::HorizontalRight => 0,
        CoverCrop::VerticalTopClockwise => 1,
    }]);
    let content_hash = hex_digest(digest.finalize().as_slice());
    let cover_path = cover_directory.join(format!("{content_hash}.jpg"));
    if cover_path
        .metadata()
        .is_ok_and(|metadata| metadata.len() > 0)
    {
        return CoverResolution {
            path: normalize_path(&cover_path),
            content_hash,
            preferred: false,
        };
    }

    let Ok(mut reader) = image::ImageReader::open(source) else {
        return CoverResolution::default();
    };
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let Ok(image) = reader.decode() else {
        return CoverResolution::default();
    };
    let (width, height) = (image.width(), image.height());
    let cropped = match crop {
        CoverCrop::HorizontalRight => {
            let size = (width / 2).min(height);
            let y = (height - size) / 2;
            image.crop_imm(width - size, y, size, size)
        }
        CoverCrop::VerticalTopClockwise => {
            let size = width.min(height / 2);
            let x = (width - size) / 2;
            image.crop_imm(x, 0, size, size).rotate90()
        }
    };
    let temporary = cover_path.with_extension(format!("jpg.{}.tmp", Uuid::new_v4()));
    let written = cropped
        .save_with_format(&temporary, image::ImageFormat::Jpeg)
        .map_err(std::io::Error::other);
    match written.and_then(|()| std::fs::rename(&temporary, &cover_path)) {
        Ok(()) => CoverResolution {
            path: normalize_path(&cover_path),
            content_hash,
            preferred: false,
        },
        Err(_)
            if cover_path
                .metadata()
                .is_ok_and(|metadata| metadata.len() > 0) =>
        {
            let _ = std::fs::remove_file(&temporary);
            CoverResolution {
                path: normalize_path(&cover_path),
                content_hash,
                preferred: false,
            }
        }
        Err(error) => {
            let _ = std::fs::remove_file(&temporary);
            warn!(
                source = %source.display(),
                %error,
                "failed to persist cropped cover artwork"
            );
            CoverResolution::default()
        }
    }
}

fn resolve_inventory_cover_with_storage(
    candidates: &[DiscoveredImage],
    album_directory: &Path,
    cover_directory: Option<&Path>,
) -> CoverResolution {
    candidates
        .iter()
        .filter_map(|candidate| {
            if let Some(crop) = spread_crop_for_candidate(candidate, candidates, album_directory) {
                return Some((candidate, 450, CoverSuitability::NearSquare, Some(crop)));
            }
            cover_candidate_score(&candidate.path, album_directory)
                .map(|(score, suitability)| (candidate, score, suitability, None))
        })
        .filter(|(_, score, _, _)| *score >= 200)
        .max_by(
            |(left, left_score, left_suitability, _),
             (right, right_score, right_suitability, _)| {
                left_suitability
                    .cmp(right_suitability)
                    .then_with(|| left_score.cmp(right_score))
                    .then_with(|| right.path.cmp(&left.path))
            },
        )
        .map(|(candidate, _, suitability, crop)| {
            if let (Some(crop), Some(cover_directory)) = (crop, cover_directory) {
                return persist_cropped_cover(&candidate.path, crop, cover_directory);
            }
            CoverResolution {
                path: normalize_path(&candidate.path),
                content_hash: hash_file(&candidate.path),
                preferred: suitability == CoverSuitability::Preferred,
            }
        })
        .unwrap_or_default()
}

#[cfg(test)]
fn resolve_inventory_cover(
    candidates: &[DiscoveredImage],
    album_directory: &Path,
) -> CoverResolution {
    resolve_inventory_cover_with_storage(candidates, album_directory, None)
}

#[cfg(test)]
fn local_cover_resolution_for(path: &Path) -> CoverResolution {
    let Some(directory) = path.parent() else {
        return CoverResolution::default();
    };
    let album_directory = album_directory(directory);
    let inventory = reconcile_files(&normalize_path(album_directory));
    resolve_inventory_cover(
        &inventory_candidates(&inventory, album_directory),
        album_directory,
    )
}

#[cfg(test)]
fn local_cover_for(path: &Path) -> String {
    local_cover_resolution_for(path).path
}

fn cover_has_preferred_geometry(path: &str) -> bool {
    let Ok((width, height)) = image::image_dimensions(path) else {
        return false;
    };
    let shortest = width.min(height);
    let longest = width.max(height);
    shortest >= 200 && longest as f64 / shortest as f64 <= 1.08
}

fn inherit_original_release_covers(
    effective_covers: &mut HashMap<String, String>,
    presentations: &HashMap<String, ReleasePresentation>,
) {
    for (album_id, presentation) in presentations {
        let Some(original_id) = &presentation.original_album_id else {
            continue;
        };
        let edition_has_preferred_cover = effective_covers
            .get(album_id)
            .is_some_and(|cover| cover_has_preferred_geometry(cover));
        if edition_has_preferred_cover {
            continue;
        }
        if let Some(original_cover) = effective_covers
            .get(original_id)
            .filter(|cover| cover_has_preferred_geometry(cover))
            .cloned()
        {
            effective_covers.insert(album_id.clone(), original_cover);
        }
    }
}

fn persist_embedded_cover(
    path: &Path,
    picture_data: &[u8],
    cover_directory: &Path,
) -> CoverResolution {
    let content_hash = hex_digest(Sha256::digest(picture_data).as_slice());
    let extension = match image::guess_format(picture_data) {
        Ok(image::ImageFormat::Png) => "png",
        Ok(image::ImageFormat::WebP) => "webp",
        _ => "jpg",
    };

    let cover_path = cover_directory.join(format!("{content_hash}.{extension}"));
    if cover_path
        .metadata()
        .is_ok_and(|metadata| metadata.len() > 0)
    {
        return CoverResolution {
            path: normalize_path(&cover_path),
            content_hash,
            preferred: true,
        };
    }

    let temporary = cover_path.with_extension(format!("{extension}.{}.tmp", Uuid::new_v4()));
    // Atomic rename is sufficient for the reproducible artwork cache.
    let written = File::create(&temporary).and_then(|mut file| file.write_all(picture_data));
    match written.and_then(|()| std::fs::rename(&temporary, &cover_path)) {
        Ok(()) => CoverResolution {
            path: normalize_path(&cover_path),
            content_hash,
            preferred: true,
        },
        Err(_)
            if cover_path
                .metadata()
                .is_ok_and(|metadata| metadata.len() > 0) =>
        {
            let _ = std::fs::remove_file(&temporary);
            CoverResolution {
                path: normalize_path(&cover_path),
                content_hash,
                preferred: true,
            }
        }
        Err(error) => {
            let _ = std::fs::remove_file(&temporary);
            warn!(
                "Failed to write embedded cover art for {}: {}",
                path.display(),
                error
            );
            CoverResolution::default()
        }
    }
}

fn split_people(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split(['\0', ';'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn syncsafe_u32(bytes: [u8; 4]) -> Option<u32> {
    bytes.iter().all(|byte| byte & 0x80 == 0).then(|| {
        bytes
            .iter()
            .fold(0_u32, |value, byte| (value << 7) | u32::from(*byte))
    })
}

fn encode_syncsafe_u32(value: u32) -> [u8; 4] {
    [
        ((value >> 21) & 0x7f) as u8,
        ((value >> 14) & 0x7f) as u8,
        ((value >> 7) & 0x7f) as u8,
        (value & 0x7f) as u8,
    ]
}

fn wanted_id3_text_frame(id: &[u8]) -> bool {
    matches!(
        id,
        b"TIT2"
            | b"TALB"
            | b"TPE1"
            | b"TPE2"
            | b"TCON"
            | b"TDRC"
            | b"TYER"
            | b"TDAT"
            | b"TRCK"
            | b"TPOS"
            | b"TT2"
            | b"TAL"
            | b"TP1"
            | b"TP2"
            | b"TCO"
            | b"TYE"
            | b"TRK"
            | b"TPA"
    )
}

/// Reads catalog ID3 text while seeking past large payloads.
fn read_compact_id3v2<R: Read + Seek>(reader: &mut R) -> Result<Option<id3::Tag>, String> {
    const MAX_TEXT_FRAME_BYTES: u64 = 1024 * 1024;
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut header = [0_u8; 10];
    if reader.read_exact(&mut header).is_err() || &header[..3] != b"ID3" {
        return Ok(None);
    }
    let version = header[3];
    if !(2..=4).contains(&version) {
        return Ok(None);
    }
    let Some(payload_size) = syncsafe_u32(header[6..10].try_into().expect("ID3 size")) else {
        return Ok(None);
    };
    let tag_end = 10_u64.saturating_add(u64::from(payload_size));
    let mut position = 10_u64;

    if header[5] & 0x40 != 0 {
        let mut size = [0_u8; 4];
        reader
            .read_exact(&mut size)
            .map_err(|error| error.to_string())?;
        let extended_size = if version == 4 {
            syncsafe_u32(size).map(u64::from).unwrap_or_default()
        } else {
            u64::from(u32::from_be_bytes(size)).saturating_add(4)
        };
        if extended_size < 4 || position.saturating_add(extended_size) > tag_end {
            return Ok(None);
        }
        position = position.saturating_add(extended_size);
        reader
            .seek(SeekFrom::Start(position))
            .map_err(|error| error.to_string())?;
    }

    let frame_header_len = if version == 2 { 6_usize } else { 10_usize };
    let mut compact_frames = Vec::new();
    while position.saturating_add(frame_header_len as u64) <= tag_end {
        let mut frame_header = [0_u8; 10];
        reader
            .read_exact(&mut frame_header[..frame_header_len])
            .map_err(|error| error.to_string())?;
        position += frame_header_len as u64;
        let id_len = if version == 2 { 3 } else { 4 };
        let id = &frame_header[..id_len];
        if id.iter().all(|byte| *byte == 0) || !id.iter().all(u8::is_ascii_alphanumeric) {
            break;
        }
        let frame_size = if version == 2 {
            u64::from(
                (u32::from(frame_header[3]) << 16)
                    | (u32::from(frame_header[4]) << 8)
                    | u32::from(frame_header[5]),
            )
        } else if version == 4 {
            syncsafe_u32(frame_header[4..8].try_into().expect("ID3 frame size"))
                .map(u64::from)
                .unwrap_or_default()
        } else {
            u64::from(u32::from_be_bytes(
                frame_header[4..8].try_into().expect("ID3 frame size"),
            ))
        };
        if frame_size == 0 || position.saturating_add(frame_size) > tag_end {
            break;
        }
        if wanted_id3_text_frame(id) && frame_size <= MAX_TEXT_FRAME_BYTES {
            compact_frames.extend_from_slice(&frame_header[..frame_header_len]);
            let start = compact_frames.len();
            compact_frames.resize(start + frame_size as usize, 0);
            reader
                .read_exact(&mut compact_frames[start..])
                .map_err(|error| error.to_string())?;
        } else {
            reader
                .seek(SeekFrom::Current(frame_size as i64))
                .map_err(|error| error.to_string())?;
        }
        position += frame_size;
    }

    let compact_size = u32::try_from(compact_frames.len()).map_err(|error| error.to_string())?;
    if compact_size > 0x0fff_ffff {
        return Ok(None);
    }
    let mut compact = Vec::with_capacity(10 + compact_frames.len());
    compact.extend_from_slice(b"ID3");
    compact.extend_from_slice(&header[3..5]);
    // Clear flags for omitted ID3 regions.
    compact.push(header[5] & 0x80);
    compact.extend_from_slice(&encode_syncsafe_u32(compact_size));
    compact.extend_from_slice(&compact_frames);
    id3::Tag::read_from2(std::io::Cursor::new(compact))
        .map(Some)
        .map_err(|error| error.to_string())
}

fn populate_id3_metadata(metadata: &mut RawAudioMetadata, tag: &id3::Tag) {
    metadata.title = tag.title().map(ToString::to_string);
    metadata.album = tag.album().map(ToString::to_string);
    metadata.track_artists = tag
        .artists()
        .unwrap_or_default()
        .into_iter()
        .map(ToString::to_string)
        .collect();
    metadata.album_artists = split_people(tag.album_artist());
    metadata.genre = tag
        .genre_parsed()
        .map(|genre| genre.into_owned())
        .unwrap_or_default();
    metadata.release_date = tag
        .date_recorded()
        .map(|date| date.to_string())
        .or_else(|| tag.year().map(|year| year.to_string()));
    metadata.track_number = tag.track().unwrap_or_default().min(u16::MAX.into()) as u16;
    metadata.disc_number = tag.disc().unwrap_or_default().min(u16::MAX.into()) as u16;
}

fn parse_mp3<R: Read + Seek>(reader: &mut R, file_length: u64) -> Result<RawAudioMetadata, String> {
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut metadata = RawAudioMetadata {
        parse_strategy: ParserStrategy::Mp3Fast,
        ..RawAudioMetadata::default()
    };
    let tag_started = Instant::now();
    match read_compact_id3v2(reader)? {
        Some(tag) => populate_id3_metadata(&mut metadata, &tag),
        None => {
            // Use Lofty for tagless and ID3v1-only files.
            reader
                .seek(SeekFrom::Start(0))
                .map_err(|error| error.to_string())?;
            let tagged_file = Probe::new(&mut *reader)
                .options(
                    ParseOptions::new()
                        .read_properties(false)
                        .read_cover_art(false),
                )
                .guess_file_type()
                .map_err(|error| error.to_string())?
                .read()
                .map_err(|error| error.to_string())?;
            if let Some(tag) = tagged_file
                .primary_tag()
                .or_else(|| tagged_file.first_tag())
            {
                populate_tag_metadata(&mut metadata, tag);
            }
        }
    }
    metadata.tag_parse_us = elapsed_us(tag_started.elapsed());
    let duration_started = Instant::now();
    let (duration, source) =
        mp3_duration(reader, file_length).map_err(|error| error.to_string())?;
    metadata.duration_us = elapsed_us(duration_started.elapsed());
    metadata.duration_seconds = duration;
    metadata.duration_source = Some(source);
    Ok(metadata)
}

fn populate_tag_metadata(metadata: &mut RawAudioMetadata, tag: &lofty::tag::Tag) {
    metadata.title = tag.title().map(|value| value.into_owned());
    metadata.album = tag.album().map(|value| value.into_owned());
    metadata.track_artists = split_people(tag.artist().as_deref());
    metadata.album_artists = tag
        .get_string(lofty::tag::ItemKey::AlbumArtist)
        .map(|value| split_people(Some(value)))
        .unwrap_or_default();
    metadata.genre = tag
        .genre()
        .map(|value| value.into_owned())
        .unwrap_or_default();
    metadata.release_date = tag.date().map(|date| date.to_string());
    metadata.track_number = tag.track().unwrap_or_default().min(u16::MAX.into()) as u16;
    metadata.disc_number = tag.disk().unwrap_or_default().min(u16::MAX.into()) as u16;
}

fn read_u32_le<R: Read>(reader: &mut R) -> Result<u32, String> {
    let mut bytes = [0_u8; 4];
    reader
        .read_exact(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(u32::from_le_bytes(bytes))
}

fn read_u32_be<R: Read>(reader: &mut R) -> Result<u32, String> {
    let mut bytes = [0_u8; 4];
    reader
        .read_exact(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(u32::from_be_bytes(bytes))
}

fn seek_forward<R: Seek>(reader: &mut R, bytes: u64) -> Result<(), String> {
    let offset = i64::try_from(bytes).map_err(|error| error.to_string())?;
    reader
        .seek(SeekFrom::Current(offset))
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn parse_number_prefix(value: &str) -> u16 {
    value
        .split_once('/')
        .map_or(value, |(number, _)| number)
        .trim()
        .parse::<u32>()
        .unwrap_or_default()
        .min(u16::MAX.into()) as u16
}

fn apply_vorbis_comment(metadata: &mut RawAudioMetadata, comment: &[u8]) {
    let Ok(comment) = std::str::from_utf8(comment) else {
        return;
    };
    let Some((key, value)) = comment.split_once('=') else {
        return;
    };
    let value = value.trim();
    if value.is_empty() {
        return;
    }
    match key.trim().to_ascii_uppercase().as_str() {
        "TITLE" if metadata.title.is_none() => metadata.title = Some(value.to_string()),
        "ALBUM" if metadata.album.is_none() => metadata.album = Some(value.to_string()),
        "ARTIST" => metadata.track_artists.push(value.to_string()),
        "ALBUMARTIST" | "ALBUM ARTIST" => metadata.album_artists.push(value.to_string()),
        "GENRE" => {
            if !metadata.genre.is_empty() {
                metadata.genre.push(';');
            }
            metadata.genre.push_str(value);
        }
        "DATE" | "YEAR" if metadata.release_date.is_none() => {
            metadata.release_date = Some(value.to_string());
        }
        "TRACKNUMBER" if metadata.track_number == 0 => {
            metadata.track_number = parse_number_prefix(value);
        }
        "DISCNUMBER" if metadata.disc_number == 0 => {
            metadata.disc_number = parse_number_prefix(value);
        }
        _ => {}
    }
}

/// Reads FLAC catalog metadata while seeking past large blocks.
fn seek_to_flac_stream<R: Read + Seek>(reader: &mut R) -> Result<u64, String> {
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut header = [0_u8; 10];
    reader
        .read_exact(&mut header[..4])
        .map_err(|error| error.to_string())?;
    if &header[..4] == b"fLaC" {
        return Ok(0);
    }
    if &header[..3] != b"ID3" {
        return Err("FLAC stream marker not found".to_string());
    }
    reader
        .read_exact(&mut header[4..])
        .map_err(|error| error.to_string())?;
    let payload = syncsafe_u32(header[6..10].try_into().expect("ID3 size"))
        .ok_or_else(|| "invalid leading ID3 size".to_string())?;
    let footer = u64::from(header[5] & 0x10 != 0) * 10;
    let stream_start = 10_u64
        .checked_add(u64::from(payload))
        .and_then(|offset| offset.checked_add(footer))
        .ok_or_else(|| "leading ID3 size overflow".to_string())?;
    reader
        .seek(SeekFrom::Start(stream_start))
        .map_err(|error| error.to_string())?;
    let mut marker = [0_u8; 4];
    reader
        .read_exact(&mut marker)
        .map_err(|error| error.to_string())?;
    if &marker != b"fLaC" {
        return Err("FLAC stream marker not found after leading ID3".to_string());
    }
    Ok(stream_start)
}

fn parse_flac_fast<R: Read + Seek>(reader: &mut R) -> Result<RawAudioMetadata, String> {
    const MAX_COMMENT_BYTES: u64 = 1024 * 1024;
    let started = Instant::now();
    seek_to_flac_stream(reader)?;

    let mut metadata = RawAudioMetadata {
        parse_strategy: ParserStrategy::FlacFast,
        ..RawAudioMetadata::default()
    };
    let mut saw_streaminfo = false;
    loop {
        let mut header = [0_u8; 4];
        reader
            .read_exact(&mut header)
            .map_err(|error| error.to_string())?;
        let last = header[0] & 0x80 != 0;
        let block_type = header[0] & 0x7f;
        let block_len = u64::from(u32::from_be_bytes([0, header[1], header[2], header[3]]));
        match block_type {
            0 => {
                if saw_streaminfo || block_len != 34 {
                    return Err("invalid FLAC STREAMINFO block".to_string());
                }
                let mut streaminfo = [0_u8; 34];
                reader
                    .read_exact(&mut streaminfo)
                    .map_err(|error| error.to_string())?;
                let packed = u64::from_be_bytes(
                    streaminfo[10..18]
                        .try_into()
                        .expect("FLAC packed STREAMINFO fields"),
                );
                let sample_rate = (packed >> 44) & 0x0f_ffff;
                let total_samples = packed & 0x0f_ffff_ffff;
                if sample_rate > 0 && total_samples > 0 {
                    metadata.duration_seconds = total_samples as f64 / sample_rate as f64;
                    metadata.duration_source = Some(DurationSource::Exact);
                }
                saw_streaminfo = true;
            }
            4 => {
                let block_start = reader
                    .stream_position()
                    .map_err(|error| error.to_string())?;
                let block_end = block_start
                    .checked_add(block_len)
                    .ok_or_else(|| "FLAC comment block overflow".to_string())?;
                if block_len < 8 {
                    return Err("truncated FLAC Vorbis comment block".to_string());
                }
                let vendor_len = u64::from(read_u32_le(reader)?);
                if vendor_len > block_len.saturating_sub(8) {
                    return Err("invalid FLAC Vorbis vendor length".to_string());
                }
                seek_forward(reader, vendor_len)?;
                let comment_count = read_u32_le(reader)?;
                for _ in 0..comment_count {
                    if reader
                        .stream_position()
                        .map_err(|error| error.to_string())?
                        + 4
                        > block_end
                    {
                        return Err("truncated FLAC Vorbis comments".to_string());
                    }
                    let comment_len = u64::from(read_u32_le(reader)?);
                    let position = reader
                        .stream_position()
                        .map_err(|error| error.to_string())?;
                    if position.saturating_add(comment_len) > block_end {
                        return Err("invalid FLAC Vorbis comment length".to_string());
                    }
                    if comment_len <= MAX_COMMENT_BYTES {
                        let mut comment = vec![0_u8; comment_len as usize];
                        reader
                            .read_exact(&mut comment)
                            .map_err(|error| error.to_string())?;
                        apply_vorbis_comment(&mut metadata, &comment);
                    } else {
                        // Defer oversized comments, which are usually base64 artwork.
                        seek_forward(reader, comment_len)?;
                    }
                }
                reader
                    .seek(SeekFrom::Start(block_end))
                    .map_err(|error| error.to_string())?;
            }
            6 if metadata.embedded_artwork.is_none() => {
                let block_start = reader
                    .stream_position()
                    .map_err(|error| error.to_string())?;
                let block_end = block_start.saturating_add(block_len);
                let mut fixed = [0; 8];
                reader
                    .read_exact(&mut fixed)
                    .map_err(|error| error.to_string())?;
                let mime_len = u64::from(u32::from_be_bytes(
                    fixed[4..8].try_into().expect("FLAC MIME length"),
                ));
                seek_forward(reader, mime_len)?;
                let description_len = u64::from(read_u32_be(reader)?);
                seek_forward(reader, description_len.saturating_add(16))?;
                let image_len = u64::from(read_u32_be(reader)?);
                let image_offset = reader
                    .stream_position()
                    .map_err(|error| error.to_string())?;
                if image_offset.saturating_add(image_len) <= block_end {
                    metadata.embedded_artwork = Some(EmbeddedArtworkRegion {
                        offset: image_offset,
                        length: image_len,
                    });
                }
                reader
                    .seek(SeekFrom::Start(block_end))
                    .map_err(|error| error.to_string())?;
            }
            _ => seek_forward(reader, block_len)?,
        }
        if last {
            break;
        }
    }
    if !saw_streaminfo {
        return Err("FLAC STREAMINFO block not found".to_string());
    }
    metadata.tag_parse_us = elapsed_us(started.elapsed());
    metadata.duration_us = 0;
    metadata
        .duration_source
        .get_or_insert(DurationSource::Unavailable);
    Ok(metadata)
}

fn parse_vorbis_comment_packet(
    metadata: &mut RawAudioMetadata,
    packet: &[u8],
) -> Result<(), String> {
    let payload = if packet.starts_with(b"\x03vorbis") {
        &packet[7..]
    } else if packet.starts_with(b"OpusTags") {
        &packet[8..]
    } else {
        return Ok(());
    };
    let mut cursor = std::io::Cursor::new(payload);
    let vendor = u64::from(read_u32_le(&mut cursor)?);
    seek_forward(&mut cursor, vendor)?;
    let comments = read_u32_le(&mut cursor)?;
    for _ in 0..comments {
        let length = u64::from(read_u32_le(&mut cursor)?);
        if length > 1024 * 1024 {
            seek_forward(&mut cursor, length)?;
            continue;
        }
        let mut comment = vec![0; length as usize];
        cursor
            .read_exact(&mut comment)
            .map_err(|error| error.to_string())?;
        apply_vorbis_comment(metadata, &comment);
    }
    Ok(())
}

/// Extracts complete packets from a bounded Ogg metadata window.
fn ogg_packets(bytes: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    let mut packets = Vec::new();
    let mut packet = Vec::new();
    let mut offset = 0;
    while offset + 27 <= bytes.len() {
        if &bytes[offset..offset + 4] != b"OggS" {
            offset += 1;
            continue;
        }
        let segments = bytes[offset + 26] as usize;
        if offset + 27 + segments > bytes.len() {
            break;
        }
        let lacing = &bytes[offset + 27..offset + 27 + segments];
        let payload_start = offset + 27 + segments;
        let payload_len = lacing.iter().map(|value| *value as usize).sum::<usize>();
        if payload_start + payload_len > bytes.len() {
            break;
        }
        let mut payload = payload_start;
        for &length in lacing {
            let end = payload + length as usize;
            packet.extend_from_slice(&bytes[payload..end]);
            payload = end;
            if length < 255 {
                packets.push(std::mem::take(&mut packet));
            }
        }
        offset = payload_start + payload_len;
    }
    (!packets.is_empty())
        .then_some(packets)
        .ok_or_else(|| "Ogg pages not found".to_string())
}

fn final_ogg_granule(bytes: &[u8]) -> Option<u64> {
    bytes
        .windows(4)
        .enumerate()
        .filter(|(offset, marker)| *marker == b"OggS" && offset + 14 <= bytes.len())
        .map(|(offset, _)| {
            u64::from_le_bytes(bytes[offset + 6..offset + 14].try_into().expect("granule"))
        })
        .rfind(|granule| *granule != u64::MAX)
}

fn parse_ogg_fast<R: Read + Seek>(
    reader: &mut R,
    file_length: u64,
) -> Result<RawAudioMetadata, String> {
    const WINDOW: usize = 128 * 1024;
    let started = Instant::now();
    let start = read_tag_region(reader, file_length, TagRegion::Start(WINDOW))?;
    let packets = ogg_packets(&start)?;
    let identification = packets
        .first()
        .ok_or_else(|| "Ogg identification packet missing".to_string())?;
    let (sample_rate, pre_skip, strategy) =
        if identification.starts_with(b"\x01vorbis") && identification.len() >= 16 {
            (
                u32::from_le_bytes(
                    identification[12..16]
                        .try_into()
                        .expect("Vorbis sample rate"),
                ),
                0_u64,
                ParserStrategy::OggVorbisFast,
            )
        } else if identification.starts_with(b"OpusHead") && identification.len() >= 12 {
            (
                48_000,
                u64::from(u16::from_le_bytes(
                    identification[10..12].try_into().expect("Opus pre-skip"),
                )),
                ParserStrategy::OggOpusFast,
            )
        } else {
            return Err("unsupported Ogg codec".to_string());
        };
    let mut metadata = RawAudioMetadata {
        parse_strategy: strategy,
        ..RawAudioMetadata::default()
    };
    for packet in packets.iter().take(4) {
        parse_vorbis_comment_packet(&mut metadata, packet)?;
    }
    let end = read_tag_region(reader, file_length, TagRegion::End(WINDOW))?;
    if let Some(granule) = final_ogg_granule(&end).filter(|_| sample_rate > 0) {
        metadata.duration_seconds = granule.saturating_sub(pre_skip) as f64 / sample_rate as f64;
        metadata.duration_source = Some(DurationSource::Exact);
    } else {
        metadata.duration_source = Some(DurationSource::Unavailable);
    }
    metadata.tag_parse_us = elapsed_us(started.elapsed());
    Ok(metadata)
}

fn read_chunk_header<R: Read>(
    reader: &mut R,
    little_endian: bool,
) -> Result<([u8; 4], u32), String> {
    let mut header = [0; 8];
    reader
        .read_exact(&mut header)
        .map_err(|error| error.to_string())?;
    let size = if little_endian {
        u32::from_le_bytes(header[4..8].try_into().expect("chunk size"))
    } else {
        u32::from_be_bytes(header[4..8].try_into().expect("chunk size"))
    };
    Ok((header[..4].try_into().expect("chunk id"), size))
}

fn parse_wav_fast<R: Read + Seek>(
    reader: &mut R,
    file_length: u64,
) -> Result<RawAudioMetadata, String> {
    let started = Instant::now();
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut riff = [0; 12];
    reader
        .read_exact(&mut riff)
        .map_err(|error| error.to_string())?;
    if &riff[..4] != b"RIFF" || &riff[8..] != b"WAVE" {
        return Err("WAVE header not found".into());
    }
    let mut metadata = RawAudioMetadata {
        parse_strategy: ParserStrategy::WavFast,
        ..RawAudioMetadata::default()
    };
    let mut byte_rate = 0_u32;
    let mut data_bytes = 0_u64;
    while reader
        .stream_position()
        .map_err(|error| error.to_string())?
        .saturating_add(8)
        <= file_length
    {
        let (kind, size) = read_chunk_header(reader, true)?;
        let start = reader
            .stream_position()
            .map_err(|error| error.to_string())?;
        match &kind {
            b"fmt " if size >= 12 => {
                let mut format = [0; 12];
                reader
                    .read_exact(&mut format)
                    .map_err(|error| error.to_string())?;
                byte_rate = u32::from_le_bytes(format[8..12].try_into().expect("byte rate"));
            }
            b"data" => data_bytes = u64::from(size),
            _ => {}
        }
        reader
            .seek(SeekFrom::Start(
                start
                    .saturating_add(u64::from(size))
                    .saturating_add(u64::from(size & 1)),
            ))
            .map_err(|error| error.to_string())?;
    }
    if byte_rate > 0 && data_bytes > 0 {
        metadata.duration_seconds = data_bytes as f64 / byte_rate as f64;
        metadata.duration_source = Some(DurationSource::Exact);
    } else {
        metadata.duration_source = Some(DurationSource::Unavailable);
    }
    metadata.tag_parse_us = elapsed_us(started.elapsed());
    Ok(metadata)
}

fn extended_80_rate(bytes: [u8; 10]) -> f64 {
    let exponent = i32::from(u16::from_be_bytes([bytes[0], bytes[1]]) & 0x7fff) - 16383;
    let mantissa = u64::from_be_bytes(bytes[2..].try_into().expect("AIFF rate"));
    if mantissa == 0 {
        0.0
    } else {
        (mantissa as f64) * 2_f64.powi(exponent - 63)
    }
}

fn parse_aiff_fast<R: Read + Seek>(
    reader: &mut R,
    file_length: u64,
) -> Result<RawAudioMetadata, String> {
    let started = Instant::now();
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut form = [0; 12];
    reader
        .read_exact(&mut form)
        .map_err(|error| error.to_string())?;
    if &form[..4] != b"FORM" || !matches!(&form[8..], b"AIFF" | b"AIFC") {
        return Err("AIFF header not found".into());
    }
    let mut metadata = RawAudioMetadata {
        parse_strategy: ParserStrategy::AiffFast,
        ..RawAudioMetadata::default()
    };
    while reader
        .stream_position()
        .map_err(|error| error.to_string())?
        .saturating_add(8)
        <= file_length
    {
        let (kind, size) = read_chunk_header(reader, false)?;
        let start = reader
            .stream_position()
            .map_err(|error| error.to_string())?;
        if &kind == b"COMM" && size >= 18 {
            let mut comm = [0; 18];
            reader
                .read_exact(&mut comm)
                .map_err(|error| error.to_string())?;
            let frames = u32::from_be_bytes(comm[2..6].try_into().expect("AIFF frames"));
            let rate = extended_80_rate(comm[8..18].try_into().expect("AIFF rate"));
            if rate > 0.0 && frames > 0 {
                metadata.duration_seconds = frames as f64 / rate;
                metadata.duration_source = Some(DurationSource::Exact);
            }
        }
        reader
            .seek(SeekFrom::Start(
                start
                    .saturating_add(u64::from(size))
                    .saturating_add(u64::from(size & 1)),
            ))
            .map_err(|error| error.to_string())?;
    }
    metadata
        .duration_source
        .get_or_insert(DurationSource::Unavailable);
    metadata.tag_parse_us = elapsed_us(started.elapsed());
    Ok(metadata)
}

#[derive(Debug, Clone, Copy)]
struct Mp4Atom {
    kind: [u8; 4],
    content_start: u64,
    end: u64,
}

fn read_mp4_atom<R: Read + Seek>(
    reader: &mut R,
    parent_end: u64,
) -> Result<Option<Mp4Atom>, String> {
    let start = reader
        .stream_position()
        .map_err(|error| error.to_string())?;
    if parent_end.saturating_sub(start) < 8 {
        return Ok(None);
    }
    let mut header = [0_u8; 8];
    reader
        .read_exact(&mut header)
        .map_err(|error| error.to_string())?;
    let short_size = u32::from_be_bytes(header[..4].try_into().expect("MP4 atom size"));
    let kind = header[4..8].try_into().expect("MP4 atom type");
    let (size, header_len) = match short_size {
        0 => (parent_end.saturating_sub(start), 8_u64),
        1 => {
            let mut extended = [0_u8; 8];
            reader
                .read_exact(&mut extended)
                .map_err(|error| error.to_string())?;
            (u64::from_be_bytes(extended), 16_u64)
        }
        size => (u64::from(size), 8_u64),
    };
    if size < header_len {
        return Err("invalid MP4 atom size".to_string());
    }
    let end = start
        .checked_add(size)
        .filter(|end| *end <= parent_end)
        .ok_or_else(|| "MP4 atom exceeds its parent".to_string())?;
    Ok(Some(Mp4Atom {
        kind,
        content_start: start + header_len,
        end,
    }))
}

fn mp4_text(data_type: u32, bytes: &[u8]) -> Option<String> {
    match data_type {
        1 => std::str::from_utf8(bytes).ok().map(ToString::to_string),
        2 if bytes.len().is_multiple_of(2) => {
            let mut words = bytes
                .chunks_exact(2)
                .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
                .collect::<Vec<_>>();
            if words.first() == Some(&0xfeff) {
                words.remove(0);
            }
            String::from_utf16(&words).ok()
        }
        _ => None,
    }
}

fn apply_mp4_value(
    metadata: &mut RawAudioMetadata,
    key: [u8; 4],
    data_type: u32,
    value: &[u8],
) -> Result<(), String> {
    let text = || mp4_text(data_type, value).map(|value| value.trim().to_string());
    match &key {
        b"\xa9nam" if metadata.title.is_none() => metadata.title = text(),
        b"\xa9alb" if metadata.album.is_none() => metadata.album = text(),
        b"\xa9ART" => metadata
            .track_artists
            .extend(text().filter(|value| !value.is_empty())),
        b"aART" => metadata
            .album_artists
            .extend(text().filter(|value| !value.is_empty())),
        b"\xa9gen" => {
            if let Some(value) = text().filter(|value| !value.is_empty()) {
                if !metadata.genre.is_empty() {
                    metadata.genre.push(';');
                }
                metadata.genre.push_str(&value);
            }
        }
        b"\xa9day" if metadata.release_date.is_none() => metadata.release_date = text(),
        b"trkn" if value.len() >= 4 => {
            metadata.track_number = u16::from_be_bytes([value[2], value[3]]);
        }
        b"disk" if value.len() >= 4 => {
            metadata.disc_number = u16::from_be_bytes([value[2], value[3]]);
        }
        b"gnre" if value.len() >= 2 => {
            let index = usize::from(value[1]);
            if let Some(genre) = index
                .checked_sub(1)
                .and_then(|index| lofty::id3::v1::GENRES.get(index))
            {
                metadata.genre = (*genre).to_string();
            }
        }
        _ => {}
    }
    Ok(())
}

fn parse_mp4_ilst<R: Read + Seek>(
    reader: &mut R,
    start: u64,
    end: u64,
    metadata: &mut RawAudioMetadata,
) -> Result<(), String> {
    const MAX_VALUE_BYTES: u64 = 1024 * 1024;
    reader
        .seek(SeekFrom::Start(start))
        .map_err(|error| error.to_string())?;
    while let Some(item) = read_mp4_atom(reader, end)? {
        reader
            .seek(SeekFrom::Start(item.content_start))
            .map_err(|error| error.to_string())?;
        while let Some(data) = read_mp4_atom(reader, item.end)? {
            if data.kind == *b"data" && data.end.saturating_sub(data.content_start) >= 8 {
                let mut header = [0_u8; 8];
                reader
                    .read_exact(&mut header)
                    .map_err(|error| error.to_string())?;
                let data_type = u32::from_be_bytes(header[..4].try_into().expect("MP4 data type"))
                    & 0x00ff_ffff;
                let value_len = data.end.saturating_sub(data.content_start + 8);
                if item.kind == *b"covr" {
                    metadata
                        .embedded_artwork
                        .get_or_insert(EmbeddedArtworkRegion {
                            offset: data.content_start + 8,
                            length: value_len,
                        });
                } else if value_len <= MAX_VALUE_BYTES {
                    let mut value = vec![0_u8; value_len as usize];
                    reader
                        .read_exact(&mut value)
                        .map_err(|error| error.to_string())?;
                    apply_mp4_value(metadata, item.kind, data_type, &value)?;
                }
            }
            reader
                .seek(SeekFrom::Start(data.end))
                .map_err(|error| error.to_string())?;
        }
        reader
            .seek(SeekFrom::Start(item.end))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn parse_mp4_duration<R: Read + Seek>(
    reader: &mut R,
    atom: Mp4Atom,
) -> Result<Option<f64>, String> {
    reader
        .seek(SeekFrom::Start(atom.content_start))
        .map_err(|error| error.to_string())?;
    let mut version_flags = [0_u8; 4];
    reader
        .read_exact(&mut version_flags)
        .map_err(|error| error.to_string())?;
    let (skip, duration_bytes) = if version_flags[0] == 1 {
        (16_u64, 8_usize)
    } else {
        (8_u64, 4_usize)
    };
    seek_forward(reader, skip)?;
    let mut timescale = [0_u8; 4];
    reader
        .read_exact(&mut timescale)
        .map_err(|error| error.to_string())?;
    let timescale = u32::from_be_bytes(timescale);
    let mut duration = [0_u8; 8];
    reader
        .read_exact(&mut duration[..duration_bytes])
        .map_err(|error| error.to_string())?;
    let duration = if duration_bytes == 8 {
        u64::from_be_bytes(duration)
    } else {
        u64::from(u32::from_be_bytes(
            duration[..4].try_into().expect("MP4 duration"),
        ))
    };
    Ok((timescale > 0 && duration > 0).then(|| duration as f64 / timescale as f64))
}

fn parse_mp4_meta<R: Read + Seek>(
    reader: &mut R,
    atom: Mp4Atom,
    metadata: &mut RawAudioMetadata,
) -> Result<bool, String> {
    // `meta` is normally a FullBox.
    for child_start in [atom.content_start + 4, atom.content_start] {
        if child_start > atom.end {
            continue;
        }
        reader
            .seek(SeekFrom::Start(child_start))
            .map_err(|error| error.to_string())?;
        while let Ok(Some(child)) = read_mp4_atom(reader, atom.end) {
            if child.kind == *b"ilst" {
                parse_mp4_ilst(reader, child.content_start, child.end, metadata)?;
                return Ok(true);
            }
            reader
                .seek(SeekFrom::Start(child.end))
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(false)
}

fn parse_mp4_audio_track_duration<R: Read + Seek>(
    reader: &mut R,
    track: Mp4Atom,
) -> Result<Option<f64>, String> {
    reader
        .seek(SeekFrom::Start(track.content_start))
        .map_err(|error| error.to_string())?;
    while let Some(child) = read_mp4_atom(reader, track.end)? {
        if child.kind != *b"mdia" {
            reader
                .seek(SeekFrom::Start(child.end))
                .map_err(|error| error.to_string())?;
            continue;
        }
        let mut mdhd = None;
        let mut is_audio = false;
        reader
            .seek(SeekFrom::Start(child.content_start))
            .map_err(|error| error.to_string())?;
        while let Some(media_child) = read_mp4_atom(reader, child.end)? {
            match &media_child.kind {
                b"mdhd" => mdhd = Some(media_child),
                b"hdlr" if media_child.end.saturating_sub(media_child.content_start) >= 12 => {
                    reader
                        .seek(SeekFrom::Start(media_child.content_start + 8))
                        .map_err(|error| error.to_string())?;
                    let mut handler = [0_u8; 4];
                    reader
                        .read_exact(&mut handler)
                        .map_err(|error| error.to_string())?;
                    is_audio = &handler == b"soun";
                }
                _ => {}
            }
            reader
                .seek(SeekFrom::Start(media_child.end))
                .map_err(|error| error.to_string())?;
        }
        if is_audio && let Some(mdhd) = mdhd {
            return parse_mp4_duration(reader, mdhd);
        }
        reader
            .seek(SeekFrom::Start(child.end))
            .map_err(|error| error.to_string())?;
    }
    Ok(None)
}

fn parse_mp4_children<R: Read + Seek>(
    reader: &mut R,
    start: u64,
    end: u64,
    metadata: &mut RawAudioMetadata,
    duration: &mut Option<f64>,
) -> Result<bool, String> {
    reader
        .seek(SeekFrom::Start(start))
        .map_err(|error| error.to_string())?;
    let mut found_ilst = false;
    while let Some(atom) = read_mp4_atom(reader, end)? {
        match &atom.kind {
            b"mvhd" => *duration = parse_mp4_duration(reader, atom)?,
            b"trak" => {
                if let Some(audio_duration) = parse_mp4_audio_track_duration(reader, atom)? {
                    *duration = Some(audio_duration);
                }
            }
            b"udta" => {
                reader
                    .seek(SeekFrom::Start(atom.content_start))
                    .map_err(|error| error.to_string())?;
                while let Some(child) = read_mp4_atom(reader, atom.end)? {
                    if child.kind == *b"meta" {
                        found_ilst |= parse_mp4_meta(reader, child, metadata)?;
                    }
                    reader
                        .seek(SeekFrom::Start(child.end))
                        .map_err(|error| error.to_string())?;
                }
            }
            b"meta" => found_ilst |= parse_mp4_meta(reader, atom, metadata)?,
            _ => {}
        }
        reader
            .seek(SeekFrom::Start(atom.end))
            .map_err(|error| error.to_string())?;
    }
    Ok(found_ilst)
}

/// Reads MP4 catalog metadata without reading media or cover payloads.
fn parse_mp4_fast<R: Read + Seek>(
    reader: &mut R,
    file_length: u64,
) -> Result<RawAudioMetadata, String> {
    let started = Instant::now();
    let mut metadata = RawAudioMetadata {
        parse_strategy: ParserStrategy::Mp4Fast,
        ..RawAudioMetadata::default()
    };
    let mut saw_ftyp = false;
    let mut saw_moov = false;
    let mut duration = None;
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    while let Some(atom) = read_mp4_atom(reader, file_length)? {
        match &atom.kind {
            b"ftyp" => saw_ftyp = true,
            b"moov" => {
                saw_moov = true;
                let _ = parse_mp4_children(
                    reader,
                    atom.content_start,
                    atom.end,
                    &mut metadata,
                    &mut duration,
                )?;
            }
            _ => {}
        }
        reader
            .seek(SeekFrom::Start(atom.end))
            .map_err(|error| error.to_string())?;
    }
    if !saw_ftyp || !saw_moov {
        return Err("required MP4 atoms not found".to_string());
    }
    metadata.duration_seconds = duration.unwrap_or_default();
    metadata.duration_source = Some(if metadata.duration_seconds > 0.0 {
        DurationSource::Exact
    } else {
        DurationSource::Unavailable
    });
    metadata.tag_parse_us = elapsed_us(started.elapsed());
    Ok(metadata)
}

fn parse_with_lofty<R: Read + Seek>(reader: R) -> Result<RawAudioMetadata, String> {
    let tag_started = Instant::now();
    let probe = Probe::new(reader)
        // Defer embedded pictures to one representative per album.
        .options(
            ParseOptions::new()
                .read_properties(true)
                .read_cover_art(false),
        )
        .guess_file_type()
        .map_err(|error| error.to_string())?;
    let tagged_file = probe.read().map_err(|error| error.to_string())?;
    let mut metadata = RawAudioMetadata {
        parse_strategy: ParserStrategy::Lofty,
        ..RawAudioMetadata::default()
    };
    if let Some(tag) = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())
    {
        populate_tag_metadata(&mut metadata, tag);
    }
    metadata.tag_parse_us = elapsed_us(tag_started.elapsed());
    let duration_started = Instant::now();
    metadata.duration_seconds = tagged_file.properties().duration().as_secs_f64();
    metadata.duration_us = elapsed_us(duration_started.elapsed());
    metadata.duration_source = Some(if metadata.duration_seconds > 0.0 {
        DurationSource::Exact
    } else {
        DurationSource::Unavailable
    });
    Ok(metadata)
}

fn parse_with_lofty_from_start<R: Read + Seek>(mut reader: R) -> Result<RawAudioMetadata, String> {
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    parse_with_lofty(reader)
}

fn parse_with_lofty_fallback<R: Read + Seek>(
    reader: R,
    strategy: ParserStrategy,
) -> Result<RawAudioMetadata, String> {
    parse_with_lofty_from_start(reader).map(|mut metadata| {
        metadata.parse_strategy = strategy;
        metadata
    })
}

fn parse_audio_reader<R: Read + Seek>(
    file: &DiscoveredFile,
    reader: &mut R,
) -> (Result<RawAudioMetadata, String>, u64, Option<String>) {
    let mut parser_fallbacks = 0;
    let mut fast_path_error = None;
    let parsed = match file.format {
        AudioFormat::Mp3 => parse_mp3(reader, file.size_bytes.max(0) as u64),
        AudioFormat::Flac => match parse_flac_fast(reader) {
            Ok(metadata) => Ok(metadata),
            Err(error) => {
                parser_fallbacks += 1;
                fast_path_error = Some(error);
                parse_with_lofty_fallback(reader, ParserStrategy::LoftyFlacFallback)
            }
        },
        AudioFormat::M4a | AudioFormat::Alac => {
            match parse_mp4_fast(reader, file.size_bytes.max(0) as u64) {
                Ok(metadata) => Ok(metadata),
                Err(error) => {
                    parser_fallbacks += 1;
                    fast_path_error = Some(error);
                    parse_with_lofty_fallback(reader, ParserStrategy::LoftyMp4Fallback)
                }
            }
        }
        AudioFormat::Ogg | AudioFormat::Opus => {
            parse_ogg_fast(reader, file.size_bytes.max(0) as u64)
        }
        AudioFormat::Wav => parse_wav_fast(reader, file.size_bytes.max(0) as u64),
        AudioFormat::Aiff => parse_aiff_fast(reader, file.size_bytes.max(0) as u64),
        _ => parse_with_lofty(reader),
    };
    (parsed, parser_fallbacks, fast_path_error)
}

fn parse_audio_file(file: &DiscoveredFile, local_cover: &str) -> ParsedFile {
    let path = &file.native_path;
    let mut file_opens = 0;
    let mut reader = match File::open(path) {
        Ok(file) => {
            file_opens = 1;
            // Keep buffers small for parsers that seek past media payloads.
            Some(BufReader::with_capacity(
                4 * 1024,
                MeasuredReader::new(file),
            ))
        }
        Err(error) => {
            let parsed = Err(error.to_string());
            return parsed_file_from_result(
                file,
                local_cover,
                parsed,
                ParseIoTelemetry {
                    file_opens,
                    ..ParseIoTelemetry::default()
                },
            );
        }
    };
    let measured = reader.as_mut().expect("reader initialized above");
    let (parsed, parser_fallbacks, fast_path_error) = parse_audio_reader(file, measured);
    let bytes_read = measured.get_ref().bytes_read;
    let read_calls = measured.get_ref().read_calls;
    let seeks = measured.get_ref().seeks;
    parsed_file_from_result(
        file,
        local_cover,
        parsed,
        ParseIoTelemetry {
            bytes_read,
            read_calls,
            seeks,
            file_opens,
            parser_fallbacks,
            fast_path_error,
        },
    )
}

fn parse_audio_file_prefetched(
    file: &DiscoveredFile,
    local_cover: &str,
    prefetched: PrefetchedRegions,
) -> ParsedFile {
    let bytes_read = prefetched.bytes_read;
    let storage_read_calls = prefetched.read_calls;
    let mut reader = BufReader::with_capacity(4 * 1024, SparseRegionReader::new(prefetched));
    let (parsed, parser_fallbacks, fast_path_error) = parse_audio_reader(file, &mut reader);
    if parsed.is_err() {
        let mut fallback = parse_audio_file(file, local_cover);
        fallback.bytes_read = fallback.bytes_read.saturating_add(bytes_read);
        fallback.read_calls = fallback.read_calls.saturating_add(storage_read_calls);
        fallback.file_opens = fallback.file_opens.saturating_add(1);
        fallback.parser_fallbacks = fallback.parser_fallbacks.saturating_add(1);
        return fallback;
    }
    let logical_read_calls = reader.get_ref().read_calls;
    let seeks = reader.get_ref().seeks;
    parsed_file_from_result(
        file,
        local_cover,
        parsed,
        ParseIoTelemetry {
            bytes_read,
            read_calls: storage_read_calls.saturating_add(logical_read_calls),
            seeks,
            file_opens: 1,
            parser_fallbacks,
            fast_path_error,
        },
    )
}

#[derive(Default)]
struct ParseIoTelemetry {
    bytes_read: u64,
    read_calls: u64,
    seeks: u64,
    file_opens: u64,
    parser_fallbacks: u64,
    fast_path_error: Option<String>,
}

fn parsed_file_from_result(
    file: &DiscoveredFile,
    local_cover: &str,
    parsed: Result<RawAudioMetadata, String>,
    telemetry: ParseIoTelemetry,
) -> ParsedFile {
    let ParseIoTelemetry {
        bytes_read,
        read_calls,
        seeks,
        file_opens,
        parser_fallbacks,
        fast_path_error,
    } = telemetry;
    let path = &file.native_path;
    let (metadata, error) = match parsed {
        Ok(metadata) => (metadata, None),
        Err(error) => (RawAudioMetadata::default(), Some(error)),
    };

    let title = metadata.title.unwrap_or_else(|| fallback_title(path));
    let album = metadata.album.unwrap_or_else(|| fallback_album(path));
    let track_artists = metadata.track_artists;
    let album_artists = metadata.album_artists;
    // Retain decoded tags to avoid a second media read.
    let genres = split_genres(&metadata.genre);
    let release_date = metadata
        .release_date
        .as_deref()
        .and_then(normalized_release_date)
        .unwrap_or_default();
    ParsedFile {
        path: file.path.clone(),
        title,
        album,
        track_artists,
        album_artists,
        genres,
        release_date,
        track_number: metadata.track_number,
        disc_number: metadata.disc_number,
        duration_seconds: metadata.duration_seconds,
        duration_source: metadata
            .duration_source
            .unwrap_or(DurationSource::Unavailable),
        cover_url: local_cover.to_owned(),
        musicbrainz_recording_id: String::new(),
        musicbrainz_release_id: String::new(),
        musicbrainz_artist_id: String::new(),
        musicbrainz_album_artist_id: String::new(),
        error,
        embedded_artwork: metadata.embedded_artwork,
        tag_parse_us: metadata.tag_parse_us,
        duration_us: metadata.duration_us,
        parse_strategy: metadata.parse_strategy,
        bytes_read,
        read_calls,
        seeks,
        file_opens,
        parser_fallbacks,
        fast_path_error,
    }
}

fn split_genres(value: &str) -> Vec<String> {
    let mut genres = value
        .split([';', ',', '/'])
        .map(str::trim)
        .filter(|genre| !genre.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    genres.sort_by_key(|genre| genre.to_lowercase());
    genres.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    genres
}

fn normalize_genre_key(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .flat_map(|character| {
            if character == '&' {
                Some('n')
            } else if character.is_alphanumeric() {
                Some(character)
            } else {
                None
            }
        })
        .collect()
}

fn snapshot_to_parsed(snapshot: &ExistingFileSnapshot) -> ParsedFile {
    ParsedFile {
        path: Arc::from(snapshot.path.as_str()),
        title: snapshot
            .title
            .clone()
            .unwrap_or_else(|| fallback_title(Path::new(&snapshot.path))),
        album: snapshot
            .album
            .clone()
            .unwrap_or_else(|| fallback_album(Path::new(&snapshot.path))),
        track_artists: serde_json::from_str(&snapshot.track_artists_json).unwrap_or_default(),
        album_artists: serde_json::from_str(&snapshot.album_artists_json).unwrap_or_default(),
        genres: serde_json::from_str(&snapshot.genres_json).unwrap_or_default(),
        release_date: snapshot.release_date.clone().unwrap_or_default(),
        track_number: snapshot.track_number.unwrap_or_default() as u16,
        disc_number: snapshot.disc_number.unwrap_or_default() as u16,
        duration_seconds: snapshot.duration_seconds,
        duration_source: DurationSource::from_str(&snapshot.duration_source),
        cover_url: snapshot.cover_url.clone().unwrap_or_default(),
        musicbrainz_recording_id: snapshot
            .musicbrainz_recording_id
            .clone()
            .unwrap_or_default(),
        musicbrainz_release_id: snapshot.musicbrainz_release_id.clone().unwrap_or_default(),
        musicbrainz_artist_id: snapshot.musicbrainz_artist_id.clone().unwrap_or_default(),
        musicbrainz_album_artist_id: snapshot
            .musicbrainz_album_artist_id
            .clone()
            .unwrap_or_default(),
        error: snapshot.error.clone(),
        embedded_artwork: snapshot
            .embedded_artwork_offset
            .zip(snapshot.embedded_artwork_length)
            .and_then(|(offset, length)| {
                Some(EmbeddedArtworkRegion {
                    offset: u64::try_from(offset).ok()?,
                    length: u64::try_from(length).ok()?,
                })
            }),
        tag_parse_us: 0,
        duration_us: 0,
        parse_strategy: ParserStrategy::Reused,
        bytes_read: 0,
        read_calls: 0,
        seeks: 0,
        file_opens: 0,
        parser_fallbacks: 0,
        fast_path_error: None,
    }
}

fn primary_track_artist(parsed: &ParsedFile) -> String {
    if parsed.track_artists.is_empty() {
        "Unknown Artist".to_string()
    } else {
        format_contributing_artists(&parsed.track_artists)
            .first()
            .map(|artist| artist.0.clone())
            .unwrap_or_else(|| "Unknown Artist".to_string())
    }
}

fn primary_album_artist(parsed: &ParsedFile) -> String {
    if parsed.album_artists.is_empty() {
        primary_track_artist(parsed)
    } else {
        format_contributing_artists(&parsed.album_artists)
            .first()
            .map(|artist| artist.0.clone())
            .unwrap_or_else(|| primary_track_artist(parsed))
    }
}

#[derive(Default)]
struct ArtistIdentityEvidence {
    display_name: String,
    file_count: usize,
    releases: HashSet<AlbumGroupingKey>,
    track_titles: HashSet<String>,
}

/// Finds high-confidence spelling aliases between artists.
fn artist_alias_partition(identity: &str) -> (char, usize) {
    let mut characters = identity
        .chars()
        .filter(|character| !character.is_whitespace());
    let prefix = characters.next().unwrap_or('\0');
    (prefix, characters.count() + usize::from(prefix != '\0'))
}

fn infer_artist_aliases_for(
    prepared_tracks: &[PreparedTrackSeed<'_>],
    retained_aliases: &HashMap<String, String>,
    changed_identities: &HashSet<String>,
) -> (HashMap<String, String>, usize) {
    let mut evidence =
        HashMap::<String, ArtistIdentityEvidence>::with_capacity(prepared_tracks.len());
    for prepared in prepared_tracks {
        let display_name = prepared.primary_track_artist.as_ref();
        let identity = prepared.normalized_primary_track_artist.as_ref();
        if identity.is_empty() || identity == "unknown artist" {
            continue;
        }
        let entry = evidence.entry(identity.to_string()).or_default();
        if entry.display_name.is_empty() {
            entry.display_name = display_name.to_string();
        }
        entry.file_count += 1;
        entry.releases.insert(prepared.album_grouping_key.clone());
        entry
            .track_titles
            .insert(prepared.normalized_title.to_string());
    }

    // Partition candidates so no artist scans the full artist set.
    let mut artists_by_title = HashMap::<&str, Vec<&str>>::with_capacity(prepared_tracks.len());
    for (identity, artist) in &evidence {
        for title in &artist.track_titles {
            artists_by_title.entry(title).or_default().push(identity);
        }
    }
    let mut aliases = retained_aliases
        .iter()
        .filter(|(identity, _)| evidence.contains_key(identity.as_str()))
        .map(|(identity, canonical)| (identity.clone(), canonical.clone()))
        .collect::<HashMap<_, _>>();
    let mut comparisons = 0;
    for suspect_identity in changed_identities {
        aliases.remove(suspect_identity);
        let Some(suspect) = evidence.get(suspect_identity) else {
            continue;
        };
        let (prefix, length) = artist_alias_partition(suspect_identity);
        let mut shared_titles = HashMap::<&str, usize>::with_capacity(suspect.track_titles.len());
        for title in &suspect.track_titles {
            for candidate in artists_by_title.get(title.as_str()).into_iter().flatten() {
                if *candidate == suspect_identity {
                    continue;
                }
                let candidate_partition = artist_alias_partition(candidate);
                if candidate_partition.0 == prefix && candidate_partition.1.abs_diff(length) <= 1 {
                    *shared_titles.entry(candidate).or_default() += 1;
                }
            }
        }
        let mut matches = shared_titles
            .into_iter()
            .filter(|(_, count)| *count >= 2)
            .filter_map(|(canonical_identity, _)| {
                comparisons += 1;
                let canonical = &evidence[canonical_identity];
                (canonical.file_count >= 10
                    && canonical.file_count >= suspect.file_count.saturating_mul(3)
                    && canonical.releases.len() >= 3
                    && artist_identity_is_one_edit_apart(suspect_identity, canonical_identity))
                .then(|| canonical.display_name.clone())
            });
        if let Some(canonical) = matches.next()
            && matches.next().is_none()
        {
            aliases.insert(suspect_identity.clone(), canonical);
        }
    }
    (aliases, comparisons)
}

#[cfg(test)]
fn infer_artist_aliases(prepared_tracks: &[PreparedTrackSeed<'_>]) -> HashMap<String, String> {
    let changed_identities = prepared_tracks
        .iter()
        .map(|track| track.normalized_primary_track_artist.to_string())
        .collect::<HashSet<_>>();
    infer_artist_aliases_for(prepared_tracks, &HashMap::new(), &changed_identities).0
}

fn load_artist_alias_decisions(
    conn: &mut SqliteConnection,
) -> QueryResult<HashMap<String, String>> {
    Ok(
        diesel::sql_query("SELECT normalized_alias, canonical_name FROM artist_alias_decision")
            .load::<ArtistAliasDecisionRow>(conn)?
            .into_iter()
            .map(|row| (row.normalized_alias, row.canonical_name))
            .collect(),
    )
}

fn persist_artist_alias_decisions(
    conn: &mut SqliteConnection,
    aliases: &HashMap<String, String>,
) -> QueryResult<()> {
    for obsolete in
        diesel::sql_query("SELECT normalized_alias, canonical_name FROM artist_alias_decision")
            .load::<ArtistAliasDecisionRow>(conn)?
            .into_iter()
            .filter(|row| !aliases.contains_key(&row.normalized_alias))
    {
        diesel::sql_query("DELETE FROM artist_alias_decision WHERE normalized_alias = ?")
            .bind::<Text, _>(obsolete.normalized_alias)
            .execute(conn)?;
    }
    for (normalized_alias, canonical_name) in aliases {
        diesel::sql_query(
            "INSERT INTO artist_alias_decision
                (normalized_alias, alias_name, canonical_name, canonical_normalized, updated_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(normalized_alias) DO UPDATE SET
                alias_name = excluded.alias_name,
                canonical_name = excluded.canonical_name,
                canonical_normalized = excluded.canonical_normalized,
                updated_at = CURRENT_TIMESTAMP",
        )
        .bind::<Text, _>(normalized_alias)
        .bind::<Text, _>(normalized_alias)
        .bind::<Text, _>(canonical_name)
        .bind::<Text, _>(normalize_artist_identity(canonical_name))
        .execute(conn)?;
    }
    Ok(())
}

fn load_album_inference_cache(
    conn: &mut SqliteConnection,
) -> QueryResult<HashMap<String, (OwnedReleaseEvidence, ReleasePresentation)>> {
    Ok(diesel::sql_query(
        "SELECT album_id, evidence_json, presentation_json FROM album_inference_cache",
    )
    .load::<AlbumInferenceCacheRow>(conn)?
    .into_iter()
    .filter_map(|row| {
        Some((
            row.album_id,
            (
                serde_json::from_str(&row.evidence_json).ok()?,
                serde_json::from_str(&row.presentation_json).ok()?,
            ),
        ))
    })
    .collect())
}

fn persist_album_inference_cache(
    conn: &mut SqliteConnection,
    album_ids: &HashSet<String>,
    evidence: &HashMap<String, OwnedReleaseEvidence>,
    presentations: &HashMap<String, ReleasePresentation>,
) -> QueryResult<()> {
    for album_id in album_ids {
        let (Some(album_evidence), Some(presentation)) =
            (evidence.get(album_id), presentations.get(album_id))
        else {
            diesel::sql_query("DELETE FROM album_inference_cache WHERE album_id = ?")
                .bind::<Text, _>(album_id)
                .execute(conn)?;
            continue;
        };
        diesel::sql_query(
            "INSERT INTO album_inference_cache
                (album_id, evidence_json, presentation_json, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(album_id) DO UPDATE SET
                evidence_json = excluded.evidence_json,
                presentation_json = excluded.presentation_json,
                updated_at = CURRENT_TIMESTAMP",
        )
        .bind::<Text, _>(album_id)
        .bind::<Text, _>(serde_json::to_string(album_evidence).unwrap_or_default())
        .bind::<Text, _>(serde_json::to_string(presentation).unwrap_or_default())
        .execute(conn)?;
    }
    Ok(())
}

fn artist_identity_is_one_edit_apart(left: &str, right: &str) -> bool {
    let left = left.split_whitespace().collect::<Vec<_>>();
    let right = right.split_whitespace().collect::<Vec<_>>();
    if left.len() != right.len() || left.is_empty() {
        return false;
    }
    let left = left.concat().chars().collect::<Vec<_>>();
    let right = right.concat().chars().collect::<Vec<_>>();
    if left.len().abs_diff(right.len()) > 1 || left.len().min(right.len()) < 5 {
        return false;
    }
    if left.len() == right.len() {
        let differences = left
            .iter()
            .zip(&right)
            .enumerate()
            .filter_map(|(index, (left, right))| (left != right).then_some(index))
            .collect::<Vec<_>>();
        return differences.len() == 1
            || (differences.len() == 2
                && differences[1] == differences[0] + 1
                && left[differences[0]] == right[differences[1]]
                && left[differences[1]] == right[differences[0]]);
    }

    let (shorter, longer) = if left.len() < right.len() {
        (&left, &right)
    } else {
        (&right, &left)
    };
    let mut short_index = 0;
    let mut long_index = 0;
    let mut skipped = false;
    while short_index < shorter.len() && long_index < longer.len() {
        if shorter[short_index] == longer[long_index] {
            short_index += 1;
            long_index += 1;
        } else if skipped {
            return false;
        } else {
            skipped = true;
            long_index += 1;
        }
    }
    true
}

fn release_directory(path: &str) -> String {
    let path = Path::new(path);
    let mut directory = path.parent().unwrap_or_else(|| Path::new(""));
    let directory_name = directory
        .file_name()
        .and_then(|name| name.to_str())
        .map(normalize_song_identity)
        .unwrap_or_default();
    let first_word = directory_name.split_whitespace().next().unwrap_or_default();
    let numbered_disc = ["cd", "disc", "disk"].iter().any(|prefix| {
        first_word
            .strip_prefix(prefix)
            .is_some_and(|suffix| !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()))
    });
    if matches!(first_word, "cd" | "disc" | "disk") || numbered_disc {
        directory = directory.parent().unwrap_or(directory);
    }

    normalize_path(directory)
}

fn prepare_track_seeds<'a>(
    parsed_files: &'a [ParsedFile],
    interner: &mut StringInterner,
) -> Vec<PreparedTrackSeed<'a>> {
    struct RawTrackSeed<'a> {
        parsed: &'a ParsedFile,
        normalized_title: String,
        normalized_album: String,
        release_directory: String,
        release_year: Option<String>,
        primary_track_artist: String,
        normalized_primary_track_artist: String,
        primary_album_artist: String,
        normalized_primary_album_artist: String,
        genres: Vec<(String, String)>,
    }

    // Preserve input order through parallel normalization.
    let raw = parsed_files
        .par_iter()
        .map(|parsed| {
            let release_directory = release_directory(&parsed.path);
            let primary_track_artist = primary_track_artist(parsed);
            let primary_album_artist = primary_album_artist(parsed);
            RawTrackSeed {
                parsed,
                normalized_title: normalize_song_identity(&parsed.title),
                normalized_album: normalize_album_identity(&parsed.album),
                release_year: release_directory_year(&release_directory),
                release_directory,
                normalized_primary_track_artist: normalize_artist_identity(&primary_track_artist),
                primary_track_artist,
                normalized_primary_album_artist: normalize_artist_identity(&primary_album_artist),
                primary_album_artist,
                genres: parsed
                    .genres
                    .iter()
                    .filter_map(|genre| {
                        let normalized = normalize_genre_key(genre);
                        (!normalized.is_empty()).then(|| (genre.trim().to_owned(), normalized))
                    })
                    .collect(),
            }
        })
        .collect::<Vec<_>>();

    let mut prepared = Vec::with_capacity(parsed_files.len());
    for raw in raw {
        let normalized_title = interner.intern(raw.normalized_title);
        let normalized_album = interner.intern(raw.normalized_album);
        let release_directory = interner.intern(raw.release_directory);
        let release_year = raw.release_year.map(|year| interner.intern(year));
        let primary_track_artist = interner.intern(raw.primary_track_artist);
        let normalized_primary_track_artist = interner.intern(raw.normalized_primary_track_artist);
        let primary_album_artist = interner.intern(raw.primary_album_artist);
        let normalized_primary_album_artist = interner.intern(raw.normalized_primary_album_artist);
        let genres = raw
            .genres
            .into_iter()
            .map(|(name, normalized_name)| PreparedGenre {
                name: interner.intern(name),
                normalized_name: interner.intern(normalized_name),
            })
            .collect();
        let album_grouping_key = AlbumGroupingKey {
            normalized_album: Arc::clone(&normalized_album),
            release_directory: Arc::clone(&release_directory),
        };
        prepared.push(PreparedTrackSeed {
            parsed: raw.parsed,
            normalized_title,
            normalized_album,
            release_year,
            album_grouping_key,
            primary_track_artist,
            normalized_primary_track_artist,
            primary_album_artist,
            normalized_primary_album_artist,
            genres,
        });
    }
    prepared
}

fn infer_album_artists(
    prepared_tracks: &[PreparedTrackSeed<'_>],
    aliases: &HashMap<String, String>,
) -> HashMap<AlbumGroupingKey, String> {
    let capacity = prepared_tracks.len();
    let mut explicit = HashMap::<AlbumGroupingKey, HashMap<String, usize>>::with_capacity(capacity);
    let mut track_artists =
        HashMap::<AlbumGroupingKey, HashMap<String, usize>>::with_capacity(capacity);
    let mut track_artist_releases =
        HashMap::<String, HashSet<AlbumGroupingKey>>::with_capacity(capacity);

    for prepared in prepared_tracks {
        let key = prepared.album_grouping_key.clone();
        let track_artist = aliases
            .get(prepared.normalized_primary_track_artist.as_ref())
            .cloned()
            .unwrap_or_else(|| prepared.primary_track_artist.to_string());
        *track_artists
            .entry(key.clone())
            .or_default()
            .entry(track_artist.clone())
            .or_default() += 1;
        track_artist_releases
            .entry(track_artist)
            .or_default()
            .insert(key.clone());
        if !prepared.parsed.album_artists.is_empty() {
            *explicit
                .entry(key)
                .or_default()
                .entry(
                    aliases
                        .get(prepared.normalized_primary_album_artist.as_ref())
                        .cloned()
                        .unwrap_or_else(|| prepared.primary_album_artist.to_string()),
                )
                .or_default() += 1;
        }
    }

    explicit
        .keys()
        .chain(track_artists.keys())
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .map(|key| {
            let explicit_artist = explicit.get(&key).and_then(|artists| {
                let total = artists.values().sum::<usize>();
                artists
                    .iter()
                    .max_by(|(left_name, left_count), (right_name, right_count)| {
                        left_count
                            .cmp(right_count)
                            .then_with(|| right_name.cmp(left_name))
                    })
                    .filter(|(_, count)| **count * 2 >= total)
                    .map(|(name, _)| name.clone())
            });
            let dominant_track_artist = track_artists.get(&key).and_then(|artists| {
                let total = artists.values().sum::<usize>();
                artists
                    .iter()
                    .max_by(|(left_name, left_count), (right_name, right_count)| {
                        left_count
                            .cmp(right_count)
                            .then_with(|| right_name.cmp(left_name))
                    })
                    .filter(|(_, count)| artists.len() == 1 || **count * 2 > total)
                    .map(|(name, count)| (name.clone(), *count))
            });
            let artist = match (explicit_artist, dominant_track_artist) {
                (Some(explicit_artist), Some((track_artist, track_count)))
                    if track_count >= 2
                        && track_artist_releases
                            .get(&track_artist)
                            .is_some_and(|releases| releases.len() >= 2)
                        && slash_decorated_variant(&explicit_artist, &track_artist) =>
                {
                    track_artist
                }
                (Some(explicit_artist), _) => explicit_artist,
                (None, Some((track_artist, _))) => track_artist,
                (None, None) if track_artists.contains_key(&key) => "Various Artists".to_string(),
                (None, None) => "Unknown Artist".to_string(),
            };
            (key, artist)
        })
        .collect()
}

fn slash_decorated_variant(value: &str, artist: &str) -> bool {
    let mut parts = value.split(['/', '\\']);
    let Some(first) = parts.next() else {
        return false;
    };
    parts.next().is_some_and(|remainder| {
        !remainder.trim().is_empty()
            && normalize_artist_identity(first) == normalize_artist_identity(artist)
    })
}

fn prepare_tracks<'a>(
    seeds: Vec<PreparedTrackSeed<'a>>,
    aliases: &HashMap<String, String>,
    inferred_album_artists: &HashMap<AlbumGroupingKey, String>,
    interner: &mut StringInterner,
) -> Vec<PreparedTrack<'a>> {
    // Collapse byte-quality copies only when their complete release slots agree.
    // Different track lists remain distinct even when title and artist tags are
    // identical (for example, an album and a same-titled single).
    let mut slots_by_release = HashMap::<AlbumGroupingKey, Vec<String>>::new();
    let mut artist_by_release = HashMap::<AlbumGroupingKey, String>::new();
    for seed in &seeds {
        let resolved_artist = inferred_album_artists
            .get(&seed.album_grouping_key)
            .map(String::as_str)
            .unwrap_or(seed.primary_album_artist.as_ref());
        let resolved_artist = aliases
            .get(&normalize_artist_identity(resolved_artist))
            .map(String::as_str)
            .unwrap_or(resolved_artist);
        artist_by_release
            .entry(seed.album_grouping_key.clone())
            .or_insert_with(|| normalize_artist_identity(resolved_artist));
        slots_by_release
            .entry(seed.album_grouping_key.clone())
            .or_default()
            .push(format!(
                "{}\u{1f}{}\u{1f}{}\u{1f}{}",
                seed.parsed.disc_number,
                seed.parsed.track_number,
                recording_duplicate_identity(&seed.parsed.title),
                seed.parsed.duration_seconds.round() as i64,
            ));
    }
    for slots in slots_by_release.values_mut() {
        slots.sort_unstable();
    }
    let mut duplicate_groups = HashMap::<String, Vec<AlbumGroupingKey>>::new();
    for (key, slots) in &slots_by_release {
        duplicate_groups
            .entry(format!(
                "{}\u{1f}{}\u{1f}{}",
                key.normalized_album,
                artist_by_release.get(key).map(String::as_str).unwrap_or(""),
                slots.join("\u{1e}")
            ))
            .or_default()
            .push(key.clone());
    }
    let canonical_release_directory = duplicate_groups
        .into_values()
        .flat_map(|keys| {
            let canonical = keys
                .iter()
                .map(|key| key.release_directory.to_string())
                .min()
                .unwrap_or_default();
            keys.into_iter().map(move |key| (key, canonical.clone()))
        })
        .collect::<HashMap<_, _>>();

    let mut prepared = Vec::with_capacity(seeds.len());
    for seed in seeds {
        let resolved_track_artist = interner.intern(
            aliases
                .get(seed.normalized_primary_track_artist.as_ref())
                .map(String::as_str)
                .unwrap_or(seed.primary_track_artist.as_ref()),
        );
        let normalized_track_artist = if resolved_track_artist == seed.primary_track_artist {
            Arc::clone(&seed.normalized_primary_track_artist)
        } else {
            interner.intern(normalize_artist_identity(resolved_track_artist.as_ref()))
        };
        let resolved_album_artist = interner.intern(
            inferred_album_artists
                .get(&seed.album_grouping_key)
                .map(String::as_str)
                .unwrap_or(seed.primary_album_artist.as_ref()),
        );
        let normalized_album_artist = if resolved_album_artist == seed.primary_album_artist {
            Arc::clone(&seed.normalized_primary_album_artist)
        } else {
            interner.intern(normalize_artist_identity(resolved_album_artist.as_ref()))
        };
        let artist_id = interner.intern(hash_normalized_artist(&normalized_album_artist));
        let track_artist_id = if normalized_track_artist == normalized_album_artist {
            Arc::clone(&artist_id)
        } else {
            interner.intern(hash_normalized_artist(&normalized_track_artist))
        };
        // A title and artist identify a release group, not necessarily one
        // physical release. Keep distinct directories separate so an album and
        // a same-titled single/EP cannot be merged into a synthetic track list.
        let release_identity = format!(
            "{}\u{1f}{}",
            seed.normalized_album,
            canonical_release_directory
                .get(&seed.album_grouping_key)
                .map(String::as_str)
                .unwrap_or(seed.album_grouping_key.release_directory.as_ref())
        );
        let album_id = interner.intern(hash_normalized_album(
            &release_identity,
            &normalized_album_artist,
        ));
        let track_id = interner.intern(hash_normalized_song(
            &seed.normalized_title,
            &normalized_album_artist,
            &album_id,
            seed.parsed.track_number,
        ));
        let recording_id = Arc::clone(&track_id);
        let duplicate_identity = interner.intern(recording_duplicate_identity(&seed.parsed.title));
        prepared.push(PreparedTrack {
            parsed: seed.parsed,
            normalized_title: seed.normalized_title,
            normalized_album: seed.normalized_album,
            release_year: seed.release_year,
            album_grouping_key: seed.album_grouping_key,
            normalized_primary_track_artist: seed.normalized_primary_track_artist,
            resolved_track_artist,
            normalized_track_artist,
            resolved_album_artist,
            normalized_album_artist,
            artist_id,
            track_artist_id,
            album_id,
            track_id,
            recording_id,
            duplicate_identity,
            genres: seed.genres,
        });
    }
    prepared
}

fn value_override(
    overrides: &MetadataOverrides,
    entity_type: &str,
    entity_id: &str,
    field_name: &str,
    fallback: String,
) -> String {
    overrides
        .get(entity_type)
        .and_then(|entities| entities.get(entity_id))
        .and_then(|fields| fields.get(field_name))
        .and_then(|value| serde_json::from_str::<String>(value).ok())
        .unwrap_or(fallback)
}

fn typed_override<T: DeserializeOwned>(
    overrides: &MetadataOverrides,
    entity_type: &str,
    entity_id: &str,
    field_name: &str,
    fallback: T,
) -> T {
    overrides
        .get(entity_type)
        .and_then(|entities| entities.get(entity_id))
        .and_then(|fields| fields.get(field_name))
        .and_then(|value| serde_json::from_str::<T>(value).ok())
        .unwrap_or(fallback)
}

fn sql_escape(value: &str) -> String {
    value.replace('\'', "''")
}

fn serialize_stage<T: Serialize + ?Sized>(value: &T) -> QueryResult<String> {
    serde_json::to_string(value)
        .map_err(|error| diesel::result::Error::SerializationError(Box::new(error)))
}

fn cached_cover_is_reusable(
    row: &CoverCacheRow,
    inventory_signature: &str,
    reuse_cached_resolution: bool,
) -> bool {
    reuse_cached_resolution && row.inventory_signature == inventory_signature
}

fn resolve_local_covers(
    conn: &mut SqliteConnection,
    inventory: &FilesystemInventory,
    reuse_cached_resolution: bool,
) -> QueryResult<HashMap<PathBuf, CoverResolution>> {
    let cover_directory = get_cover_art_path();
    let managed_cover_directory = std::fs::create_dir_all(&cover_directory)
        .is_ok()
        .then_some(cover_directory);
    let cached = diesel::sql_query(
        "SELECT directory, inventory_signature, cover_path, content_hash
         FROM directory_cover_cache",
    )
    .load::<CoverCacheRow>(conn)?
    .into_iter()
    .map(|row| (row.directory.clone(), row))
    .collect::<HashMap<_, _>>();

    let directories = inventory
        .audio_files
        .iter()
        .map(|file| album_directory(&file.native_directory).to_path_buf())
        .collect::<HashSet<_>>();
    let resolved = directories
        .into_par_iter()
        .map(|directory| {
            let candidates = inventory_candidates(inventory, &directory);
            let signature = inventory_signature(&candidates);
            let database_directory = normalize_path(&directory);
            let cached_cover = cached
                .get(&database_directory)
                .filter(|row| cached_cover_is_reusable(row, &signature, reuse_cached_resolution));
            let cache_hit = cached_cover.is_some();
            let cover = cached_cover
                .map(|row| CoverResolution {
                    path: row.cover_path.clone(),
                    content_hash: row.content_hash.clone().unwrap_or_default(),
                    preferred: cover_candidate_score(Path::new(&row.cover_path), &directory)
                        .is_some_and(|(_, suitability)| suitability == CoverSuitability::Preferred),
                })
                .unwrap_or_else(|| {
                    resolve_inventory_cover_with_storage(
                        &candidates,
                        &directory,
                        managed_cover_directory.as_deref(),
                    )
                });
            (directory, database_directory, signature, cover, cache_hit)
        })
        .collect::<Vec<_>>();

    conn.transaction::<_, diesel::result::Error, _>(|conn| {
        for (_, database_directory, signature, cover, cache_hit) in &resolved {
            if *cache_hit {
                continue;
            }
            diesel::sql_query(format!(
                "INSERT INTO directory_cover_cache
                (directory, inventory_signature, cover_path, content_hash, updated_at)
             VALUES ('{}', '{}', '{}', NULLIF('{}', ''), CURRENT_TIMESTAMP)
             ON CONFLICT(directory) DO UPDATE SET
                inventory_signature = excluded.inventory_signature,
                cover_path = excluded.cover_path,
                content_hash = excluded.content_hash,
                updated_at = CURRENT_TIMESTAMP",
                sql_escape(database_directory),
                sql_escape(signature),
                sql_escape(&cover.path),
                sql_escape(&cover.content_hash),
            ))
            .execute(conn)?;
        }
        Ok(())
    })?;

    Ok(resolved
        .into_iter()
        .map(|(directory, _, _, cover, _)| (directory, cover))
        .collect())
}

fn album_key(parsed: &ParsedFile) -> String {
    let artists = if parsed.album_artists.is_empty() {
        &parsed.track_artists
    } else {
        &parsed.album_artists
    };
    let artist = if artists.is_empty() {
        "Unknown Artist".to_string()
    } else {
        format_contributing_artists(artists)
            .first()
            .map(|artist| artist.0.clone())
            .unwrap_or_else(|| "Unknown Artist".to_string())
    };
    hash_album(&parsed.album, &artist)
}

fn embedded_cover_with_lofty<R: Read + Seek>(reader: R) -> Option<Vec<u8>> {
    let tagged_file = Probe::new(reader)
        .options(
            ParseOptions::new()
                .read_properties(false)
                .read_cover_art(true),
        )
        .guess_file_type()
        .ok()?
        .read()
        .ok()?;
    tagged_file
        .tags()
        .iter()
        .flat_map(|tag| tag.pictures())
        .max_by_key(|picture| {
            let role = match picture.pic_type() {
                lofty::picture::PictureType::CoverFront => 3,
                lofty::picture::PictureType::Other => 2,
                lofty::picture::PictureType::CoverBack => 0,
                _ => 1,
            };
            (role, picture.data().len())
        })
        .map(|picture| picture.data().to_vec())
}

fn find_mp4_ilst_in_meta<R: Read + Seek>(
    reader: &mut R,
    meta: Mp4Atom,
) -> Result<Option<Mp4Atom>, String> {
    for start in [meta.content_start + 4, meta.content_start] {
        if start > meta.end {
            continue;
        }
        reader
            .seek(SeekFrom::Start(start))
            .map_err(|error| error.to_string())?;
        loop {
            match read_mp4_atom(reader, meta.end) {
                Ok(Some(child)) => {
                    if child.kind == *b"ilst" {
                        return Ok(Some(child));
                    }
                    reader
                        .seek(SeekFrom::Start(child.end))
                        .map_err(|error| error.to_string())?;
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    }
    Ok(None)
}

fn find_mp4_ilst<R: Read + Seek>(
    reader: &mut R,
    start: u64,
    end: u64,
) -> Result<Option<Mp4Atom>, String> {
    reader
        .seek(SeekFrom::Start(start))
        .map_err(|error| error.to_string())?;
    while let Some(atom) = read_mp4_atom(reader, end)? {
        match &atom.kind {
            b"meta" => {
                if let Some(ilst) = find_mp4_ilst_in_meta(reader, atom)? {
                    return Ok(Some(ilst));
                }
            }
            b"udta" => {
                reader
                    .seek(SeekFrom::Start(atom.content_start))
                    .map_err(|error| error.to_string())?;
                while let Some(child) = read_mp4_atom(reader, atom.end)? {
                    if child.kind == *b"meta"
                        && let Some(ilst) = find_mp4_ilst_in_meta(reader, child)?
                    {
                        return Ok(Some(ilst));
                    }
                    reader
                        .seek(SeekFrom::Start(child.end))
                        .map_err(|error| error.to_string())?;
                }
            }
            _ => {}
        }
        reader
            .seek(SeekFrom::Start(atom.end))
            .map_err(|error| error.to_string())?;
    }
    Ok(None)
}

fn embedded_mp4_cover<R: Read + Seek>(
    reader: &mut R,
    file_length: u64,
) -> Result<Option<Vec<u8>>, String> {
    const MAX_COVER_BYTES: u64 = 128 * 1024 * 1024;
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut ilst = None;
    while let Some(atom) = read_mp4_atom(reader, file_length)? {
        if atom.kind == *b"moov" {
            ilst = find_mp4_ilst(reader, atom.content_start, atom.end)?;
            break;
        }
        reader
            .seek(SeekFrom::Start(atom.end))
            .map_err(|error| error.to_string())?;
    }
    let Some(ilst) = ilst else {
        return Ok(None);
    };

    let mut best = None::<(u64, u64)>;
    reader
        .seek(SeekFrom::Start(ilst.content_start))
        .map_err(|error| error.to_string())?;
    while let Some(item) = read_mp4_atom(reader, ilst.end)? {
        if item.kind == *b"covr" {
            reader
                .seek(SeekFrom::Start(item.content_start))
                .map_err(|error| error.to_string())?;
            while let Some(data) = read_mp4_atom(reader, item.end)? {
                if data.kind == *b"data" && data.end.saturating_sub(data.content_start) >= 8 {
                    let start = data.content_start + 8;
                    let length = data.end.saturating_sub(start);
                    if length > 0
                        && length <= MAX_COVER_BYTES
                        && best.is_none_or(|(_, old)| length > old)
                    {
                        best = Some((start, length));
                    }
                }
                reader
                    .seek(SeekFrom::Start(data.end))
                    .map_err(|error| error.to_string())?;
            }
        }
        reader
            .seek(SeekFrom::Start(item.end))
            .map_err(|error| error.to_string())?;
    }
    let Some((start, length)) = best else {
        return Ok(None);
    };
    reader
        .seek(SeekFrom::Start(start))
        .map_err(|error| error.to_string())?;
    let mut picture = vec![0_u8; length as usize];
    reader
        .read_exact(&mut picture)
        .map_err(|error| error.to_string())?;
    Ok(Some(picture))
}

fn embedded_flac_cover<R: Read + Seek>(reader: &mut R) -> Result<Option<Vec<u8>>, String> {
    const MAX_COVER_BYTES: u64 = 128 * 1024 * 1024;
    seek_to_flac_stream(reader)?;
    let mut best = None::<((u8, u64), Vec<u8>)>;
    loop {
        let mut header = [0_u8; 4];
        reader
            .read_exact(&mut header)
            .map_err(|error| error.to_string())?;
        let last = header[0] & 0x80 != 0;
        let block_type = header[0] & 0x7f;
        let block_len = u64::from(u32::from_be_bytes([0, header[1], header[2], header[3]]));
        let block_start = reader
            .stream_position()
            .map_err(|error| error.to_string())?;
        let block_end = block_start
            .checked_add(block_len)
            .ok_or_else(|| "FLAC picture block overflow".to_string())?;
        if block_type == 6 && block_len >= 32 {
            let mut number = [0_u8; 4];
            reader
                .read_exact(&mut number)
                .map_err(|error| error.to_string())?;
            let picture_type = u32::from_be_bytes(number);
            reader
                .read_exact(&mut number)
                .map_err(|error| error.to_string())?;
            let mime_len = u64::from(u32::from_be_bytes(number));
            seek_forward(reader, mime_len)?;
            reader
                .read_exact(&mut number)
                .map_err(|error| error.to_string())?;
            let description_len = u64::from(u32::from_be_bytes(number));
            seek_forward(reader, description_len.saturating_add(16))?;
            reader
                .read_exact(&mut number)
                .map_err(|error| error.to_string())?;
            let data_len = u64::from(u32::from_be_bytes(number));
            let data_start = reader
                .stream_position()
                .map_err(|error| error.to_string())?;
            if data_len > block_end.saturating_sub(data_start) || data_len > MAX_COVER_BYTES {
                return Err("invalid FLAC picture payload length".to_string());
            }
            let role = match picture_type {
                3 => 3,
                0 => 2,
                4 => 0,
                _ => 1,
            };
            if best
                .as_ref()
                .is_none_or(|(score, _)| (role, data_len) > *score)
            {
                let mut picture = vec![0_u8; data_len as usize];
                reader
                    .read_exact(&mut picture)
                    .map_err(|error| error.to_string())?;
                best = Some(((role, data_len), picture));
            }
        }
        reader
            .seek(SeekFrom::Start(block_end))
            .map_err(|error| error.to_string())?;
        if last {
            break;
        }
    }
    Ok(best.map(|(_, picture)| picture))
}

fn embedded_cover_from_file(path: &Path, region: Option<EmbeddedArtworkRegion>) -> Option<Vec<u8>> {
    let file = File::open(path).ok()?;
    let file_length = file.metadata().ok()?.len();
    let mut reader = BufReader::new(file);
    if let Some(region) = region.filter(|region| {
        region.length <= 128 * 1024 * 1024
            && region.offset.saturating_add(region.length) <= file_length
    }) {
        reader.seek(SeekFrom::Start(region.offset)).ok()?;
        let mut picture = vec![0; region.length as usize];
        reader.read_exact(&mut picture).ok()?;
        return Some(picture);
    }
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let fast = match extension.as_str() {
        "flac" => embedded_flac_cover(&mut reader),
        "m4a" | "alac" => embedded_mp4_cover(&mut reader, file_length),
        _ => return embedded_cover_with_lofty(reader),
    };
    match fast {
        Ok(picture) => picture,
        Err(_) => {
            reader.seek(SeekFrom::Start(0)).ok()?;
            embedded_cover_with_lofty(reader)
        }
    }
}

fn embedded_cover_representative<'a, S>(
    indices: &[usize],
    parsed_files: &'a [ParsedFile],
    refresh_paths: &HashSet<S>,
) -> Option<&'a ParsedFile>
where
    S: std::borrow::Borrow<str> + Eq + std::hash::Hash,
{
    let refreshed = || {
        indices
            .iter()
            .filter_map(|index| parsed_files.get(*index))
            .filter(|parsed| refresh_paths.contains(parsed.path.as_ref()))
    };
    refreshed()
        .find(|parsed| parsed.embedded_artwork.is_some())
        .or_else(|| refreshed().next())
}

fn attach_one_embedded_cover_per_album<S>(
    parsed_files: &mut [ParsedFile],
    refresh_paths: &HashSet<S>,
) -> HashMap<String, String>
where
    S: std::borrow::Borrow<str> + Eq + std::hash::Hash,
{
    let mut groups = HashMap::<String, Vec<usize>>::with_capacity(parsed_files.len());
    for (index, parsed) in parsed_files.iter().enumerate() {
        groups.entry(album_key(parsed)).or_default().push(index);
    }

    let mut covers_by_album = HashMap::<String, String>::with_capacity(groups.len());
    let mut extraction_tasks = Vec::<(String, String, Option<EmbeddedArtworkRegion>)>::new();
    for (album, indices) in &groups {
        let existing_cover = indices
            .iter()
            .filter_map(|index| parsed_files.get(*index))
            .find(|parsed| !parsed.cover_url.is_empty())
            .map(|parsed| parsed.cover_url.clone());
        // Inspect one changed track for duplicated embedded album art.
        if let Some(existing_cover) = existing_cover {
            covers_by_album.insert(album.clone(), existing_cover);
        } else if let Some(representative) =
            embedded_cover_representative(indices, parsed_files, refresh_paths)
        {
            extraction_tasks.push((
                album.clone(),
                representative.path.to_string(),
                representative.embedded_artwork,
            ));
        }
    }

    extraction_tasks.sort_unstable_by(|left, right| left.1.cmp(&right.1));
    let extraction_started = Instant::now();
    let (cover_threads, storage_seek_penalty) = extraction_tasks
        .first()
        .map(|(_, path, _)| parse_thread_count(Path::new(path)))
        .unwrap_or((1, None));
    let extracted = if extraction_tasks.is_empty() {
        Vec::new()
    } else {
        let cover_directory = get_cover_art_path();
        if let Err(error) = std::fs::create_dir_all(&cover_directory) {
            warn!(
                directory = %cover_directory.display(),
                %error,
                "failed to create embedded cover directory"
            );
            return HashMap::new();
        }
        let pool = parser_pool(cover_threads).ok();
        let extract = || {
            extraction_tasks
                .par_iter()
                .filter_map(|(album, path, region)| {
                    let picture = embedded_cover_from_file(Path::new(path), *region)?;
                    let cover = persist_embedded_cover(Path::new(path), &picture, &cover_directory);
                    (!cover.path.is_empty()).then(|| (album.clone(), cover.path))
                })
                .collect::<Vec<_>>()
        };
        pool.map_or_else(extract, |pool| pool.install(extract))
    };
    info!(
        albums_considered = groups.len(),
        albums_inspected = extraction_tasks.len(),
        covers_extracted = extracted.len(),
        cover_threads,
        storage_seek_penalty,
        extraction_wall_us = elapsed_us(extraction_started.elapsed()),
        "embedded cover extraction completed"
    );
    covers_by_album.extend(extracted);

    let mut artwork_hashes = HashMap::with_capacity(covers_by_album.len());
    for (album, indices) in &groups {
        let Some(cover_path) = covers_by_album.get(album) else {
            continue;
        };
        // Keep file-level artwork evidence intact. Broadcasting one album cover
        // to every parsed file makes the next unchanged scan compare that
        // projected cover with each directory's actual local cover and
        // needlessly restage the entire release.
        let already_attached = indices.iter().any(|index| {
            parsed_files
                .get(*index)
                .is_some_and(|parsed| parsed.cover_url == *cover_path)
        });
        if !already_attached
            && let Some(index) = indices.iter().copied().find(|index| {
                parsed_files
                    .get(*index)
                    .is_some_and(|parsed| refresh_paths.contains(parsed.path.as_ref()))
            })
            && let Some(parsed) = parsed_files.get_mut(index)
        {
            // Persist an extracted embedded cover on one representative so a
            // warm scan can reuse it without reopening every track.
            parsed.cover_url.clone_from(cover_path);
        }
        let content_hash = Path::new(cover_path)
            .file_stem()
            .and_then(|value| value.to_str())
            .filter(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .unwrap_or_default()
            .to_string();
        if content_hash.is_empty() {
            continue;
        }
        artwork_hashes.insert(cover_path.clone(), content_hash);
    }
    artwork_hashes
}

fn attach_fallback_local_covers<S>(
    parsed_files: &mut [ParsedFile],
    fallback_covers: &HashMap<&str, String>,
    refresh_paths: &HashSet<S>,
) where
    S: std::borrow::Borrow<str> + Eq + std::hash::Hash,
{
    let mut groups = HashMap::<String, Vec<usize>>::with_capacity(parsed_files.len());
    for (index, parsed) in parsed_files.iter().enumerate() {
        groups.entry(album_key(parsed)).or_default().push(index);
    }

    for indices in groups.values() {
        if indices.iter().any(|index| {
            parsed_files
                .get(*index)
                .is_some_and(|parsed| !parsed.cover_url.is_empty())
        }) {
            continue;
        }
        let fallback = indices
            .iter()
            .filter_map(|index| parsed_files.get(*index))
            .filter_map(|parsed| Path::new(parsed.path.as_ref()).parent())
            .map(normalize_path)
            .filter_map(|directory| fallback_covers.get(directory.as_str()))
            .min()
            .cloned();
        let Some(fallback) = fallback else {
            continue;
        };
        let target = indices
            .iter()
            .copied()
            .find(|index| {
                parsed_files
                    .get(*index)
                    .is_some_and(|parsed| refresh_paths.contains(parsed.path.as_ref()))
            })
            .or_else(|| indices.first().copied());
        if let Some(parsed) = target.and_then(|index| parsed_files.get_mut(index)) {
            parsed.cover_url = fallback;
        }
    }
}

fn quality_rank(file: &DiscoveredFile, parsed: &ParsedFile) -> i32 {
    let extension_score = match file.format {
        AudioFormat::Flac | AudioFormat::Alac | AudioFormat::Wav | AudioFormat::Aiff => 10_000,
        AudioFormat::M4a | AudioFormat::Opus => 5_000,
        AudioFormat::Ogg => 4_000,
        AudioFormat::Mp3 => 3_000,
        _ => 1_000,
    };
    let size_score = if parsed.duration_seconds > 0.0 {
        (file.size_bytes as f64 / parsed.duration_seconds).round() as i32
    } else {
        0
    };

    extension_score + size_score.clamp(0, 999_999)
}

fn recording_duplicate_identity(title: &str) -> String {
    let without_feature_credit = TRAILING_FEATURE_CREDIT
        .get_or_init(|| {
            regex::Regex::new(r"(?ix)\s*[\(\[]\s*(?:feat(?:uring)?\.?|ft\.?)\s+[^\)\]]+[\)\]]\s*$")
                .expect("trailing feature credit regex should compile")
        })
        .replace(title, "");
    normalize_search_text(&without_feature_credit)
}

/// Merges track copies only when independent metadata agrees.
fn resolve_duplicate_tracks(
    prepared_tracks: &[PreparedTrack<'_>],
    discovered_files: &HashMap<&str, &DiscoveredFile>,
) -> HashMap<String, TrackPresentation> {
    let mut candidates =
        HashMap::<TrackDuplicateKey, Vec<&PreparedTrack<'_>>>::with_capacity(prepared_tracks.len());
    for prepared in prepared_tracks.iter().filter(|prepared| {
        prepared.parsed.track_number > 0
            && prepared.parsed.duration_seconds.is_finite()
            && prepared.parsed.duration_seconds > 0.0
    }) {
        candidates
            .entry(TrackDuplicateKey {
                album_id: prepared.album_id.to_string(),
                track_artist: prepared.normalized_track_artist.to_string(),
                track_number: prepared.parsed.track_number,
                disc_number: prepared.parsed.disc_number,
            })
            .or_default()
            .push(prepared);
    }

    let mut presentations = HashMap::with_capacity(prepared_tracks.len());
    for group in candidates.into_values().filter(|group| group.len() > 1) {
        let mut clusters = Vec::<Vec<&PreparedTrack<'_>>>::new();
        for prepared in group {
            if let Some(cluster) = clusters.iter_mut().find(|cluster| {
                cluster[0].duplicate_identity == prepared.duplicate_identity
                    && (cluster[0].parsed.duration_seconds - prepared.parsed.duration_seconds).abs()
                        <= 2.0
            }) {
                cluster.push(prepared);
            } else {
                clusters.push(vec![prepared]);
            }
        }

        for cluster in clusters.into_iter().filter(|cluster| cluster.len() > 1) {
            let representative = cluster
                .iter()
                .copied()
                .max_by(|left, right| {
                    let rank = |prepared: &PreparedTrack<'_>| {
                        discovered_files
                            .get(prepared.parsed.path.as_ref())
                            .map(|file| quality_rank(file, prepared.parsed))
                            .unwrap_or_default()
                    };
                    rank(left)
                        .cmp(&rank(right))
                        .then_with(|| {
                            (!left.parsed.musicbrainz_recording_id.is_empty())
                                .cmp(&!right.parsed.musicbrainz_recording_id.is_empty())
                        })
                        .then_with(|| right.parsed.path.cmp(&left.parsed.path))
                })
                .expect("duplicate cluster is non-empty");
            let raw_identities = cluster
                .iter()
                .map(|prepared| Arc::clone(&prepared.normalized_title))
                .collect::<HashSet<_>>();
            let normalized_id_title = if raw_identities.len() == 1 {
                representative.normalized_title.to_string()
            } else {
                representative.duplicate_identity.to_string()
            };
            let id = hash_normalized_song(
                &normalized_id_title,
                &representative.normalized_album_artist,
                &representative.album_id,
                representative.parsed.track_number,
            );
            let presentation = TrackPresentation {
                recording_id: id.clone(),
                id,
                title: representative.parsed.title.clone(),
                normalized_title: representative.normalized_title.to_string(),
                duration_seconds: representative.parsed.duration_seconds,
                musicbrainz_recording_id: representative.parsed.musicbrainz_recording_id.clone(),
            };
            for prepared in cluster {
                presentations.insert(prepared.parsed.path.to_string(), presentation.clone());
            }
        }
    }
    presentations
}

fn upsert_library_root(conn: &mut SqliteConnection, path: &str) -> QueryResult<i32> {
    diesel::sql_query(format!(
        "INSERT INTO library_root (path, display_name, updated_at) VALUES ('{}', '{}', CURRENT_TIMESTAMP)
         ON CONFLICT(path) DO UPDATE SET updated_at = CURRENT_TIMESTAMP",
        sql_escape(path),
        sql_escape(
            Path::new(path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(path)
        )
    ))
    .execute(conn)?;

    let rows = diesel::sql_query(format!(
        "SELECT id FROM library_root WHERE path = '{}'",
        sql_escape(path)
    ))
    .load::<IdRow>(conn)?;
    Ok(rows.first().map(|row| row.id).unwrap_or_default())
}

fn create_scan_job(conn: &mut SqliteConnection, root_id: i32) -> QueryResult<i32> {
    diesel::sql_query(format!(
        "INSERT INTO library_scan_job (root_id, status, message) VALUES ({root_id}, 'running', 'Scanning library')"
    ))
    .execute(conn)?;
    let rows = diesel::sql_query("SELECT last_insert_rowid() AS id").load::<IdRow>(conn)?;
    Ok(rows.first().map(|row| row.id).unwrap_or_default())
}

fn sync_core_file_references(
    conn: &mut SqliteConnection,
    library: &LibraryRegistration,
    scan_job_id: i32,
    files: &[DiscoveredFile],
) -> QueryResult<()> {
    conn.batch_execute(
        "DROP TABLE IF EXISTS temp.core_reference_stage;
         CREATE TEMP TABLE core_reference_stage (
             core_file_id TEXT PRIMARY KEY, path TEXT NOT NULL
         ) WITHOUT ROWID;
         CREATE UNIQUE INDEX core_reference_stage_path
             ON core_reference_stage(path);",
    )?;
    for file in files {
        let identity = file.stable_identity.as_deref().unwrap_or(&file.path);
        let file_id = FileId::within(&library.id, identity);
        diesel::sql_query(
            "INSERT INTO core_reference_stage (core_file_id, path) VALUES (?, ?)
             ON CONFLICT(core_file_id) DO UPDATE SET path = excluded.path",
        )
        .bind::<Text, _>(file_id.as_str())
        .bind::<Text, _>(file.path.as_ref())
        .execute(conn)?;
    }
    // Remove stale file IDs before upserting the stable library/path key.
    diesel::sql_query(
        "DELETE FROM music_file_reference
         WHERE core_library_id = ?
           AND EXISTS (
               SELECT 1 FROM core_reference_stage stage
               WHERE stage.path = music_file_reference.path
                 AND stage.core_file_id <> music_file_reference.core_file_id
           )",
    )
    .bind::<Text, _>(library.id.as_str())
    .execute(conn)?;
    diesel::sql_query(
        "INSERT INTO music_file_reference
            (core_file_id, core_library_id, path, last_seen_scan_id)
         SELECT core_file_id, ?, path, ? FROM core_reference_stage WHERE true
         ON CONFLICT(core_file_id) DO UPDATE SET
            path = excluded.path,
            last_seen_scan_id = excluded.last_seen_scan_id,
            updated_at = CASE WHEN music_file_reference.path IS NOT excluded.path
                              THEN CURRENT_TIMESTAMP ELSE music_file_reference.updated_at END",
    )
    .bind::<Text, _>(library.id.as_str())
    .bind::<Integer, _>(scan_job_id)
    .execute(conn)?;
    diesel::sql_query(
        "DELETE FROM music_file_reference
         WHERE core_library_id = ?
           AND NOT EXISTS (SELECT 1 FROM core_reference_stage stage
                           WHERE stage.core_file_id = music_file_reference.core_file_id)",
    )
    .bind::<Text, _>(library.id.as_str())
    .execute(conn)?;
    conn.batch_execute("DROP TABLE temp.core_reference_stage;")?;
    Ok(())
}

fn fail_scan_job(conn: &mut SqliteConnection, scan_job_id: i32, message: &str) -> QueryResult<()> {
    diesel::sql_query(format!(
        "UPDATE library_scan_job
         SET status = 'failed', finished_at = CURRENT_TIMESTAMP, message = '{}'
         WHERE id = {}",
        sql_escape(message),
        scan_job_id,
    ))
    .execute(conn)?;
    Ok(())
}

fn existing_snapshots(
    conn: &mut SqliteConnection,
    root_id: i32,
) -> QueryResult<Vec<ExistingFileSnapshot>> {
    let rows = diesel::sql_query(format!(
        "SELECT fe.id AS file_id, fe.path, fe.size_bytes, fe.modified_at_ns, fe.stable_identity, fe.tag_fingerprint,
                rfm.title, rfm.album, rfm.track_artists_json, rfm.album_artists_json,
                rfm.genres_json, rfm.release_date, rfm.track_number, rfm.disc_number, rfm.duration_seconds, rfm.duration_source,
                rfm.cover_url, rfm.parser_version, rfm.cover_resolver_version, rfm.classification_version,
                rfm.musicbrainz_recording_id, rfm.musicbrainz_release_id,
                rfm.musicbrainz_artist_id, rfm.musicbrainz_album_artist_id, rfm.error,
                rfm.embedded_artwork_offset, rfm.embedded_artwork_length
         FROM file_entry fe
         JOIN raw_file_metadata rfm ON rfm.file_id = fe.id
         WHERE fe.root_id = {root_id}"
    ))
    .load::<ExistingFileSnapshot>(conn)?;

    Ok(rows)
}

fn all_available_snapshots(conn: &mut SqliteConnection) -> QueryResult<Vec<ExistingFileSnapshot>> {
    diesel::sql_query(
        "SELECT fe.id AS file_id, fe.path, fe.size_bytes, fe.modified_at_ns, fe.stable_identity, fe.tag_fingerprint,
                rfm.title, rfm.album, rfm.track_artists_json, rfm.album_artists_json,
                rfm.genres_json, rfm.release_date, rfm.track_number, rfm.disc_number, rfm.duration_seconds, rfm.duration_source,
                rfm.cover_url, rfm.parser_version, rfm.cover_resolver_version, rfm.classification_version,
                rfm.musicbrainz_recording_id, rfm.musicbrainz_release_id,
                rfm.musicbrainz_artist_id, rfm.musicbrainz_album_artist_id, rfm.error,
                rfm.embedded_artwork_offset, rfm.embedded_artwork_length
         FROM file_entry fe
         JOIN raw_file_metadata rfm ON rfm.file_id = fe.id
         WHERE fe.availability = 'available'",
    )
    .load::<ExistingFileSnapshot>(conn)
}

fn available_file_count(conn: &mut SqliteConnection) -> QueryResult<usize> {
    let count = diesel::sql_query(
        "SELECT COUNT(*) AS count FROM file_entry WHERE availability = 'available'",
    )
    .get_result::<CountRow>(conn)?
    .count;
    Ok(count.max(0) as usize)
}

#[derive(Serialize)]
struct FileMetadataStageRow<'a> {
    path: &'a str,
    directory: &'a str,
    file_name: &'a str,
    extension: &'a str,
    size_bytes: i64,
    modified_at_ns: i64,
    stable_identity: Option<&'a str>,
    tag_fingerprint: Option<&'a str>,
    scan_status: &'static str,
    was_parsed: bool,
    title: &'a str,
    album: &'a str,
    track_artists_json: &'a [String],
    album_artists_json: &'a [String],
    genres_json: &'a [String],
    release_date: &'a str,
    cover_url: &'a str,
    parser_version: &'static str,
    cover_resolver_version: &'static str,
    classification_version: &'static str,
    track_number: u16,
    disc_number: u16,
    duration_seconds: f64,
    duration_source: &'static str,
    musicbrainz_recording_id: &'a str,
    musicbrainz_release_id: &'a str,
    musicbrainz_artist_id: &'a str,
    musicbrainz_album_artist_id: &'a str,
    error: Option<&'a str>,
    embedded_artwork_offset: Option<i64>,
    embedded_artwork_length: Option<i64>,
}

struct PersistFileMetadataContext<'a> {
    root_id: i32,
    scan_job_id: i32,
    changed_paths: &'a HashSet<&'a str>,
    phase: LibraryIndexPhase,
    stream_staged: bool,
}

fn persist_file_metadata_batch(
    conn: &mut SqliteConnection,
    files: &[DiscoveredFile],
    parsed_by_path: &HashMap<&str, &ParsedFile>,
    context: PersistFileMetadataContext<'_>,
) -> QueryResult<()> {
    let PersistFileMetadataContext {
        root_id,
        scan_job_id,
        changed_paths,
        phase,
        stream_staged,
    } = context;
    stage_file_metadata(
        conn,
        files,
        parsed_by_path,
        changed_paths,
        phase,
        stream_staged,
    )?;
    reconcile_file_renames(conn, root_id)?;
    upsert_file_metadata(conn, root_id, scan_job_id)
}

fn stage_file_metadata(
    conn: &mut SqliteConnection,
    files: &[DiscoveredFile],
    parsed_by_path: &HashMap<&str, &ParsedFile>,
    changed_paths: &HashSet<&str>,
    phase: LibraryIndexPhase,
    stream_staged: bool,
) -> QueryResult<()> {
    conn.batch_execute(
        "DROP TABLE IF EXISTS temp.file_metadata_stage;
         CREATE TEMP TABLE file_metadata_stage (
             path TEXT PRIMARY KEY, directory TEXT NOT NULL, file_name TEXT NOT NULL, extension TEXT NOT NULL,
             size_bytes INTEGER NOT NULL, modified_at_ns INTEGER NOT NULL, stable_identity TEXT, tag_fingerprint TEXT,
             scan_status TEXT NOT NULL, was_parsed INTEGER NOT NULL,
             title TEXT NOT NULL, album TEXT NOT NULL, track_artists_json TEXT NOT NULL, album_artists_json TEXT NOT NULL,
             genres_json TEXT NOT NULL, release_date TEXT NOT NULL, cover_url TEXT NOT NULL, parser_version TEXT NOT NULL,
             cover_resolver_version TEXT NOT NULL, classification_version TEXT NOT NULL,
             track_number INTEGER NOT NULL, disc_number INTEGER NOT NULL, duration_seconds REAL NOT NULL, duration_source TEXT NOT NULL,
             musicbrainz_recording_id TEXT NOT NULL, musicbrainz_release_id TEXT NOT NULL,
             musicbrainz_artist_id TEXT NOT NULL, musicbrainz_album_artist_id TEXT NOT NULL, error TEXT,
             embedded_artwork_offset INTEGER, embedded_artwork_length INTEGER
         ) WITHOUT ROWID;
         CREATE INDEX file_metadata_stage_identity
             ON file_metadata_stage(stable_identity) WHERE stable_identity IS NOT NULL;",
    )?;
    if stream_staged {
        for file in files {
            diesel::sql_query(
                "INSERT INTO file_metadata_stage
                 SELECT ?, ?, ?, ?, ?, ?, ?, ?,
                        CASE WHEN cold.error IS NULL THEN 'parsed' ELSE 'warning' END, 1,
                        cold.title, cold.album, cold.track_artists_json,
                        cold.album_artists_json, cold.genres_json, cold.release_date,
                        cold.cover_url, ?, ?, ?, cold.track_number, cold.disc_number,
                        cold.duration_seconds, cold.duration_source,
                        cold.musicbrainz_recording_id, cold.musicbrainz_release_id,
                        cold.musicbrainz_artist_id, cold.musicbrainz_album_artist_id,
                        cold.error, cold.embedded_artwork_offset, cold.embedded_artwork_length
                 FROM cold_parsed_stage cold WHERE cold.path = ?",
            )
            .bind::<Text, _>(file.path.as_ref())
            .bind::<Text, _>(file.directory.as_ref())
            .bind::<Text, _>(file.file_name.as_ref())
            .bind::<Text, _>(file.format.as_str())
            .bind::<BigInt, _>(file.size_bytes)
            .bind::<BigInt, _>(file.modified_at_ns)
            .bind::<Nullable<Text>, _>(file.stable_identity.as_deref())
            .bind::<Nullable<Text>, _>(file.tag_fingerprint.as_deref())
            .bind::<Text, _>(phase.parser_version())
            .bind::<Text, _>(phase.cover_resolver_version())
            .bind::<Text, _>(phase.classification_version())
            .bind::<Text, _>(file.path.as_ref())
            .execute(conn)?;
        }
    } else {
        let rows = files
            .iter()
            .filter_map(|file| {
                let parsed = parsed_by_path.get(file.path.as_ref())?;
                Some(FileMetadataStageRow {
                    path: &file.path,
                    directory: &file.directory,
                    file_name: &file.file_name,
                    extension: file.format.as_str(),
                    size_bytes: file.size_bytes,
                    modified_at_ns: file.modified_at_ns,
                    stable_identity: file.stable_identity.as_deref(),
                    tag_fingerprint: file.tag_fingerprint.as_deref(),
                    scan_status: if parsed.error.is_some() {
                        "warning"
                    } else {
                        "parsed"
                    },
                    was_parsed: changed_paths.contains(file.path.as_ref()),
                    title: &parsed.title,
                    album: &parsed.album,
                    track_artists_json: &parsed.track_artists,
                    album_artists_json: &parsed.album_artists,
                    genres_json: &parsed.genres,
                    release_date: &parsed.release_date,
                    cover_url: &parsed.cover_url,
                    parser_version: phase.parser_version(),
                    cover_resolver_version: phase.cover_resolver_version(),
                    classification_version: phase.classification_version(),
                    track_number: parsed.track_number,
                    disc_number: parsed.disc_number,
                    duration_seconds: parsed.duration_seconds,
                    duration_source: parsed.duration_source.as_str(),
                    musicbrainz_recording_id: &parsed.musicbrainz_recording_id,
                    musicbrainz_release_id: &parsed.musicbrainz_release_id,
                    musicbrainz_artist_id: &parsed.musicbrainz_artist_id,
                    musicbrainz_album_artist_id: &parsed.musicbrainz_album_artist_id,
                    error: parsed.error.as_deref(),
                    embedded_artwork_offset: parsed
                        .embedded_artwork
                        .and_then(|region| i64::try_from(region.offset).ok()),
                    embedded_artwork_length: parsed
                        .embedded_artwork
                        .and_then(|region| i64::try_from(region.length).ok()),
                })
            })
            .collect::<Vec<_>>();
        for row in rows {
            diesel::sql_query(
            "INSERT INTO file_metadata_stage VALUES
             (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind::<Text, _>(row.path)
        .bind::<Text, _>(row.directory)
        .bind::<Text, _>(row.file_name)
        .bind::<Text, _>(row.extension)
        .bind::<BigInt, _>(row.size_bytes)
        .bind::<BigInt, _>(row.modified_at_ns)
        .bind::<Nullable<Text>, _>(row.stable_identity)
        .bind::<Nullable<Text>, _>(row.tag_fingerprint)
        .bind::<Text, _>(row.scan_status)
        .bind::<Integer, _>(i32::from(row.was_parsed))
        .bind::<Text, _>(row.title)
        .bind::<Text, _>(row.album)
        .bind::<Text, _>(serialize_stage(row.track_artists_json)?)
        .bind::<Text, _>(serialize_stage(row.album_artists_json)?)
        .bind::<Text, _>(serialize_stage(row.genres_json)?)
        .bind::<Text, _>(row.release_date)
        .bind::<Text, _>(row.cover_url)
        .bind::<Text, _>(row.parser_version)
        .bind::<Text, _>(row.cover_resolver_version)
        .bind::<Text, _>(row.classification_version)
        .bind::<Integer, _>(i32::from(row.track_number))
        .bind::<Integer, _>(i32::from(row.disc_number))
        .bind::<Double, _>(row.duration_seconds)
        .bind::<Text, _>(row.duration_source)
        .bind::<Text, _>(row.musicbrainz_recording_id)
        .bind::<Text, _>(row.musicbrainz_release_id)
        .bind::<Text, _>(row.musicbrainz_artist_id)
        .bind::<Text, _>(row.musicbrainz_album_artist_id)
        .bind::<Nullable<Text>, _>(row.error)
        .bind::<Nullable<BigInt>, _>(row.embedded_artwork_offset)
        .bind::<Nullable<BigInt>, _>(row.embedded_artwork_length)
        .execute(conn)?;
        }
    }
    Ok(())
}

fn reconcile_file_renames(conn: &mut SqliteConnection, root_id: i32) -> QueryResult<()> {
    conn.batch_execute(
        "DROP TABLE IF EXISTS temp.file_rename_stage;
         DROP TABLE IF EXISTS temp.missing_file_stage;
         CREATE TEMP TABLE file_rename_stage (
             old_path TEXT PRIMARY KEY, new_path TEXT NOT NULL UNIQUE
         ) WITHOUT ROWID;
         CREATE TEMP TABLE missing_file_stage (
             path TEXT PRIMARY KEY, stable_identity TEXT, size_bytes INTEGER NOT NULL,
             modified_at_ns INTEGER NOT NULL, tag_fingerprint TEXT
         ) WITHOUT ROWID;
         CREATE INDEX missing_file_stage_identity
             ON missing_file_stage(stable_identity) WHERE stable_identity IS NOT NULL;
         CREATE INDEX missing_file_stage_fingerprint
             ON missing_file_stage(size_bytes, modified_at_ns, tag_fingerprint)
             WHERE stable_identity IS NULL;",
    )?;
    diesel::sql_query(
        "INSERT INTO missing_file_stage
         SELECT path, stable_identity, size_bytes, modified_at_ns, tag_fingerprint
         FROM file_entry existing
         WHERE root_id = ?
           AND NOT EXISTS (SELECT 1 FROM current_scan_path current WHERE current.path = existing.path)",
    )
    .bind::<Integer, _>(root_id)
    .execute(conn)?;
    diesel::sql_query(
        "INSERT INTO file_rename_stage(old_path, new_path)
         SELECT MIN(existing.path), MIN(stage.path)
         FROM file_metadata_stage stage
         JOIN missing_file_stage existing
           ON existing.stable_identity = stage.stable_identity
         WHERE stage.stable_identity IS NOT NULL
           AND existing.path <> stage.path
           AND NOT EXISTS (SELECT 1 FROM file_entry target WHERE target.path = stage.path)
         GROUP BY stage.stable_identity
         HAVING COUNT(DISTINCT stage.path) = 1 AND COUNT(DISTINCT existing.path) = 1",
    )
    .execute(conn)?;
    diesel::sql_query(
        "INSERT OR IGNORE INTO file_rename_stage(old_path, new_path)
         SELECT MIN(existing.path), MIN(stage.path)
         FROM file_metadata_stage stage
         JOIN missing_file_stage existing
           ON existing.stable_identity IS NULL
          AND existing.size_bytes = stage.size_bytes
          AND existing.modified_at_ns = stage.modified_at_ns
          AND existing.tag_fingerprint IS stage.tag_fingerprint
         WHERE stage.stable_identity IS NULL
           AND existing.path <> stage.path
           AND NOT EXISTS (SELECT 1 FROM file_entry target WHERE target.path = stage.path)
         GROUP BY stage.size_bytes, stage.modified_at_ns, stage.tag_fingerprint
         HAVING COUNT(DISTINCT stage.path) = 1 AND COUNT(DISTINCT existing.path) = 1",
    )
    .execute(conn)?;
    conn.batch_execute(
        "UPDATE file_entry AS existing
         SET path = stage.path, directory = stage.directory, file_name = stage.file_name,
             extension = stage.extension, updated_at = CURRENT_TIMESTAMP
         FROM file_rename_stage renamed
         JOIN file_metadata_stage stage ON stage.path = renamed.new_path
         WHERE existing.path = renamed.old_path;
         DROP TABLE temp.file_rename_stage;
         DROP TABLE temp.missing_file_stage;",
    )?;
    Ok(())
}

fn upsert_file_metadata(
    conn: &mut SqliteConnection,
    root_id: i32,
    scan_job_id: i32,
) -> QueryResult<()> {
    diesel::sql_query(
        "INSERT INTO file_entry
            (root_id, path, directory, file_name, extension, size_bytes, modified_at_ns, stable_identity, tag_fingerprint, availability,
             scan_status, last_seen_scan_id, last_parsed_at, updated_at)
         SELECT ?, path, directory, file_name, extension, size_bytes, modified_at_ns, stable_identity, tag_fingerprint, 'available',
                scan_status, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         FROM file_metadata_stage WHERE true
         ON CONFLICT(path) DO UPDATE SET
             root_id = excluded.root_id, directory = excluded.directory, file_name = excluded.file_name,
             extension = excluded.extension, size_bytes = excluded.size_bytes, modified_at_ns = excluded.modified_at_ns,
             stable_identity = excluded.stable_identity, tag_fingerprint = excluded.tag_fingerprint,
             availability = 'available', scan_status = excluded.scan_status, last_seen_scan_id = excluded.last_seen_scan_id,
             last_parsed_at = CASE WHEN (SELECT was_parsed FROM file_metadata_stage WHERE path = excluded.path)
                                   THEN CURRENT_TIMESTAMP ELSE file_entry.last_parsed_at END,
             updated_at = CASE WHEN file_entry.root_id IS NOT excluded.root_id
                                  OR file_entry.directory IS NOT excluded.directory OR file_entry.file_name IS NOT excluded.file_name
                                  OR file_entry.extension IS NOT excluded.extension OR file_entry.size_bytes IS NOT excluded.size_bytes
                                  OR file_entry.modified_at_ns IS NOT excluded.modified_at_ns OR file_entry.availability IS NOT 'available'
                                  OR file_entry.scan_status IS NOT excluded.scan_status OR file_entry.last_seen_scan_id IS NOT excluded.last_seen_scan_id
                               THEN CURRENT_TIMESTAMP ELSE file_entry.updated_at END",
    )
    .bind::<Integer, _>(root_id).bind::<Integer, _>(scan_job_id).execute(conn)?;
    conn.batch_execute(
        "INSERT INTO raw_file_metadata
            (file_id, title, album, track_artists_json, album_artists_json, genres_json, release_date, cover_url,
             parser_version, cover_resolver_version, classification_version,
             track_number, disc_number, duration_seconds, duration_source, musicbrainz_recording_id,
             musicbrainz_release_id, musicbrainz_artist_id, musicbrainz_album_artist_id, error,
             embedded_artwork_offset, embedded_artwork_length)
         SELECT file.id, stage.title, stage.album, stage.track_artists_json, stage.album_artists_json,
                stage.genres_json, stage.release_date, stage.cover_url, stage.parser_version,
                stage.cover_resolver_version, stage.classification_version,
                stage.track_number, stage.disc_number, stage.duration_seconds, stage.duration_source, stage.musicbrainz_recording_id,
                stage.musicbrainz_release_id, stage.musicbrainz_artist_id, stage.musicbrainz_album_artist_id, stage.error,
                stage.embedded_artwork_offset, stage.embedded_artwork_length
         FROM file_metadata_stage stage JOIN file_entry file USING(path) WHERE stage.was_parsed
         ON CONFLICT(file_id) DO UPDATE SET
             title = excluded.title, album = excluded.album, track_artists_json = excluded.track_artists_json,
             album_artists_json = excluded.album_artists_json, genres_json = excluded.genres_json,
             release_date = excluded.release_date,
             cover_url = CASE WHEN excluded.cover_url <> '' THEN excluded.cover_url ELSE raw_file_metadata.cover_url END,
             parser_version = excluded.parser_version,
             cover_resolver_version = excluded.cover_resolver_version,
             classification_version = excluded.classification_version,
             track_number = excluded.track_number,
             disc_number = excluded.disc_number, duration_seconds = excluded.duration_seconds,
             duration_source = excluded.duration_source,
             musicbrainz_recording_id = excluded.musicbrainz_recording_id,
             musicbrainz_release_id = excluded.musicbrainz_release_id,
             musicbrainz_artist_id = excluded.musicbrainz_artist_id,
             musicbrainz_album_artist_id = excluded.musicbrainz_album_artist_id, error = excluded.error,
             embedded_artwork_offset = excluded.embedded_artwork_offset,
             embedded_artwork_length = excluded.embedded_artwork_length,
             parsed_at = CURRENT_TIMESTAMP
         WHERE raw_file_metadata.title IS NOT excluded.title OR raw_file_metadata.album IS NOT excluded.album
            OR raw_file_metadata.track_artists_json IS NOT excluded.track_artists_json
            OR raw_file_metadata.album_artists_json IS NOT excluded.album_artists_json
            OR raw_file_metadata.genres_json IS NOT excluded.genres_json OR raw_file_metadata.release_date IS NOT excluded.release_date
            OR (excluded.cover_url <> '' AND raw_file_metadata.cover_url IS NOT excluded.cover_url)
            OR raw_file_metadata.parser_version IS NOT excluded.parser_version
            OR raw_file_metadata.cover_resolver_version IS NOT excluded.cover_resolver_version
            OR raw_file_metadata.classification_version IS NOT excluded.classification_version
            OR raw_file_metadata.track_number IS NOT excluded.track_number OR raw_file_metadata.disc_number IS NOT excluded.disc_number
            OR raw_file_metadata.duration_seconds IS NOT excluded.duration_seconds
            OR raw_file_metadata.duration_source IS NOT excluded.duration_source
            OR raw_file_metadata.musicbrainz_recording_id IS NOT excluded.musicbrainz_recording_id
            OR raw_file_metadata.musicbrainz_release_id IS NOT excluded.musicbrainz_release_id
            OR raw_file_metadata.musicbrainz_artist_id IS NOT excluded.musicbrainz_artist_id
            OR raw_file_metadata.musicbrainz_album_artist_id IS NOT excluded.musicbrainz_album_artist_id
            OR raw_file_metadata.error IS NOT excluded.error;

         DELETE FROM duration_repair_queue
         WHERE file_id IN (
             SELECT file.id FROM file_metadata_stage stage JOIN file_entry file USING(path)
             WHERE stage.was_parsed AND stage.duration_source IN ('exact', 'header_derived')
         );

         INSERT INTO duration_repair_queue (file_id, reason, status, requested_at)
         SELECT file.id, 'foreground_' || stage.duration_source, 'pending', CURRENT_TIMESTAMP
         FROM file_metadata_stage stage JOIN file_entry file USING(path)
         WHERE stage.was_parsed AND stage.duration_source IN ('estimated', 'unavailable')
         ON CONFLICT(file_id) DO UPDATE SET
             reason = excluded.reason, status = 'pending', requested_at = CURRENT_TIMESTAMP,
             started_at = NULL, completed_at = NULL, error = NULL;
         ",
    )?;
    diesel::sql_query(
        "INSERT INTO library_scan_event (scan_job_id, level, path, message)
         SELECT ?, 'warn', path, error FROM file_metadata_stage WHERE error IS NOT NULL
         LIMIT MAX(0, ? - (
             SELECT COUNT(*) FROM library_scan_event WHERE scan_job_id = ? AND level = 'warn'
         ))",
    )
    .bind::<Integer, _>(scan_job_id)
    .bind::<Integer, _>(MAX_WARNING_DETAILS as i32)
    .bind::<Integer, _>(scan_job_id)
    .execute(conn)?;
    conn.batch_execute(
        "INSERT OR IGNORE INTO current_scan_path SELECT path FROM file_metadata_stage;
         INSERT OR IGNORE INTO changed_scan_path SELECT path FROM file_metadata_stage WHERE was_parsed;",
    )?;
    conn.batch_execute("DROP TABLE temp.file_metadata_stage;")?;
    Ok(())
}

fn stage_current_scan_paths(
    conn: &mut SqliteConnection,
    files: &[DiscoveredFile],
) -> QueryResult<()> {
    for file in files {
        diesel::sql_query("INSERT OR IGNORE INTO current_scan_path(path) VALUES (?)")
            .bind::<Text, _>(file.path.as_ref())
            .execute(conn)?;
    }
    Ok(())
}

#[derive(Serialize)]
struct DirectoryScanStageRow<'a> {
    directory: &'a str,
    audio_file_count: usize,
    total_size_bytes: i64,
    max_modified_at_ns: i64,
    inventory_signature: String,
}

fn persist_directory_scan_state(
    conn: &mut SqliteConnection,
    root_id: i32,
    scan_job_id: i32,
    files: &[DiscoveredFile],
) -> QueryResult<()> {
    let mut directories = BTreeMap::<&str, Vec<&DiscoveredFile>>::new();
    for file in files {
        directories.entry(&file.directory).or_default().push(file);
    }
    let mut rows = Vec::with_capacity(directories.len());
    for (directory, mut entries) in directories {
        entries.sort_unstable_by(|left, right| left.path.cmp(&right.path));
        let total_size = entries.iter().map(|file| file.size_bytes).sum::<i64>();
        let max_mtime = entries
            .iter()
            .map(|file| file.modified_at_ns)
            .max()
            .unwrap_or_default();
        let mut digest = Sha256::new();
        for file in &entries {
            digest.update(file.file_name.as_bytes());
            digest.update(file.size_bytes.to_le_bytes());
            digest.update(file.modified_at_ns.to_le_bytes());
            if let Some(identity) = &file.stable_identity {
                digest.update(identity.as_bytes());
            }
            if let Some(fingerprint) = &file.tag_fingerprint {
                digest.update(fingerprint.as_bytes());
            }
        }
        rows.push(DirectoryScanStageRow {
            directory,
            audio_file_count: entries.len(),
            total_size_bytes: total_size,
            max_modified_at_ns: max_mtime,
            inventory_signature: hex_digest(digest.finalize().as_slice()),
        });
    }
    for row in rows {
        diesel::sql_query(
            "INSERT INTO directory_scan_state
                (root_id, directory, audio_file_count, total_size_bytes, max_modified_at_ns,
                 inventory_signature, last_seen_scan_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(root_id, directory) DO UPDATE SET
                audio_file_count = excluded.audio_file_count,
                total_size_bytes = excluded.total_size_bytes,
                max_modified_at_ns = excluded.max_modified_at_ns,
                inventory_signature = excluded.inventory_signature,
                last_seen_scan_id = excluded.last_seen_scan_id,
                updated_at = CASE
                    WHEN directory_scan_state.inventory_signature IS NOT excluded.inventory_signature
                    THEN CURRENT_TIMESTAMP ELSE directory_scan_state.updated_at END",
        )
        .bind::<Integer, _>(root_id)
        .bind::<Text, _>(row.directory)
        .bind::<Integer, _>(row.audio_file_count as i32)
        .bind::<BigInt, _>(row.total_size_bytes)
        .bind::<BigInt, _>(row.max_modified_at_ns)
        .bind::<Text, _>(row.inventory_signature)
        .bind::<Integer, _>(scan_job_id)
        .execute(conn)?;
    }
    diesel::sql_query(
        "DELETE FROM directory_scan_state
         WHERE root_id = ? AND last_seen_scan_id IS NOT ?",
    )
    .bind::<Integer, _>(root_id)
    .bind::<Integer, _>(scan_job_id)
    .execute(conn)?;
    Ok(())
}

struct ReconcileInputs<'a> {
    root_id: i32,
    parsed_files: &'a [ParsedFile],
    file_ids: &'a HashMap<String, i32>,
    discovered_files: &'a HashMap<&'a str, &'a DiscoveredFile>,
    artwork_hashes: &'a HashMap<String, String>,
    phase: LibraryIndexPhase,
    mode: IndexMode,
    changed_paths: &'a HashSet<&'a str>,
}

#[derive(Serialize)]
struct LibraryRebuildStageRow {
    album_artist_id: String,
    album_artist_name: String,
    album_artist_normalized: String,
    track_artist_id: String,
    track_artist_name: String,
    track_artist_normalized: String,
    artwork_id: Option<String>,
    artwork_uri: String,
    album_id: String,
    album_title: String,
    album_normalized: String,
    album_primary_type: String,
    release_group_id: String,
    release_group_title: String,
    release_group_normalized: String,
    release_group_type: String,
    release_metadata: String,
    first_release_date: String,
    album_musicbrainz_id: String,
    track_id: String,
    recording_id: String,
    track_title: String,
    track_normalized: String,
    track_number: u16,
    disc_number: u16,
    duration_seconds: f64,
    recording_musicbrainz_id: String,
    file_id: Option<i32>,
    quality_rank: i32,
    song_subtitle: String,
    song_search_text: String,
    album_search_text: String,
}

#[derive(Serialize)]
struct LibraryGenreStageRow {
    track_id: String,
    album_id: String,
    name: String,
    normalized_name: String,
}

struct StagePreparedTracksInputs<'borrow, 'data> {
    prepared_tracks: &'borrow [PreparedTrack<'data>],
    release_presentations: &'borrow HashMap<String, ReleasePresentation>,
    track_presentations: &'borrow HashMap<String, TrackPresentation>,
    effective_covers: &'borrow HashMap<String, String>,
    artwork_hashes: &'borrow HashMap<String, String>,
    file_ids: &'borrow HashMap<String, i32>,
    discovered_files: &'borrow HashMap<&'data str, &'data DiscoveredFile>,
    affected_album_ids: &'borrow HashSet<String>,
    mode: IndexMode,
    phase: LibraryIndexPhase,
}

fn stage_prepared_tracks(
    conn: &mut SqliteConnection,
    inputs: StagePreparedTracksInputs<'_, '_>,
) -> QueryResult<()> {
    let StagePreparedTracksInputs {
        prepared_tracks,
        release_presentations,
        track_presentations,
        effective_covers,
        artwork_hashes,
        file_ids,
        discovered_files,
        affected_album_ids,
        mode,
        phase,
    } = inputs;
    struct SearchProjection {
        subtitle: String,
        song: String,
        album: String,
    }
    let mut search_documents = prepared_tracks
        .par_iter()
        .map(|prepared| {
            let parsed = prepared.parsed;
            let presentation = release_presentations.get(prepared.album_id.as_ref());
            let track_presentation = track_presentations.get(parsed.path.as_ref());
            let album_title = presentation
                .map(|value| value.title.as_str())
                .unwrap_or(&parsed.album);
            let album_normalized = presentation
                .map(|value| value.normalized_title.as_str())
                .unwrap_or(prepared.normalized_album.as_ref());
            let track_normalized = track_presentation
                .map(|value| value.normalized_title.as_str())
                .unwrap_or(prepared.normalized_title.as_ref());
            let release_type = presentation
                .map(|value| normalize_search_text(&value.primary_type))
                .unwrap_or_else(|| "album".to_string());
            (
                Arc::clone(&parsed.path),
                SearchProjection {
                    subtitle: format!(
                        "{} • {album_title}",
                        prepared.resolved_track_artist.as_ref()
                    ),
                    song: format!(
                        "{track_normalized} {album_normalized} {} {release_type}",
                        prepared.normalized_track_artist.as_ref()
                    ),
                    album: format!(
                        "{album_normalized} {} {release_type}",
                        prepared.normalized_album_artist.as_ref()
                    ),
                },
            )
        })
        .collect::<HashMap<_, _>>();

    for batch in prepared_tracks.chunks(DATABASE_BATCH_SIZE) {
        let mut stage_rows = Vec::with_capacity(batch.len());
        let mut genre_rows = Vec::new();
        for prepared in batch.iter().filter(|prepared| {
            mode == IndexMode::Repair || affected_album_ids.contains(prepared.album_id.as_ref())
        }) {
            let parsed = prepared.parsed;
            let track_artist_name = prepared.resolved_track_artist.as_ref();
            let album_artist_name = prepared.resolved_album_artist.as_ref();
            let album_artist_id = prepared.artist_id.as_ref();
            let track_artist_id = prepared.track_artist_id.as_ref();
            let album_id = prepared.album_id.as_ref();
            let presentation = release_presentations.get(album_id);
            let album_title = presentation
                .map(|value| value.title.as_str())
                .unwrap_or(&parsed.album);
            let cover = effective_covers
                .get(album_id)
                .map(String::as_str)
                .unwrap_or_default();
            let artwork_id = (!cover.is_empty()).then(|| {
                artwork_hashes
                    .get(cover)
                    .filter(|hash| !hash.is_empty())
                    .cloned()
                    .unwrap_or_else(|| hash_album(cover, "artwork"))
            });
            let track_presentation = track_presentations.get(parsed.path.as_ref());
            let track_id = track_presentation
                .map(|value| value.id.as_str())
                .unwrap_or(prepared.track_id.as_ref());
            let recording_id = track_presentation
                .map(|value| value.recording_id.as_str())
                .unwrap_or(prepared.recording_id.as_ref());
            let track_title = track_presentation
                .map(|value| value.title.as_str())
                .unwrap_or(&parsed.title);
            let duration = track_presentation
                .map(|value| value.duration_seconds)
                .unwrap_or(parsed.duration_seconds);
            let recording_mb_id = track_presentation
                .map(|value| value.musicbrainz_recording_id.as_str())
                .unwrap_or(&parsed.musicbrainz_recording_id);
            let primary_type = presentation
                .map(|value| value.primary_type.as_str())
                .unwrap_or("Album");
            let release_group_id = presentation
                .map(|value| value.release_group_id.as_str())
                .unwrap_or(album_id);
            let release_group_title = presentation
                .map(|value| value.release_group_title.as_str())
                .unwrap_or(album_title);
            let release_group_normalized = presentation
                .map(|value| value.normalized_release_group_title.as_str())
                .unwrap_or(prepared.normalized_album.as_ref());
            let release_group_type = presentation
                .map(|value| value.release_group_type.as_str())
                .unwrap_or(primary_type);
            let release_metadata = presentation
                .map(|value| value.metadata_json.as_str())
                .unwrap_or("{}");
            let first_release_date = presentation
                .map(|value| value.first_release_date.as_str())
                .unwrap_or(&parsed.release_date);
            let quality = if phase == LibraryIndexPhase::Enriched {
                discovered_files
                    .get(parsed.path.as_ref())
                    .map(|file| quality_rank(file, parsed))
                    .unwrap_or_default()
            } else {
                0
            };
            let album_artist_normalized = prepared.normalized_album_artist.as_ref();
            let track_artist_normalized = prepared.normalized_track_artist.as_ref();
            let album_normalized = presentation
                .map(|value| value.normalized_title.as_str())
                .unwrap_or(prepared.normalized_album.as_ref());
            let track_normalized = track_presentation
                .map(|value| value.normalized_title.as_str())
                .unwrap_or(prepared.normalized_title.as_ref());
            let search = search_documents
                .remove(parsed.path.as_ref())
                .expect("every prepared track has one search projection");
            stage_rows.push(LibraryRebuildStageRow {
                album_artist_id: album_artist_id.to_string(),
                album_artist_name: album_artist_name.to_string(),
                album_artist_normalized: album_artist_normalized.to_string(),
                track_artist_id: track_artist_id.to_string(),
                track_artist_name: track_artist_name.to_string(),
                track_artist_normalized: track_artist_normalized.to_string(),
                artwork_id,
                artwork_uri: cover.to_string(),
                album_id: album_id.to_string(),
                album_title: album_title.to_string(),
                album_normalized: album_normalized.to_string(),
                album_primary_type: primary_type.to_string(),
                release_group_id: release_group_id.to_string(),
                release_group_title: release_group_title.to_string(),
                release_group_normalized: release_group_normalized.to_string(),
                release_group_type: release_group_type.to_string(),
                release_metadata: release_metadata.to_string(),
                first_release_date: first_release_date.to_string(),
                album_musicbrainz_id: parsed.musicbrainz_release_id.clone(),
                track_id: track_id.to_string(),
                recording_id: recording_id.to_string(),
                track_title: track_title.to_string(),
                track_normalized: track_normalized.to_string(),
                track_number: parsed.track_number,
                disc_number: parsed.disc_number,
                duration_seconds: duration,
                recording_musicbrainz_id: recording_mb_id.to_string(),
                file_id: file_ids.get(parsed.path.as_ref()).copied(),
                quality_rank: quality,
                song_subtitle: search.subtitle,
                song_search_text: search.song,
                album_search_text: search.album,
            });
            for genre in &prepared.genres {
                genre_rows.push(LibraryGenreStageRow {
                    track_id: track_id.to_string(),
                    album_id: album_id.to_string(),
                    name: genre.name.to_string(),
                    normalized_name: genre.normalized_name.to_string(),
                });
            }
        }
        for row in stage_rows {
            diesel::sql_query(
                    "INSERT INTO library_rebuild_stage VALUES
                     (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .bind::<Text, _>(row.album_artist_id)
                .bind::<Text, _>(row.album_artist_name)
                .bind::<Text, _>(row.album_artist_normalized)
                .bind::<Text, _>(row.track_artist_id)
                .bind::<Text, _>(row.track_artist_name)
                .bind::<Text, _>(row.track_artist_normalized)
                .bind::<Nullable<Text>, _>(row.artwork_id)
                .bind::<Text, _>(row.artwork_uri)
                .bind::<Text, _>(row.album_id)
                .bind::<Text, _>(row.album_title)
                .bind::<Text, _>(row.album_normalized)
                .bind::<Text, _>(row.album_primary_type)
                .bind::<Text, _>(row.release_group_id)
                .bind::<Text, _>(row.release_group_title)
                .bind::<Text, _>(row.release_group_normalized)
                .bind::<Text, _>(row.release_group_type)
                .bind::<Text, _>(row.release_metadata)
                .bind::<Text, _>(row.first_release_date)
                .bind::<Text, _>(row.album_musicbrainz_id)
                .bind::<Text, _>(row.track_id)
                .bind::<Text, _>(row.recording_id)
                .bind::<Text, _>(row.track_title)
                .bind::<Text, _>(row.track_normalized)
                .bind::<Integer, _>(i32::from(row.track_number))
                .bind::<Integer, _>(i32::from(row.disc_number))
                .bind::<Double, _>(row.duration_seconds)
                .bind::<Text, _>(row.recording_musicbrainz_id)
                .bind::<Nullable<Integer>, _>(row.file_id)
                .bind::<Integer, _>(row.quality_rank)
                .bind::<Text, _>(row.song_subtitle)
                .bind::<Text, _>(row.song_search_text)
                .bind::<Text, _>(row.album_search_text)
                .execute(conn)?;
        }
        for row in genre_rows {
            diesel::sql_query(
                "INSERT OR IGNORE INTO library_genre_stage
                     (track_id, album_id, name, normalized_name) VALUES (?, ?, ?, ?)",
            )
            .bind::<Text, _>(row.track_id)
            .bind::<Text, _>(row.album_id)
            .bind::<Text, _>(row.name)
            .bind::<Text, _>(row.normalized_name)
            .execute(conn)?;
        }
    }
    Ok(())
}
fn reconcile_normalized_tables(
    conn: &mut SqliteConnection,
    inputs: ReconcileInputs<'_>,
) -> QueryResult<()> {
    let ReconcileInputs {
        root_id,
        parsed_files,
        file_ids,
        discovered_files,
        artwork_hashes,
        phase,
        mode,
        changed_paths,
    } = inputs;
    conn.batch_execute(
        "DROP TABLE IF EXISTS temp.library_rebuild_stage;
         DROP TABLE IF EXISTS temp.library_genre_stage;
         DROP TABLE IF EXISTS temp.affected_album;
         DROP TABLE IF EXISTS temp.affected_track;
         DROP TABLE IF EXISTS temp.affected_artist;
         CREATE TEMP TABLE library_rebuild_stage (
             album_artist_id TEXT NOT NULL, album_artist_name TEXT NOT NULL, album_artist_normalized TEXT NOT NULL,
             track_artist_id TEXT NOT NULL, track_artist_name TEXT NOT NULL, track_artist_normalized TEXT NOT NULL,
             artwork_id TEXT, artwork_uri TEXT NOT NULL,
             album_id TEXT NOT NULL, album_title TEXT NOT NULL, album_normalized TEXT NOT NULL, album_primary_type TEXT NOT NULL,
             release_group_id TEXT NOT NULL, release_group_title TEXT NOT NULL, release_group_normalized TEXT NOT NULL,
             release_group_type TEXT NOT NULL, release_metadata TEXT NOT NULL, first_release_date TEXT NOT NULL,
             album_musicbrainz_id TEXT NOT NULL,
             track_id TEXT NOT NULL, recording_id TEXT NOT NULL, track_title TEXT NOT NULL, track_normalized TEXT NOT NULL,
             track_number INTEGER NOT NULL, disc_number INTEGER NOT NULL, duration_seconds REAL NOT NULL,
             recording_musicbrainz_id TEXT NOT NULL, file_id INTEGER, quality_rank INTEGER NOT NULL,
             song_subtitle TEXT NOT NULL, song_search_text TEXT NOT NULL, album_search_text TEXT NOT NULL
         );
         CREATE TEMP TABLE library_genre_stage (
             track_id TEXT NOT NULL, album_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL,
             PRIMARY KEY (track_id, album_id, normalized_name)
         ) WITHOUT ROWID;
         CREATE TEMP TABLE affected_album (id TEXT PRIMARY KEY) WITHOUT ROWID;
         CREATE TEMP TABLE affected_track (id TEXT PRIMARY KEY) WITHOUT ROWID;
         CREATE TEMP TABLE affected_artist (id TEXT PRIMARY KEY) WITHOUT ROWID;",
    )?;

    if mode == IndexMode::Incremental {
        diesel::sql_query(
            "INSERT OR IGNORE INTO affected_album
             SELECT DISTINCT track.album_id
             FROM track_entity track
             JOIN track_file source ON source.track_id = track.id
             JOIN file_entry file ON file.id = source.file_id
             LEFT JOIN current_scan_path current ON current.path = file.path
             LEFT JOIN changed_scan_path changed ON changed.path = file.path
             WHERE file.root_id = ? AND (current.path IS NULL OR changed.path IS NOT NULL)
               AND track.album_id IS NOT NULL",
        )
        .bind::<Integer, _>(root_id)
        .execute(conn)?;
    }

    let track_count = parsed_files.len();
    let mut interner = StringInterner::with_capacity(track_count.saturating_mul(12));
    let seeds = prepare_track_seeds(parsed_files, &mut interner);
    let mut changed_artist_identities = HashSet::new();
    let artist_aliases = if phase == LibraryIndexPhase::Enriched {
        let retained = load_artist_alias_decisions(conn)?;
        let mut changed_identities = if mode == IndexMode::Repair || retained.is_empty() {
            seeds
                .iter()
                .map(|seed| seed.normalized_primary_track_artist.to_string())
                .collect::<HashSet<_>>()
        } else {
            seeds
                .iter()
                .filter(|seed| changed_paths.contains(seed.parsed.path.as_ref()))
                .map(|seed| seed.normalized_primary_track_artist.to_string())
                .collect::<HashSet<_>>()
        };
        for (alias, canonical) in &retained {
            if changed_identities.contains(&normalize_artist_identity(canonical)) {
                changed_identities.insert(alias.clone());
            }
        }
        changed_artist_identities.clone_from(&changed_identities);
        let (aliases, comparisons) =
            infer_artist_aliases_for(&seeds, &retained, &changed_identities);
        info!(
            changed_names = changed_identities.len(),
            candidate_comparisons = comparisons,
            "bounded artist alias inference completed"
        );
        persist_artist_alias_decisions(conn, &aliases)?;
        aliases
    } else {
        HashMap::with_capacity(0)
    };
    let inferred_album_artists = if phase == LibraryIndexPhase::Enriched {
        infer_album_artists(&seeds, &artist_aliases)
    } else {
        HashMap::with_capacity(0)
    };
    let prepared_tracks = prepare_tracks(
        seeds,
        &artist_aliases,
        &inferred_album_artists,
        &mut interner,
    );
    if mode == IndexMode::Repair {
        for album_id in prepared_tracks
            .iter()
            .map(|prepared| prepared.album_id.as_ref())
            .collect::<HashSet<_>>()
        {
            diesel::sql_query("INSERT OR IGNORE INTO affected_album VALUES (?)")
                .bind::<Text, _>(album_id)
                .execute(conn)?;
        }
    } else {
        for album_id in prepared_tracks
            .iter()
            .filter(|prepared| changed_paths.contains(prepared.parsed.path.as_ref()))
            .map(|prepared| prepared.album_id.as_ref())
            .collect::<HashSet<_>>()
        {
            diesel::sql_query("INSERT OR IGNORE INTO affected_album VALUES (?)")
                .bind::<Text, _>(album_id)
                .execute(conn)?;
        }
        for album_id in prepared_tracks
            .iter()
            .filter(|prepared| {
                changed_artist_identities
                    .contains(prepared.normalized_primary_track_artist.as_ref())
            })
            .map(|prepared| prepared.album_id.as_ref())
            .collect::<HashSet<_>>()
        {
            diesel::sql_query("INSERT OR IGNORE INTO affected_album VALUES (?)")
                .bind::<Text, _>(album_id)
                .execute(conn)?;
        }
    }
    let mut affected_album_ids = diesel::sql_query("SELECT id FROM affected_album")
        .load::<TextIdRow>(conn)?
        .into_iter()
        .map(|row| row.id)
        .collect::<HashSet<_>>();
    let current_album_ids = prepared_tracks
        .iter()
        .map(|prepared| prepared.album_id.to_string())
        .collect::<HashSet<_>>();
    let cached_inference = if phase == LibraryIndexPhase::Enriched {
        load_album_inference_cache(conn)?
    } else {
        HashMap::new()
    };
    // Repair cached titles without reparsing file metadata.
    for (album_id, (evidence, presentation)) in &cached_inference {
        let analysis = analyze_release_title(&evidence.album_name);
        let expected_title = if analysis.is_edition && presentation.original_album_id.is_none() {
            &analysis.canonical_title
        } else {
            &analysis.display_title
        };
        if presentation.title != expected_title.as_str()
            || presentation.normalized_title != normalize_album_identity(expected_title)
        {
            affected_album_ids.insert(album_id.clone());
        }
    }
    let mut affected_release_groups = cached_inference
        .iter()
        .filter(|(album_id, _)| affected_album_ids.contains(*album_id))
        .map(|(_, (evidence, _))| {
            let analysis = analyze_release_title(&evidence.album_name);
            (
                normalize_artist_identity(&evidence.album_artist),
                normalize_album_identity(&analysis.canonical_title),
            )
        })
        .collect::<HashSet<_>>();
    let mut retained_presentations = HashMap::with_capacity(cached_inference.len());
    let mut release_evidence = HashMap::<String, OwnedReleaseEvidence>::with_capacity(
        cached_inference.len().max(affected_album_ids.len()),
    );
    for (album_id, (evidence, presentation)) in cached_inference {
        if current_album_ids.contains(&album_id) && !affected_album_ids.contains(&album_id) {
            release_evidence.insert(album_id.clone(), evidence);
            retained_presentations.insert(album_id, presentation);
        }
    }
    let cached_album_ids = release_evidence.keys().cloned().collect::<HashSet<_>>();
    for album_id in current_album_ids.difference(&cached_album_ids) {
        affected_album_ids.insert(album_id.clone());
    }
    let affected_evidence = prepared_tracks
        .par_iter()
        .filter(|prepared| affected_album_ids.contains(prepared.album_id.as_ref()))
        .fold(
            HashMap::<String, OwnedReleaseEvidence>::new,
            |mut shard, prepared| {
                let parsed = prepared.parsed;
                let evidence = shard
                    .entry(prepared.album_id.to_string())
                    .or_insert_with(|| OwnedReleaseEvidence {
                        album_name: parsed.album.clone(),
                        album_artist: prepared.resolved_album_artist.to_string(),
                        paths: Vec::new(),
                        track_titles: Vec::new(),
                        track_durations: Vec::new(),
                        genres: Vec::new(),
                        release_dates: Vec::new(),
                        directory_years: Vec::new(),
                    });
                evidence
                    .paths
                    .push(prepared.album_grouping_key.release_directory.to_string());
                evidence.track_titles.push(parsed.title.clone());
                evidence.track_durations.push(parsed.duration_seconds);
                evidence
                    .genres
                    .extend(prepared.genres.iter().map(|genre| genre.name.to_string()));
                if let Some(year) = &prepared.release_year {
                    evidence.directory_years.push(year.to_string());
                }
                if !parsed.release_date.is_empty() {
                    evidence.release_dates.push(parsed.release_date.clone());
                }
                shard
            },
        )
        .reduce(HashMap::new, |mut merged, shard| {
            for (album_id, evidence) in shard {
                let target = merged
                    .entry(album_id)
                    .or_insert_with(|| OwnedReleaseEvidence {
                        album_name: evidence.album_name.clone(),
                        album_artist: evidence.album_artist.clone(),
                        paths: Vec::new(),
                        track_titles: Vec::new(),
                        track_durations: Vec::new(),
                        genres: Vec::new(),
                        release_dates: Vec::new(),
                        directory_years: Vec::new(),
                    });
                target.paths.extend(evidence.paths);
                target.track_titles.extend(evidence.track_titles);
                target.track_durations.extend(evidence.track_durations);
                target.genres.extend(evidence.genres);
                target.release_dates.extend(evidence.release_dates);
                target.directory_years.extend(evidence.directory_years);
            }
            merged
        });
    for (album_id, mut evidence) in affected_evidence {
        evidence.paths.sort_unstable();
        evidence.track_titles.sort_unstable();
        evidence.genres.sort_unstable();
        evidence.genres.dedup();
        evidence.release_dates.sort_unstable();
        evidence.directory_years.sort_unstable();
        release_evidence.insert(album_id, evidence);
    }
    if phase == LibraryIndexPhase::Enriched {
        affected_release_groups.extend(
            affected_album_ids
                .iter()
                .filter_map(|album_id| release_evidence.get(album_id))
                .map(|evidence| {
                    let analysis = analyze_release_title(&evidence.album_name);
                    (
                        normalize_artist_identity(&evidence.album_artist),
                        normalize_album_identity(&analysis.canonical_title),
                    )
                }),
        );
        for (album_id, evidence) in &release_evidence {
            let analysis = analyze_release_title(&evidence.album_name);
            if affected_release_groups.contains(&(
                normalize_artist_identity(&evidence.album_artist),
                normalize_album_identity(&analysis.canonical_title),
            )) {
                affected_album_ids.insert(album_id.clone());
            }
        }
    }
    let release_presentations = if phase == LibraryIndexPhase::Enriched {
        let presentations = resolve_release_presentations_for(
            &release_evidence,
            &retained_presentations,
            &affected_album_ids,
        );
        persist_album_inference_cache(
            conn,
            &affected_album_ids,
            &release_evidence,
            &presentations,
        )?;
        presentations
    } else {
        HashMap::new()
    };
    let mut effective_covers = HashMap::<String, String>::with_capacity(track_count);
    if phase == LibraryIndexPhase::Enriched {
        for prepared in prepared_tracks
            .iter()
            .filter(|prepared| !prepared.parsed.cover_url.is_empty())
        {
            effective_covers
                .entry(prepared.album_id.to_string())
                .or_insert_with(|| prepared.parsed.cover_url.clone());
        }
        inherit_original_release_covers(&mut effective_covers, &release_presentations);
    }
    let track_presentations = if phase == LibraryIndexPhase::Enriched {
        resolve_duplicate_tracks(&prepared_tracks, discovered_files)
    } else {
        HashMap::new()
    };
    stage_prepared_tracks(
        conn,
        StagePreparedTracksInputs {
            prepared_tracks: &prepared_tracks,
            release_presentations: &release_presentations,
            track_presentations: &track_presentations,
            effective_covers: &effective_covers,
            artwork_hashes,
            file_ids,
            discovered_files,
            affected_album_ids: &affected_album_ids,
            mode,
            phase,
        },
    )?;

    apply_normalized_stage(conn, mode, phase)?;
    conn.batch_execute(
        "DROP TABLE temp.library_genre_stage;
         DROP TABLE temp.library_rebuild_stage;
         DROP TABLE temp.affected_artist;
         DROP TABLE temp.affected_track;
         DROP TABLE temp.affected_album;",
    )?;
    Ok(())
}

fn apply_normalized_stage(
    conn: &mut SqliteConnection,
    mode: IndexMode,
    phase: LibraryIndexPhase,
) -> QueryResult<()> {
    conn.transaction::<_, diesel::result::Error, _>(|conn| {
        if mode == IndexMode::Repair {
            conn.batch_execute(
                "DELETE FROM library_search_document;
                 DELETE FROM album_genre; DELETE FROM track_genre; DELETE FROM genre_entity;
                 DELETE FROM track_artist; DELETE FROM album_artist; DELETE FROM track_file;",
            )?;
        } else {
            stage_superseded_file_identities(conn)?;
            conn.batch_execute(
                "INSERT OR IGNORE INTO affected_track
                 SELECT id FROM track_entity WHERE album_id IN (SELECT id FROM affected_album);
                 INSERT OR IGNORE INTO affected_artist
                 SELECT artist_id FROM album_artist WHERE album_id IN (SELECT id FROM affected_album);
                 INSERT OR IGNORE INTO affected_artist
                 SELECT artist_id FROM track_artist WHERE track_id IN (SELECT id FROM affected_track);
                 INSERT OR IGNORE INTO affected_artist SELECT album_artist_id FROM library_rebuild_stage;
                 INSERT OR IGNORE INTO affected_artist SELECT track_artist_id FROM library_rebuild_stage;
                 DELETE FROM library_search_document
                 WHERE (entity_type = 'album' AND entity_id IN (SELECT id FROM affected_album))
                    OR (entity_type = 'song' AND entity_id IN (SELECT id FROM affected_track))
                    OR (entity_type = 'artist' AND entity_id IN (SELECT id FROM affected_artist));
                 DELETE FROM album_genre WHERE album_id IN (SELECT id FROM affected_album);
                 DELETE FROM track_genre WHERE track_id IN (SELECT id FROM affected_track);
                 DELETE FROM track_artist WHERE track_id IN (SELECT id FROM affected_track);
                 DELETE FROM album_artist WHERE album_id IN (SELECT id FROM affected_album);
                 DELETE FROM track_file WHERE track_id IN (SELECT id FROM affected_track);",
            )?;
        }
        conn.batch_execute(
            "PRAGMA defer_foreign_keys = ON;
             INSERT INTO artist_entity (id, name, normalized_name)
             SELECT album_artist_id, MIN(album_artist_name), MIN(album_artist_normalized) FROM library_rebuild_stage GROUP BY album_artist_id
             UNION SELECT track_artist_id, MIN(track_artist_name), MIN(track_artist_normalized) FROM library_rebuild_stage GROUP BY track_artist_id
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, normalized_name = excluded.normalized_name, updated_at = CURRENT_TIMESTAMP
             WHERE artist_entity.name IS NOT excluded.name OR artist_entity.normalized_name IS NOT excluded.normalized_name;
             INSERT INTO artwork (id, source, uri, hash)
             SELECT artwork_id, 'local', MIN(artwork_uri), artwork_id
             FROM library_rebuild_stage WHERE artwork_id IS NOT NULL GROUP BY artwork_id
             ON CONFLICT(id) DO UPDATE SET source = excluded.source, uri = excluded.uri, hash = excluded.hash
             WHERE artwork.source IS NOT excluded.source OR artwork.uri IS NOT excluded.uri OR artwork.hash IS NOT excluded.hash;
             INSERT INTO release_group_entity (id, title, normalized_title, primary_type, first_release_date, musicbrainz_id)
             SELECT release_group_id, MIN(release_group_title), MIN(release_group_normalized), MIN(release_group_type),
                    MIN(first_release_date), MIN(album_musicbrainz_id) FROM library_rebuild_stage GROUP BY release_group_id
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, normalized_title = excluded.normalized_title,
                 primary_type = excluded.primary_type, first_release_date = excluded.first_release_date,
                 musicbrainz_id = excluded.musicbrainz_id, updated_at = CURRENT_TIMESTAMP
             WHERE release_group_entity.title IS NOT excluded.title OR release_group_entity.normalized_title IS NOT excluded.normalized_title
                OR release_group_entity.primary_type IS NOT excluded.primary_type
                OR release_group_entity.first_release_date IS NOT excluded.first_release_date
                OR release_group_entity.musicbrainz_id IS NOT excluded.musicbrainz_id;
             INSERT INTO album_entity (id, title, normalized_title, primary_type, artwork_id, release_group_id, release_album_json, first_release_date, musicbrainz_id)
             SELECT album_id, MIN(album_title), MIN(album_normalized), MIN(album_primary_type), MIN(artwork_id), MIN(release_group_id),
                    MIN(release_metadata), MIN(first_release_date), MIN(album_musicbrainz_id) FROM library_rebuild_stage GROUP BY album_id
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, normalized_title = excluded.normalized_title,
                 primary_type = excluded.primary_type, artwork_id = excluded.artwork_id, release_group_id = excluded.release_group_id,
                 release_album_json = excluded.release_album_json, first_release_date = excluded.first_release_date,
                 musicbrainz_id = excluded.musicbrainz_id, updated_at = CURRENT_TIMESTAMP
             WHERE album_entity.title IS NOT excluded.title OR album_entity.normalized_title IS NOT excluded.normalized_title
                OR album_entity.primary_type IS NOT excluded.primary_type OR album_entity.artwork_id IS NOT excluded.artwork_id
                OR album_entity.release_group_id IS NOT excluded.release_group_id OR album_entity.release_album_json IS NOT excluded.release_album_json
                OR album_entity.first_release_date IS NOT excluded.first_release_date OR album_entity.musicbrainz_id IS NOT excluded.musicbrainz_id;
             INSERT INTO recording_entity (id, title, normalized_title, musicbrainz_recording_id, duration_seconds)
             SELECT recording_id, MIN(track_title), MIN(track_normalized), MIN(recording_musicbrainz_id), MAX(duration_seconds) FROM library_rebuild_stage GROUP BY recording_id
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, normalized_title = excluded.normalized_title,
                 musicbrainz_recording_id = excluded.musicbrainz_recording_id, duration_seconds = excluded.duration_seconds,
                 updated_at = CURRENT_TIMESTAMP
             WHERE recording_entity.title IS NOT excluded.title OR recording_entity.normalized_title IS NOT excluded.normalized_title
                OR recording_entity.musicbrainz_recording_id IS NOT excluded.musicbrainz_recording_id
                OR recording_entity.duration_seconds IS NOT excluded.duration_seconds;
             INSERT INTO track_entity (id, title, normalized_title, album_id, recording_id, track_number, disc_number, duration_seconds, musicbrainz_recording_id)
             SELECT track_id, MIN(track_title), MIN(track_normalized), MIN(album_id), MIN(recording_id), MIN(track_number), MIN(disc_number),
                    MAX(duration_seconds), MIN(recording_musicbrainz_id) FROM library_rebuild_stage GROUP BY track_id
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, normalized_title = excluded.normalized_title,
                 album_id = excluded.album_id, recording_id = excluded.recording_id, track_number = excluded.track_number,
                 disc_number = excluded.disc_number, duration_seconds = excluded.duration_seconds,
                 musicbrainz_recording_id = excluded.musicbrainz_recording_id, updated_at = CURRENT_TIMESTAMP
             WHERE track_entity.title IS NOT excluded.title OR track_entity.normalized_title IS NOT excluded.normalized_title
                OR track_entity.album_id IS NOT excluded.album_id OR track_entity.recording_id IS NOT excluded.recording_id
                OR track_entity.track_number IS NOT excluded.track_number OR track_entity.disc_number IS NOT excluded.disc_number
                OR track_entity.duration_seconds IS NOT excluded.duration_seconds
                OR track_entity.musicbrainz_recording_id IS NOT excluded.musicbrainz_recording_id;
             INSERT INTO song (id) SELECT DISTINCT track_id FROM library_rebuild_stage WHERE true ON CONFLICT(id) DO NOTHING;
             INSERT INTO album_artist (album_id, artist_id, position, role) SELECT DISTINCT album_id, album_artist_id, 0, 'primary' FROM library_rebuild_stage WHERE true
             ON CONFLICT(album_id, artist_id, role) DO UPDATE SET position = excluded.position;
             INSERT INTO track_artist (track_id, artist_id, position, role) SELECT DISTINCT track_id, track_artist_id, 0, 'primary' FROM library_rebuild_stage WHERE true
             ON CONFLICT(track_id, artist_id, role) DO UPDATE SET position = excluded.position;
             INSERT INTO track_file (track_id, file_id, quality_rank, is_primary)
             SELECT track_id, file_id, MAX(quality_rank), true FROM library_rebuild_stage WHERE file_id IS NOT NULL GROUP BY track_id, file_id
             ON CONFLICT(track_id, file_id) DO UPDATE SET quality_rank = excluded.quality_rank;
             INSERT INTO genre_entity (name, normalized_name) SELECT MIN(name), normalized_name FROM library_genre_stage GROUP BY normalized_name
             ON CONFLICT(normalized_name) DO UPDATE SET name = excluded.name;
             INSERT INTO track_genre SELECT DISTINCT stage.track_id, genre.id FROM library_genre_stage stage JOIN genre_entity genre USING(normalized_name)
             ON CONFLICT(track_id, genre_id) DO NOTHING;
             INSERT INTO album_genre SELECT DISTINCT stage.album_id, genre.id FROM library_genre_stage stage JOIN genre_entity genre USING(normalized_name)
             ON CONFLICT(album_id, genre_id) DO NOTHING;
             INSERT INTO library_search_document (entity_type, entity_id, title, subtitle, artwork_uri, normalized_text, keywords)
             SELECT 'artist', album_artist_id, MIN(album_artist_name), 'Artist', '', MIN(album_artist_normalized), MIN(album_artist_normalized) FROM library_rebuild_stage GROUP BY album_artist_id
             UNION SELECT 'artist', track_artist_id, MIN(track_artist_name), 'Artist', '', MIN(track_artist_normalized), MIN(track_artist_normalized) FROM library_rebuild_stage GROUP BY track_artist_id
             UNION SELECT 'album', album_id, MIN(album_title), MIN(album_artist_name), MIN(artwork_uri), MIN(album_search_text), MIN(album_search_text) FROM library_rebuild_stage GROUP BY album_id
             UNION SELECT 'song', track_id, MIN(track_title), MIN(song_subtitle), MIN(artwork_uri), MIN(song_search_text), MIN(song_search_text) FROM library_rebuild_stage GROUP BY track_id
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle,
                 artwork_uri = excluded.artwork_uri, normalized_text = excluded.normalized_text, keywords = excluded.keywords,
                 updated_at = CURRENT_TIMESTAMP;"
        )?;
        if mode == IndexMode::Repair {
            conn.batch_execute(
                "DELETE FROM track_entity WHERE id NOT IN (SELECT track_id FROM library_rebuild_stage);
                 DELETE FROM recording_entity WHERE id NOT IN (SELECT recording_id FROM library_rebuild_stage);
                 DELETE FROM album_inference_cache WHERE album_id NOT IN (SELECT album_id FROM library_rebuild_stage);
                 DELETE FROM album_entity WHERE id NOT IN (SELECT album_id FROM library_rebuild_stage);
                 DELETE FROM release_group_entity WHERE id NOT IN (SELECT release_group_id FROM library_rebuild_stage);
                 DELETE FROM artist_entity WHERE id NOT IN (SELECT album_artist_id FROM library_rebuild_stage UNION SELECT track_artist_id FROM library_rebuild_stage);
                 DELETE FROM artwork WHERE id NOT IN (SELECT artwork_id FROM library_rebuild_stage WHERE artwork_id IS NOT NULL);",
            )?;
        } else {
            conn.batch_execute(
                "DELETE FROM track_entity
                 WHERE id IN (SELECT id FROM affected_track) AND id NOT IN (SELECT track_id FROM library_rebuild_stage);
                 DELETE FROM album_entity
                 WHERE id IN (SELECT id FROM affected_album) AND id NOT IN (SELECT album_id FROM library_rebuild_stage);
                 DELETE FROM recording_entity WHERE NOT EXISTS (SELECT 1 FROM track_entity WHERE recording_id = recording_entity.id);
                 DELETE FROM release_group_entity WHERE NOT EXISTS (SELECT 1 FROM album_entity WHERE release_group_id = release_group_entity.id);
                 DELETE FROM artist_entity
                 WHERE NOT EXISTS (SELECT 1 FROM album_artist WHERE artist_id = artist_entity.id)
                   AND NOT EXISTS (SELECT 1 FROM track_artist WHERE artist_id = artist_entity.id);
                 DELETE FROM genre_entity
                 WHERE NOT EXISTS (SELECT 1 FROM album_genre WHERE genre_id = genre_entity.id)
                   AND NOT EXISTS (SELECT 1 FROM track_genre WHERE genre_id = genre_entity.id);
                 DELETE FROM artwork
                 WHERE NOT EXISTS (SELECT 1 FROM album_entity WHERE artwork_id = artwork.id)
                   AND NOT EXISTS (SELECT 1 FROM artist_entity WHERE artwork_id = artwork.id);
                 DELETE FROM metadata_task
                 WHERE (entity_type = 'artist' AND NOT EXISTS (SELECT 1 FROM artist_entity WHERE id = metadata_task.entity_id))
                    OR (entity_type = 'album' AND NOT EXISTS (SELECT 1 FROM album_entity WHERE id = metadata_task.entity_id))
                    OR (entity_type = 'track' AND NOT EXISTS (SELECT 1 FROM track_entity WHERE id = metadata_task.entity_id));
                 INSERT INTO library_search_document
                     (entity_type, entity_id, title, subtitle, artwork_uri, normalized_text, keywords)
                 SELECT 'artist', id, name, 'Artist', '', normalized_name, normalized_name
                 FROM artist_entity WHERE id IN (SELECT id FROM affected_artist)
                 ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                     title = excluded.title, subtitle = excluded.subtitle,
                     artwork_uri = excluded.artwork_uri, normalized_text = excluded.normalized_text,
                     keywords = excluded.keywords, updated_at = CURRENT_TIMESTAMP;",
            )?;
        }
        if phase == LibraryIndexPhase::Enriched {
            conn.batch_execute(
                "INSERT INTO metadata_task (provider, entity_type, entity_id)
                 SELECT 'musicbrainz', 'artist', album_artist_id FROM library_rebuild_stage
                 UNION SELECT 'musicbrainz', 'artist', track_artist_id FROM library_rebuild_stage
                 UNION SELECT 'musicbrainz', 'album', album_id FROM library_rebuild_stage
                 UNION SELECT 'musicbrainz', 'track', track_id FROM library_rebuild_stage WHERE true
                 ON CONFLICT(provider, entity_type, entity_id) DO NOTHING;"
            )?;
            conn.batch_execute(
                "DELETE FROM artist_alias WHERE source = 'indexer';
                 INSERT INTO artist_alias (artist_id, alias, normalized_alias, source)
                 SELECT canonical.id, decision.alias_name, decision.normalized_alias, 'indexer'
                 FROM artist_alias_decision decision
                 JOIN artist_entity canonical
                   ON canonical.normalized_name = decision.canonical_normalized
                 WHERE true
                 ON CONFLICT(artist_id, normalized_alias) DO UPDATE SET
                    alias = excluded.alias, source = excluded.source;",
            )?;
        }
        let primary_scope = if mode == IndexMode::Repair {
            ""
        } else {
            " WHERE candidate.track_id IN (SELECT track_id FROM library_rebuild_stage)"
        };
        diesel::sql_query(format!("UPDATE track_file AS candidate SET is_primary = candidate.file_id = (
            SELECT preferred.file_id FROM track_file preferred WHERE preferred.track_id = candidate.track_id
            ORDER BY preferred.quality_rank DESC, preferred.file_id ASC LIMIT 1){primary_scope}"))
            .execute(conn)?;
        diesel::sql_query("INSERT INTO playlist_track (playlist_id, track_id, date_added, added_by, position)
            SELECT pts.a, pts.b, pts.date_added, pts.added_by, pts.position FROM _playlist_to_song pts
            JOIN track_entity t ON t.id = pts.b WHERE true ON CONFLICT(playlist_id, track_id) DO NOTHING").execute(conn)?;
        Ok(())
    })?;
    Ok(())
}

/// Adds normalized identities that were previously attached to a staged file to
/// the incremental cleanup scope. Enrichment can change both album and track IDs
/// (for example, after resolving a release-level album artist), while the file ID
/// remains stable. Without following that stable edge, the available-phase
/// identities survive beside their enriched replacements.
fn stage_superseded_file_identities(conn: &mut SqliteConnection) -> QueryResult<()> {
    conn.batch_execute(
        "INSERT OR IGNORE INTO affected_track
         SELECT DISTINCT existing.track_id
         FROM track_file existing
         JOIN library_rebuild_stage staged ON staged.file_id = existing.file_id
         WHERE existing.track_id IS NOT staged.track_id;
         INSERT OR IGNORE INTO affected_album
         SELECT DISTINCT track.album_id
         FROM track_entity track
         JOIN affected_track affected ON affected.id = track.id
         WHERE track.album_id IS NOT NULL;",
    )
}

fn finish_scan_job_counts(
    conn: &mut SqliteConnection,
    scan_job_id: i32,
    scanned_files: usize,
    indexed_files: usize,
    reused_files: usize,
    warning_count: usize,
) -> QueryResult<()> {
    diesel::sql_query(format!(
        "UPDATE library_scan_job
         SET status = 'completed',
             finished_at = CURRENT_TIMESTAMP,
             discovered_files = {},
             parsed_files = {},
             reused_files = {},
             indexed_tracks = {},
             warnings_count = {},
             message = 'Library index completed'
         WHERE id = {}",
        scanned_files,
        indexed_files,
        reused_files,
        indexed_files + reused_files,
        warning_count,
        scan_job_id,
    ))
    .execute(conn)?;
    Ok(())
}

fn drop_first_import_secondary_indexes(conn: &mut SqliteConnection) -> QueryResult<()> {
    conn.batch_execute(
        "DROP INDEX IF EXISTS idx_file_entry_root;
         DROP INDEX IF EXISTS idx_file_entry_fingerprint;
         DROP INDEX IF EXISTS idx_file_entry_last_seen;
         DROP INDEX IF EXISTS idx_artist_entity_normalized;
         DROP INDEX IF EXISTS idx_album_entity_normalized;
         DROP INDEX IF EXISTS idx_track_entity_album;
         DROP INDEX IF EXISTS idx_track_entity_normalized;
         DROP INDEX IF EXISTS idx_library_search_text;
         DROP INDEX IF EXISTS idx_recording_normalized;
         DROP INDEX IF EXISTS idx_release_group_normalized;
         DROP INDEX IF EXISTS idx_metadata_task_status;
         -- Relationship indexes stay live: normalization performs orphan
         -- cleanup through them before secondary indexes are recreated.
         -- Dropping them makes a first import quadratic.",
    )
}

fn create_first_import_secondary_indexes(conn: &mut SqliteConnection) -> QueryResult<()> {
    conn.batch_execute(
        "CREATE INDEX IF NOT EXISTS idx_file_entry_root ON file_entry(root_id);
         CREATE INDEX IF NOT EXISTS idx_file_entry_fingerprint ON file_entry(path, size_bytes, modified_at_ns);
         CREATE INDEX IF NOT EXISTS idx_file_entry_last_seen ON file_entry(last_seen_scan_id);
         CREATE INDEX IF NOT EXISTS idx_artist_entity_normalized ON artist_entity(normalized_name);
         CREATE INDEX IF NOT EXISTS idx_album_entity_normalized ON album_entity(normalized_title);
         CREATE INDEX IF NOT EXISTS idx_track_entity_album ON track_entity(album_id, disc_number, track_number);
         CREATE INDEX IF NOT EXISTS idx_track_entity_normalized ON track_entity(normalized_title);
         CREATE INDEX IF NOT EXISTS idx_track_file_primary ON track_file(track_id, is_primary);
         CREATE INDEX IF NOT EXISTS idx_album_artist_artist ON album_artist(artist_id);
         CREATE INDEX IF NOT EXISTS idx_track_artist_artist ON track_artist(artist_id);
         CREATE INDEX IF NOT EXISTS idx_library_search_text ON library_search_document(normalized_text);
         CREATE INDEX IF NOT EXISTS idx_recording_normalized ON recording_entity(normalized_title);
         CREATE INDEX IF NOT EXISTS idx_release_group_normalized ON release_group_entity(normalized_title);
         CREATE INDEX IF NOT EXISTS idx_metadata_task_status ON metadata_task(status, not_before);
         CREATE INDEX IF NOT EXISTS idx_album_entity_release_group ON album_entity(release_group_id);
         CREATE INDEX IF NOT EXISTS idx_track_entity_recording ON track_entity(recording_id);",
    )
}

fn collect_scan_warnings(parsed_files: &[ParsedFile]) -> (usize, Vec<LibraryIndexWarning>) {
    let warning_count = parsed_files
        .iter()
        .filter(|parsed| parsed.error.is_some())
        .count();
    let details = parsed_files
        .iter()
        .filter_map(|parsed| {
            parsed.error.as_ref().map(|message| LibraryIndexWarning {
                path: parsed.path.to_string(),
                message: message.clone(),
            })
        })
        .take(MAX_WARNING_DETAILS)
        .collect();
    (warning_count, details)
}

struct ParsedChangeBatch {
    files: Vec<ParsedFile>,
    threads: usize,
    storage_seek_penalty: Option<bool>,
    wall_us: u64,
    enumeration_overlap_us: u64,
    database_staging_us: u64,
    database_overlap_us: u64,
    bytes_read: u64,
    bytes_read_p50: u64,
    bytes_read_p95: u64,
    file_opens: u64,
    read_calls: u64,
    seeks: u64,
    parser_fallbacks: u64,
    tag_parsing_us: u64,
    duration_us: u64,
}

fn parse_changed_files(
    path_to_library: &str,
    changed: &[&DiscoveredFile],
    local_covers: &HashMap<&str, String>,
    snapshots_by_path: &HashMap<&str, &ExistingFileSnapshot>,
    cold_parse: Option<ColdParseResult>,
    cancellation: &ScanCancellation,
) -> Result<ParsedChangeBatch, Box<dyn Error + Send + Sync>> {
    let (default_threads, storage_seek_penalty) = parse_thread_count(Path::new(path_to_library));
    let explicit_threads = std::env::var("PARSON_PARSE_THREADS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .is_some();
    let (
        mut files,
        threads,
        autotuned,
        wall_us,
        enumeration_overlap_us,
        database_staging_us,
        database_overlap_us,
    ) = if let Some(cold_parse) = cold_parse {
        info!(
            parsing_wall_us = cold_parse.wall_us,
            files = cold_parse.parsed.len(),
            "cold metadata parsing overlapped filesystem enumeration"
        );
        (
            cold_parse.parsed,
            cold_parse.threads,
            cold_parse.autotuned,
            cold_parse.wall_us,
            cold_parse.enumeration_overlap_us,
            cold_parse.database_staging_us,
            cold_parse.parsing_staging_overlap_us,
        )
    } else {
        let started = Instant::now();
        let tuned = parse_autotuned_prefix(
            changed,
            local_covers,
            default_threads,
            changed.len() >= 10_000 && !explicit_threads,
        )?;
        let threads = tuned.threads;
        let autotuned = tuned.autotuned;
        let parsed_prefix = tuned.parsed_prefix;
        let mut parsed = tuned.parsed;
        parsed.reserve(changed.len().saturating_sub(parsed_prefix));
        for batch in changed[parsed_prefix..].chunks(512) {
            if cancellation.is_cancelled() {
                break;
            }
            parsed.extend(parse_file_batch_with_cancellation(
                batch,
                local_covers,
                threads,
                Some(cancellation),
            )?);
        }
        (
            parsed,
            threads,
            autotuned,
            elapsed_us(started.elapsed()),
            0,
            0,
            0,
        )
    };

    for parsed in &mut files {
        if parsed.cover_url.is_empty()
            && let Some(previous_cover) = snapshots_by_path
                .get(parsed.path.as_ref())
                .and_then(|snapshot| snapshot.cover_url.as_deref())
                .filter(|cover| !cover.is_empty())
        {
            parsed.cover_url = previous_cover.to_string();
        }
    }

    let tag_parsing_us = files.iter().map(|parsed| parsed.tag_parse_us).sum();
    let duration_us = files.iter().map(|parsed| parsed.duration_us).sum();
    let bytes_read = files.iter().map(|parsed| parsed.bytes_read).sum();
    let mut bytes_read_distribution = files
        .iter()
        .map(|parsed| parsed.bytes_read)
        .collect::<Vec<_>>();
    bytes_read_distribution.sort_unstable();
    let percentile = |percent: usize| {
        if bytes_read_distribution.is_empty() {
            0
        } else {
            bytes_read_distribution[(bytes_read_distribution.len() - 1) * percent / 100]
        }
    };
    let bytes_read_p50 = percentile(50);
    let bytes_read_p95 = percentile(95);
    let file_opens = files.iter().map(|parsed| parsed.file_opens).sum();
    let read_calls = files.iter().map(|parsed| parsed.read_calls).sum();
    let seeks = files.iter().map(|parsed| parsed.seeks).sum();
    let parser_fallbacks = files.iter().map(|parsed| parsed.parser_fallbacks).sum();
    let mut fallback_reasons = BTreeMap::<&str, usize>::new();
    let mut format_timings = BTreeMap::<
        String,
        (
            usize,
            u64,
            u64,
            usize,
            BTreeMap<&'static str, (usize, u64, u64)>,
        ),
    >::new();
    for parsed in &files {
        if let Some(reason) = parsed.fast_path_error.as_deref() {
            *fallback_reasons.entry(reason).or_default() += 1;
        }
        let extension = Path::new(parsed.path.as_ref())
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("unknown")
            .to_ascii_lowercase();
        let timing = format_timings.entry(extension).or_default();
        timing.0 += 1;
        timing.1 = timing.1.saturating_add(parsed.tag_parse_us);
        timing.2 = timing.2.saturating_add(parsed.duration_us);
        timing.3 += usize::from(parsed.error.is_some());
        let strategy = timing.4.entry(parsed.parse_strategy.as_str()).or_default();
        strategy.0 += 1;
        strategy.1 = strategy.1.saturating_add(parsed.tag_parse_us);
        strategy.2 = strategy.2.saturating_add(parsed.duration_us);
    }
    info!(
        parsing_wall_us = wall_us,
        parse_threads = threads,
        autotuned,
        storage_seek_penalty,
        aggregate_tag_us = tag_parsing_us,
        aggregate_duration_us = duration_us,
        fallback_reasons = ?fallback_reasons,
        files = files.len(),
        "library parallel parsing completed"
    );
    for (extension, (files, aggregate_tag_us, aggregate_duration_us, errors, strategies)) in
        format_timings
    {
        info!(
            extension,
            files,
            aggregate_tag_us,
            aggregate_duration_us,
            errors,
            strategies = ?strategies,
            "library format parsing timings"
        );
    }

    Ok(ParsedChangeBatch {
        files,
        threads,
        storage_seek_penalty,
        wall_us,
        enumeration_overlap_us,
        database_staging_us,
        database_overlap_us,
        bytes_read,
        bytes_read_p50,
        bytes_read_p95,
        file_opens,
        read_calls,
        seeks,
        parser_fallbacks,
        tag_parsing_us,
        duration_us,
    })
}

struct CatalogImportInputs<'a> {
    projection_unchanged: bool,
    core_identity_changed: bool,
    genuine_large_first_import: bool,
    cold_stream_staged: bool,
    root_id: i32,
    scan_job_id: i32,
    core_library: &'a LibraryRegistration,
    discovered: &'a [DiscoveredFile],
    indexed_files: usize,
    reused_count: usize,
    warning_count: usize,
    cancellation: &'a ScanCancellation,
    parsed_files: &'a mut ScanRecordArena<ParsedFile>,
    changed_paths: &'a HashSet<&'a str>,
    discovered_by_path: &'a HashMap<&'a str, &'a DiscoveredFile>,
    artwork_hashes: &'a HashMap<String, String>,
    phase: LibraryIndexPhase,
    mode: IndexMode,
}

struct CatalogImportTiming {
    database_staging_us: u64,
    normalization_inference_us: u64,
}

fn stage_catalog_import(
    conn: &mut SqliteConnection,
    inputs: CatalogImportInputs<'_>,
    initial_database_staging_us: u64,
) -> QueryResult<CatalogImportTiming> {
    let CatalogImportInputs {
        projection_unchanged,
        core_identity_changed,
        genuine_large_first_import,
        cold_stream_staged,
        root_id,
        scan_job_id,
        core_library,
        discovered,
        indexed_files,
        reused_count,
        warning_count,
        cancellation,
        parsed_files,
        changed_paths,
        discovered_by_path,
        artwork_hashes,
        phase,
        mode,
    } = inputs;
    let staging_started = Instant::now();
    let mut database_staging_us = initial_database_staging_us;
    let mut normalization_inference_us = 0;

    if projection_unchanged && !core_identity_changed {
        // Advance scan ownership directly for unchanged inventories.
        diesel::sql_query(
            "UPDATE music_file_reference SET last_seen_scan_id = ?
             WHERE core_library_id = ? AND last_seen_scan_id IS NOT ?",
        )
        .bind::<Integer, _>(scan_job_id)
        .bind::<Text, _>(core_library.id.as_str())
        .bind::<Integer, _>(scan_job_id)
        .execute(conn)?;
        diesel::sql_query(
            "UPDATE file_entry SET last_seen_scan_id = ?
             WHERE root_id = ? AND last_seen_scan_id IS NOT ?",
        )
        .bind::<Integer, _>(scan_job_id)
        .bind::<Integer, _>(root_id)
        .bind::<Integer, _>(scan_job_id)
        .execute(conn)?;
        diesel::sql_query(
            "UPDATE directory_scan_state SET last_seen_scan_id = ?
             WHERE root_id = ? AND last_seen_scan_id IS NOT ?",
        )
        .bind::<Integer, _>(scan_job_id)
        .bind::<Integer, _>(root_id)
        .bind::<Integer, _>(scan_job_id)
        .execute(conn)?;
        database_staging_us =
            database_staging_us.saturating_add(elapsed_us(staging_started.elapsed()));
        finish_scan_job_counts(
            conn,
            scan_job_id,
            discovered.len(),
            indexed_files,
            reused_count,
            warning_count,
        )?;
        return Ok(CatalogImportTiming {
            database_staging_us,
            normalization_inference_us,
        });
    }

    if genuine_large_first_import {
        // Keep index removal and recreation in the import transaction.
        drop_first_import_secondary_indexes(conn)?;
    }
    diesel::sql_query("PRAGMA defer_foreign_keys = ON").execute(conn)?;
    info!(files = discovered.len(), "staging core file references");
    sync_core_file_references(conn, core_library, scan_job_id, discovered).map_err(|error| {
        warn!(%error, "core file reference staging failed");
        error
    })?;
    info!("core file references staged");
    conn.batch_execute(
        "DROP TABLE IF EXISTS temp.current_scan_path;
         DROP TABLE IF EXISTS temp.changed_scan_path;
         CREATE TEMP TABLE current_scan_path (path TEXT PRIMARY KEY) WITHOUT ROWID;
         CREATE TEMP TABLE changed_scan_path (path TEXT PRIMARY KEY) WITHOUT ROWID;",
    )?;
    stage_current_scan_paths(conn, discovered)?;
    let parsed_by_path = parsed_files
        .iter()
        .enumerate()
        .map(|(index, parsed)| (parsed.path.as_ref(), index))
        .collect::<HashMap<_, _>>();
    let parsed_by_path = parsed_by_path
        .iter()
        .filter_map(|(path, index)| parsed_files.get(*index).map(|parsed| (*path, parsed)))
        .collect::<HashMap<_, _>>();
    for batch in discovered.chunks(DATABASE_BATCH_SIZE) {
        if cancellation.is_cancelled() {
            return Err(diesel::result::Error::RollbackTransaction);
        }
        persist_file_metadata_batch(
            conn,
            batch,
            &parsed_by_path,
            PersistFileMetadataContext {
                root_id,
                scan_job_id,
                changed_paths,
                phase,
                stream_staged: cold_stream_staged,
            },
        )
        .map_err(|error| {
            warn!(%error, "file metadata staging failed");
            error
        })?;
    }
    info!("file metadata staged");
    if cancellation.is_cancelled() {
        return Err(diesel::result::Error::RollbackTransaction);
    }

    persist_directory_scan_state(conn, root_id, scan_job_id, discovered).map_err(|error| {
        warn!(%error, "directory state staging failed");
        error
    })?;
    diesel::sql_query(
        "UPDATE file_entry SET availability = 'missing', updated_at = CURRENT_TIMESTAMP
         WHERE root_id = ? AND availability IS NOT 'missing'
           AND NOT EXISTS (SELECT 1 FROM current_scan_path WHERE path = file_entry.path)",
    )
    .bind::<Integer, _>(root_id)
    .execute(conn)?;

    if !projection_unchanged {
        // Rebuild from every root in a multi-root library.
        let available = all_available_snapshots(conn)?;
        let mut all_file_ids = HashMap::with_capacity(available.len());
        for snapshot in available {
            all_file_ids.insert(snapshot.path.clone(), snapshot.file_id);
            if !discovered_by_path.contains_key(snapshot.path.as_str()) {
                parsed_files.push(snapshot_to_parsed(&snapshot));
            }
        }
        database_staging_us =
            database_staging_us.saturating_add(elapsed_us(staging_started.elapsed()));
        let normalization_started = Instant::now();
        reconcile_normalized_tables(
            conn,
            ReconcileInputs {
                root_id,
                parsed_files,
                file_ids: &all_file_ids,
                discovered_files: discovered_by_path,
                artwork_hashes,
                phase,
                mode,
                changed_paths,
            },
        )
        .map_err(|error| {
            warn!(%error, "normalized catalog staging failed");
            error
        })?;
        normalization_inference_us = elapsed_us(normalization_started.elapsed());
    } else {
        database_staging_us =
            database_staging_us.saturating_add(elapsed_us(staging_started.elapsed()));
    }
    conn.batch_execute(
        "DROP TABLE temp.changed_scan_path;
         DROP TABLE temp.current_scan_path;
         DROP TABLE IF EXISTS temp.cold_parsed_stage;",
    )?;
    if genuine_large_first_import {
        create_first_import_secondary_indexes(conn)?;
        diesel::sql_query("ANALYZE").execute(conn)?;
    }
    finish_scan_job_counts(
        conn,
        scan_job_id,
        discovered.len(),
        indexed_files,
        reused_count,
        warning_count,
    )?;
    Ok(CatalogImportTiming {
        database_staging_us,
        normalization_inference_us,
    })
}

fn log_scan_timing(timing: &LibraryIndexTiming) {
    info!(
        run_kind = timing.run_kind.as_str(),
        enumeration_us = timing.enumeration_us,
        parsing_wall_us = timing.parsing_wall_us,
        parsing_enumeration_overlap_us = timing.parsing_enumeration_overlap_us,
        parsing_enumeration_overlap_percent = timing.parsing_enumeration_overlap_percent,
        parsing_database_overlap_us = timing.parsing_database_overlap_us,
        parsing_database_overlap_percent = timing.parsing_database_overlap_percent,
        bytes_read = timing.bytes_read,
        bytes_read_p50 = timing.bytes_read_p50,
        bytes_read_p95 = timing.bytes_read_p95,
        file_opens = timing.file_opens,
        metadata_operations = timing.metadata_operations,
        read_calls = timing.read_calls,
        seeks = timing.seeks,
        parser_fallbacks = timing.parser_fallbacks,
        parser_threads = timing.parser_threads,
        storage_queue_depth = timing.storage_queue_depth,
        cpu_time_us = timing.cpu_time_us,
        cpu_utilization_percent = timing.cpu_utilization_percent,
        unchanged_detection_us = timing.unchanged_detection_us,
        cover_discovery_us = timing.cover_discovery_us,
        tag_parsing_us = timing.tag_parsing_us,
        duration_us = timing.duration_us,
        files_requiring_frame_scans = timing.files_requiring_frame_scans,
        database_staging_us = timing.database_staging_us,
        database_commit_us = timing.database_commit_us,
        normalization_inference_us = timing.normalization_inference_us,
        full_library_export_us = timing.full_library_export_us,
        snapshot_integrity_us = ?timing.snapshot_integrity_us,
        explained_wall_us = timing.explained_wall_us,
        explained_wall_percent = timing.explained_wall_percent,
        unattributed_wall_us = timing.unattributed_wall_us,
        total_us = timing.total_us,
        "library scan phase timings"
    );
}

fn index_library_to_database_phase(
    path_to_library: &str,
    phase: LibraryIndexPhase,
    mode: IndexMode,
    cancellation: &ScanCancellation,
    progress: Option<CatalogProgressSender>,
) -> Result<(Vec<Artist>, LibraryIndexReport), Box<dyn Error + Send + Sync>> {
    let total_started = Instant::now();
    let cpu_started = process_cpu_time_us();
    // Load the snapshot first so parsing can overlap discovery.
    let pool = connect()?;
    let mut conn = pool.get()?;
    type SqliteTransactionManager = <PooledSqliteConnection as Connection>::TransactionManager;
    SqliteTransactionManager::begin_transaction(&mut conn)?;
    let unchanged_lookup_started = Instant::now();
    let root_id = upsert_library_root(&mut conn, path_to_library)?;
    let prior_available_files = available_file_count(&mut conn)?;
    let snapshots = existing_snapshots(&mut conn, root_id)?;
    let unchanged_lookup_us = elapsed_us(unchanged_lookup_started.elapsed());

    let streaming_enabled = std::env::var("PARSON_STREAMING_COLD_PARSE")
        .ok()
        .map(|value| {
            !matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "0" | "false" | "no" | "off"
            )
        })
        .unwrap_or(true);
    let pipeline_candidate = streaming_enabled
        && mode == IndexMode::Incremental
        && phase == LibraryIndexPhase::Available
        && snapshots.is_empty()
        && prior_available_files == 0;
    let cold_stream_staged = pipeline_candidate;
    let enumeration_started = Instant::now();
    let (inventory, cold_parse, enumeration_us) = if pipeline_candidate {
        let mut pipeline = ColdParsePipeline::new_with_progress(
            Path::new(path_to_library),
            conn,
            progress.clone(),
            cancellation.clone(),
        )?;
        let mut pipeline_error = None;
        let mut callback = |file: &crate::library::discovery::DiscoveredFile| {
            if !cancellation.is_cancelled()
                && pipeline_error.is_none()
                && let Err(error) = pipeline.push(file.clone())
            {
                pipeline_error = Some(error);
            }
        };
        let (raw, _initial_walk) = crate::library::discovery::discover_incremental_streaming(
            Path::new(path_to_library),
            &mut callback,
        );
        let enumeration_us = elapsed_us(enumeration_started.elapsed());
        if let Some(error) = pipeline_error {
            return Err(error.into());
        }
        let inventory = adapt_discovered_files(raw);
        let mut parsed = pipeline.finish(&inventory.audio_files)?;
        conn = parsed
            .connection
            .take()
            .expect("cold parser returns its SQLite connection");
        (inventory, Some(parsed), enumeration_us)
    } else {
        let inventory = if mode == IndexMode::Repair {
            reconcile_files(path_to_library)
        } else {
            discover_files(path_to_library)
        };
        (inventory, None, elapsed_us(enumeration_started.elapsed()))
    };
    if cancellation.is_cancelled() {
        let _ = SqliteTransactionManager::rollback_transaction(&mut conn);
        return Err(std::io::Error::new(
            std::io::ErrorKind::Interrupted,
            "Library scan was replaced by a newer request",
        )
        .into());
    }
    let discovered = inventory.audio_files.as_slice();
    let genuine_large_first_import = discovered.len() >= 5_000 && prior_available_files == 0;
    if discovered.is_empty() && snapshots.is_empty() {
        let _ = SqliteTransactionManager::rollback_transaction(&mut conn);
        return Err(
            std::io::Error::other("The selected folder contains no supported audio files").into(),
        );
    }
    // Register only validated roots with Core.
    let core_library = crate::product::register_library_root(Path::new(path_to_library))?;
    let scan_job_id = create_scan_job(&mut conn, root_id)?;
    let snapshots_by_path = snapshots
        .iter()
        .map(|snapshot| (snapshot.path.as_str(), snapshot))
        .collect::<HashMap<_, _>>();
    let discovered_paths = discovered
        .iter()
        .map(|file| file.path.as_ref())
        .collect::<HashSet<_>>();

    // Resolve art from the walk inventory and persistent signature cache.
    let cover_started = Instant::now();
    info!(phase = ?phase, "resolving library covers");
    let album_covers = if phase == LibraryIndexPhase::Enriched {
        resolve_local_covers(&mut conn, &inventory, mode != IndexMode::Repair)?
    } else {
        HashMap::new()
    };
    let preferred_covers = album_covers
        .values()
        .filter(|cover| cover.preferred && !cover.path.is_empty())
        .count();
    let fallback_covers = album_covers
        .values()
        .filter(|cover| !cover.preferred && !cover.path.is_empty())
        .count();
    let missing_covers = album_covers
        .values()
        .filter(|cover| cover.path.is_empty())
        .count();
    info!(
        preferred_covers,
        fallback_covers, missing_covers, "library covers resolved"
    );
    let local_covers = discovered
        .iter()
        .map(|file| {
            let directory = album_directory(&file.native_directory);
            (
                file.directory.as_ref(),
                album_covers
                    .get(directory)
                    .filter(|cover| cover.preferred)
                    .map(|cover| cover.path.clone())
                    .unwrap_or_default(),
            )
        })
        .collect::<HashMap<_, _>>();
    let fallback_local_covers = discovered
        .iter()
        .filter_map(|file| {
            let directory = album_directory(&file.native_directory);
            album_covers
                .get(directory)
                .filter(|cover| !cover.preferred && !cover.path.is_empty())
                .map(|cover| (file.directory.as_ref(), cover.path.clone()))
        })
        .collect::<HashMap<_, _>>();
    let mut cover_discovery_us = elapsed_us(cover_started.elapsed());

    let unchanged_detection_started = Instant::now();
    let mut snapshots_by_identity = snapshots
        .iter()
        .filter(|snapshot| snapshot.parser_version.as_deref() == Some(phase.parser_version()))
        .filter(|snapshot| !discovered_paths.contains(snapshot.path.as_str()))
        .filter_map(|snapshot| snapshot.stable_identity.as_deref().map(|id| (id, snapshot)))
        .collect::<HashMap<_, _>>();
    let mut snapshots_by_fingerprint = snapshots
        .iter()
        .filter(|snapshot| {
            snapshot.stable_identity.is_none()
                && !discovered_paths.contains(snapshot.path.as_str())
                && snapshot.parser_version.as_deref() == Some(phase.parser_version())
        })
        .map(|snapshot| {
            (
                (
                    snapshot.size_bytes,
                    snapshot.modified_at_ns,
                    snapshot.tag_fingerprint.as_deref(),
                ),
                snapshot,
            )
        })
        .collect::<HashMap<_, _>>();

    let mut reused = Vec::new();
    let mut changed = Vec::new();
    let mut artwork_changed_paths = HashSet::new();

    for file in discovered {
        if let Some(snapshot) = snapshots_by_path.get(file.path.as_ref())
            && raw_metadata_reusable(snapshot, file, phase)
        {
            let mut parsed = snapshot_to_parsed(snapshot);
            let resolver_changed =
                snapshot.cover_resolver_version.as_deref() != Some(COVER_RESOLVER_VERSION);
            let local_cover = local_covers
                .get(file.directory.as_ref())
                .cloned()
                .unwrap_or_default();
            if reconcile_reused_cover(
                &mut parsed,
                local_cover,
                mode == IndexMode::Repair || resolver_changed,
            ) {
                artwork_changed_paths.insert(file.path.clone());
            }
            if resolver_changed
                || snapshot.classification_version.as_deref() != Some(CLASSIFICATION_VERSION)
            {
                artwork_changed_paths.insert(file.path.clone());
            }
            reused.push(parsed);
            continue;
        }

        let renamed_snapshot = file
            .stable_identity
            .as_deref()
            .and_then(|identity| snapshots_by_identity.remove(identity))
            .filter(|snapshot| raw_metadata_reusable(snapshot, file, phase))
            .or_else(|| {
                file.stable_identity
                    .is_none()
                    .then(|| {
                        snapshots_by_fingerprint.remove(&(
                            file.size_bytes,
                            file.modified_at_ns,
                            file.tag_fingerprint.as_deref(),
                        ))
                    })
                    .flatten()
            });
        if let Some(snapshot) = renamed_snapshot {
            let mut parsed = snapshot_to_parsed(snapshot);
            parsed.path = file.path.clone();
            let resolver_changed =
                snapshot.cover_resolver_version.as_deref() != Some(COVER_RESOLVER_VERSION);
            let local_cover = local_covers
                .get(file.directory.as_ref())
                .cloned()
                .unwrap_or_default();
            if reconcile_reused_cover(
                &mut parsed,
                local_cover,
                mode == IndexMode::Repair || resolver_changed,
            ) {
                artwork_changed_paths.insert(file.path.clone());
            }
            if resolver_changed
                || snapshot.classification_version.as_deref() != Some(CLASSIFICATION_VERSION)
            {
                artwork_changed_paths.insert(file.path.clone());
            }
            reused.push(parsed);
            continue;
        }

        changed.push(file);
    }
    let unchanged_detection_us =
        unchanged_lookup_us.saturating_add(elapsed_us(unchanged_detection_started.elapsed()));

    info!(
        "Library scan discovered {} files ({} reused, {} to parse)",
        discovered.len(),
        reused.len(),
        changed.len()
    );

    let parsed_batch = parse_changed_files(
        path_to_library,
        &changed,
        &local_covers,
        &snapshots_by_path,
        cold_parse,
        cancellation,
    )?;
    if cancellation.is_cancelled() {
        let _ = SqliteTransactionManager::rollback_transaction(&mut conn);
        fail_scan_job(
            &mut conn,
            scan_job_id,
            "Library scan was replaced by a newer request",
        )?;
        return Err(std::io::Error::new(
            std::io::ErrorKind::Interrupted,
            "Library scan was replaced by a newer request",
        )
        .into());
    }
    let (warning_count, warnings) = collect_scan_warnings(&parsed_batch.files);
    let parsing_wall_us = parsed_batch.wall_us;
    let parsing_enumeration_overlap_us = parsed_batch.enumeration_overlap_us;
    let cold_database_staging_us = parsed_batch.database_staging_us;
    let parsing_database_overlap_us = parsed_batch.database_overlap_us;
    let bytes_read = parsed_batch.bytes_read;
    let bytes_read_p50 = parsed_batch.bytes_read_p50;
    let bytes_read_p95 = parsed_batch.bytes_read_p95;
    let file_opens = parsed_batch.file_opens;
    let read_calls = parsed_batch.read_calls;
    let seeks = parsed_batch.seeks;
    let parser_fallbacks = parsed_batch.parser_fallbacks;
    let parse_threads = parsed_batch.threads;
    let storage_seek_penalty = parsed_batch.storage_seek_penalty;
    let tag_parsing_us = parsed_batch.tag_parsing_us;
    let duration_us = parsed_batch.duration_us;
    let parsed_changed = parsed_batch.files;

    let has_usable_file = reused.iter().any(|parsed| {
        parsed.error.is_none()
            || parsed.duration_seconds.is_finite() && parsed.duration_seconds > 0.0
    }) || parsed_changed.iter().any(|parsed| {
        parsed.error.is_none()
            || parsed.duration_seconds.is_finite() && parsed.duration_seconds > 0.0
    });
    if !snapshots.is_empty() && !discovered.is_empty() && !has_usable_file {
        let message = "Every discovered file failed metadata and duration validation; preserving the previous catalog";
        fail_scan_job(&mut conn, scan_job_id, message)?;
        return Err(std::io::Error::other(message).into());
    }

    let reused_total = reused.len();
    let mut parsed_files = ScanRecordArena::from_records(reused, discovered.len());
    parsed_files.extend(parsed_changed);
    parsed_files.sort_unstable_by(|left, right| left.path.cmp(&right.path));
    let files_requiring_frame_scans = parsed_files
        .iter()
        .filter(|parsed| parsed.duration_source.needs_repair())
        .count();
    let projection_unchanged = mode == IndexMode::Incremental
        && changed.is_empty()
        && artwork_changed_paths.is_empty()
        && snapshots.len() == discovered.len();
    let core_identity_changed = projection_unchanged
        && discovered.iter().any(|file| {
            snapshots_by_path
                .get(file.path.as_ref())
                .is_some_and(|snapshot| {
                    snapshot.stable_identity.as_deref() != file.stable_identity.as_deref()
                })
        });
    let tracks_without_cover = if projection_unchanged {
        HashSet::new()
    } else {
        parsed_files
            .iter()
            .filter(|parsed| parsed.cover_url.is_empty())
            .map(|parsed| parsed.path.clone())
            .collect::<HashSet<_>>()
    };
    let embedded_cover_started = Instant::now();
    let mut embedded_cover_refresh_paths = artwork_changed_paths.clone();
    embedded_cover_refresh_paths.extend(changed.iter().map(|file| file.path.clone()));
    if mode == IndexMode::Repair {
        embedded_cover_refresh_paths.extend(parsed_files.iter().map(|file| file.path.clone()));
    }
    let embedded_artwork_hashes = if phase == LibraryIndexPhase::Enriched && !projection_unchanged {
        let hashes =
            attach_one_embedded_cover_per_album(&mut parsed_files, &embedded_cover_refresh_paths);
        attach_fallback_local_covers(
            &mut parsed_files,
            &fallback_local_covers,
            &embedded_cover_refresh_paths,
        );
        hashes
    } else {
        HashMap::new()
    };
    cover_discovery_us =
        cover_discovery_us.saturating_add(elapsed_us(embedded_cover_started.elapsed()));
    artwork_changed_paths.extend(
        parsed_files
            .iter()
            .filter(|parsed| {
                !parsed.cover_url.is_empty() && tracks_without_cover.contains(&parsed.path)
            })
            .map(|parsed| parsed.path.clone()),
    );
    let changed_file_paths = changed
        .iter()
        .map(|file| file.path.as_ref())
        .collect::<HashSet<_>>();
    let reused_artwork_changes = artwork_changed_paths
        .iter()
        .filter(|path| !changed_file_paths.contains(path.as_ref()))
        .count();
    let reused_count = reused_total.saturating_sub(reused_artwork_changes);
    let mut changed_paths = changed
        .iter()
        .map(|file| file.path.as_ref())
        .collect::<HashSet<_>>();
    changed_paths.extend(artwork_changed_paths.iter().map(AsRef::as_ref));
    let mut artwork_hashes = album_covers
        .values()
        .filter(|cover| !cover.path.is_empty() && !cover.content_hash.is_empty())
        .map(|cover| (cover.path.clone(), cover.content_hash.clone()))
        .collect::<HashMap<_, _>>();
    artwork_hashes.extend(embedded_artwork_hashes);
    let discovered_by_path = discovered
        .iter()
        .map(|file| (file.path.as_ref(), file))
        .collect::<HashMap<_, _>>();
    let indexed_files = changed.len() + artwork_changed_paths.len();
    let run_kind = LibraryIndexRunKind::for_scan(!snapshots.is_empty(), indexed_files);

    let import_result = stage_catalog_import(
        &mut conn,
        CatalogImportInputs {
            projection_unchanged,
            core_identity_changed,
            genuine_large_first_import,
            cold_stream_staged,
            root_id,
            scan_job_id,
            core_library: &core_library,
            discovered,
            indexed_files,
            reused_count,
            warning_count,
            cancellation,
            parsed_files: &mut parsed_files,
            changed_paths: &changed_paths,
            discovered_by_path: &discovered_by_path,
            artwork_hashes: &artwork_hashes,
            phase,
            mode,
        },
        cold_database_staging_us,
    );
    let (import_result, database_staging_us, normalization_inference_us, database_commit_us) =
        match import_result {
            Ok(timing) => {
                let commit_started = Instant::now();
                let result = SqliteTransactionManager::commit_transaction(&mut conn);
                (
                    result,
                    timing.database_staging_us,
                    timing.normalization_inference_us,
                    elapsed_us(commit_started.elapsed()),
                )
            }
            Err(error) => {
                let _ = SqliteTransactionManager::rollback_transaction(&mut conn);
                (Err(error), cold_database_staging_us, 0, 0)
            }
        };
    if let Err(error) = import_result {
        if cancellation.is_cancelled() {
            let message = "Library scan cancelled between database batches";
            fail_scan_job(&mut conn, scan_job_id, message)?;
            return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, message).into());
        }
        return Err(error.into());
    }

    let mut report = LibraryIndexReport {
        scanned_files: discovered.len(),
        indexed_files,
        skipped_files: reused_count,
        warning_count,
        warnings,
        timing: LibraryIndexTiming {
            run_kind,
            enumeration_us,
            parsing_wall_us,
            parsing_enumeration_overlap_us,
            parsing_enumeration_overlap_percent: parsing_enumeration_overlap_us
                .saturating_mul(100)
                .checked_div(parsing_wall_us)
                .unwrap_or(0)
                .min(100) as u8,
            parsing_database_overlap_us,
            parsing_database_overlap_percent: parsing_database_overlap_us
                .saturating_mul(100)
                .checked_div(parsing_wall_us)
                .unwrap_or(0)
                .min(100) as u8,
            bytes_read,
            bytes_read_p50,
            bytes_read_p95,
            file_opens,
            metadata_operations: discovered.len() as u64,
            read_calls,
            seeks,
            parser_fallbacks,
            parser_threads: parse_threads,
            storage_queue_depth: storage_queue_depth(
                Path::new(path_to_library),
                storage_seek_penalty,
            ),
            unchanged_detection_us,
            cover_discovery_us,
            tag_parsing_us,
            duration_us,
            files_requiring_frame_scans,
            database_staging_us,
            database_commit_us,
            normalization_inference_us,
            ..LibraryIndexTiming::default()
        },
    };

    // Drop scan-only records before constructing the catalog export.
    drop(parsed_files);
    let export_started = Instant::now();
    let library = export_library_from_database(&pool)?;
    report.timing.full_library_export_us = elapsed_us(export_started.elapsed());
    report.timing.total_us = elapsed_us(total_started.elapsed());
    report.timing.cpu_time_us = process_cpu_time_us()
        .zip(cpu_started)
        .map(|(finished, started)| finished.saturating_sub(started))
        .unwrap_or_default();
    report.timing.cpu_utilization_percent = if report.timing.total_us == 0 {
        0.0
    } else {
        report.timing.cpu_time_us as f64 * 100.0 / report.timing.total_us as f64
    };
    let overlapped_front = enumeration_us
        .max(parsing_wall_us)
        .max(cold_database_staging_us);
    let final_database_staging_us = database_staging_us.saturating_sub(cold_database_staging_us);
    let accounted_wall_us = overlapped_front
        .saturating_add(unchanged_detection_us)
        .saturating_add(cover_discovery_us)
        .saturating_add(final_database_staging_us)
        .saturating_add(normalization_inference_us)
        .saturating_add(database_commit_us)
        .saturating_add(report.timing.full_library_export_us)
        .min(report.timing.total_us);
    report.timing.explained_wall_us = accounted_wall_us;
    report.timing.unattributed_wall_us = report.timing.total_us.saturating_sub(accounted_wall_us);
    report.timing.explained_wall_percent = if report.timing.total_us == 0 {
        100.0
    } else {
        accounted_wall_us as f64 * 100.0 / report.timing.total_us as f64
    };
    log_scan_timing(&report.timing);

    Ok((library, report))
}

const INSTANT_PREVIEW_ARTISTS: usize = 20;
const INSTANT_PREVIEW_FILES: usize = 480;
const INSTANT_PREVIEW_FILES_PER_DIRECTORY: usize = 8;
const INSTANT_PREVIEW_DISCOVERY_BUDGET: Duration = Duration::from_millis(2_000);

fn preview_file(path: PathBuf) -> Option<DiscoveredFile> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    let format = AudioFormat::from_extension(&extension);
    if format == AudioFormat::Unknown {
        return None;
    }
    let metadata = std::fs::metadata(&path).ok()?;
    let native_directory = path.parent()?.to_path_buf();
    let database_path = path.to_string_lossy().replace('\\', "/");
    let database_directory = native_directory.to_string_lossy().replace('\\', "/");
    Some(DiscoveredFile {
        file_name: Arc::from(
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default(),
        ),
        native_path: path,
        native_directory,
        path: Arc::from(database_path),
        directory: Arc::from(database_directory),
        format,
        size_bytes: metadata.len().min(i64::MAX as u64) as i64,
        modified_at_ns: 0,
        stable_identity: None,
        tag_fingerprint: None,
    })
}

fn discover_instant_preview_files(root: &Path) -> Vec<DiscoveredFile> {
    let deadline = Instant::now() + INSTANT_PREVIEW_DISCOVERY_BUDGET;
    let mut directories = VecDeque::from([root.to_path_buf()]);
    let mut files = Vec::with_capacity(INSTANT_PREVIEW_FILES);
    while let Some(directory) = directories.pop_front() {
        if files.len() >= INSTANT_PREVIEW_FILES || Instant::now() >= deadline {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        let mut entries = entries.flatten().collect::<Vec<_>>();
        // Stabilize filesystem order before sampling the preview.
        entries.sort_unstable_by_key(std::fs::DirEntry::file_name);
        let mut directory_audio = Vec::new();
        let mut has_child_directories = false;
        for entry in entries {
            if Instant::now() >= deadline {
                break;
            }
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                if !entry.file_name().to_string_lossy().starts_with('.') {
                    has_child_directories = true;
                    directories.push_back(path);
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let extension = path
                .extension()
                .and_then(|extension| extension.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if AudioFormat::from_extension(&extension) != AudioFormat::Unknown {
                directory_audio.push(path);
            }
        }
        // Sample across folders, or across the bounded root of flat libraries.
        let directory_limit = if directory == root && !has_child_directories {
            INSTANT_PREVIEW_FILES
        } else {
            INSTANT_PREVIEW_FILES_PER_DIRECTORY
        };
        for path in directory_audio.into_iter().take(directory_limit) {
            if let Some(file) = preview_file(path) {
                files.push(file);
                if files.len() >= INSTANT_PREVIEW_FILES {
                    break;
                }
            }
        }
    }
    files
}

fn preview_local_cover(directory: &Path) -> Option<String> {
    let entries = std::fs::read_dir(directory).ok()?;
    let mut candidates = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let extension = path.extension()?.to_str()?.to_ascii_lowercase();
            if !matches!(extension.as_str(), "jpg" | "jpeg" | "png" | "webp") {
                return None;
            }
            let stem = path.file_stem()?.to_str()?.to_ascii_lowercase();
            let score = match stem.as_str() {
                "cover" | "front" | "folder" | "album" => 0,
                value if value.contains("cover") || value.contains("front") => 1,
                _ => 2,
            };
            Some((score, path))
        })
        .collect::<Vec<_>>();
    candidates.sort_unstable_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(&right.1)));
    candidates
        .into_iter()
        .next()
        .map(|(_, path)| path.to_string_lossy().to_string())
}

/// Adds bounded artwork to a progressive catalog delta.
pub fn hydrate_progressive_catalog_artwork(catalog: &mut [Artist]) {
    let mut tasks = catalog
        .iter()
        .enumerate()
        .flat_map(|(artist_index, artist)| {
            artist
                .albums
                .iter()
                .enumerate()
                .filter(|(_, album)| album.cover_url.is_empty())
                .filter_map(move |(album_index, album)| {
                    album
                        .songs
                        .first()
                        .map(|song| (artist_index, album_index, song.path.clone()))
                })
        })
        .collect::<Vec<_>>();
    if tasks.is_empty() {
        return;
    }
    tasks.sort_unstable_by(|left, right| left.2.cmp(&right.2));

    let cover_directory = get_cover_art_path();
    let managed_covers_available = std::fs::create_dir_all(&cover_directory).is_ok();
    let (cover_threads, storage_seek_penalty) = parse_thread_count(Path::new(&tasks[0].2));
    let resolve = || {
        tasks
            .par_iter()
            .filter_map(|(artist_index, album_index, path)| {
                let track = Path::new(path);
                let directory = track.parent()?;
                let release_directory = album_directory(directory);
                let cover = preview_local_cover(release_directory).or_else(|| {
                    managed_covers_available
                        .then(|| embedded_cover_from_file(track, None))
                        .flatten()
                        .map(|picture| {
                            persist_embedded_cover(track, &picture, &cover_directory).path
                        })
                })?;
                (!cover.is_empty()).then_some((*artist_index, *album_index, cover))
            })
            .collect::<Vec<_>>()
    };
    let started = Instant::now();
    let resolved = parser_pool(cover_threads)
        .map(|pool| pool.install(resolve))
        .unwrap_or_else(|_| resolve());
    for (artist_index, album_index, cover) in resolved {
        if let Some(album) = catalog
            .get_mut(artist_index)
            .and_then(|artist| artist.albums.get_mut(album_index))
        {
            album.cover_url = cover;
        }
    }
    for artist in catalog {
        if artist.icon_url.is_empty()
            && let Some(cover) = artist
                .albums
                .iter()
                .find_map(|album| (!album.cover_url.is_empty()).then(|| album.cover_url.clone()))
        {
            artist.icon_url = cover;
        }
    }
    info!(
        albums_considered = tasks.len(),
        cover_threads,
        storage_seek_penalty,
        elapsed_us = elapsed_us(started.elapsed()),
        "progressive catalog artwork hydrated"
    );
}

fn preview_album_artist(parsed: &ParsedFile) -> String {
    parsed
        .album_artists
        .first()
        .or_else(|| parsed.track_artists.first())
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Unknown Artist".to_string())
}

fn select_instant_preview_records(mut parsed: Vec<ParsedFile>) -> Vec<ParsedFile> {
    parsed.sort_unstable_by(|left, right| {
        hash_artist(&preview_album_artist(left))
            .cmp(&hash_artist(&preview_album_artist(right)))
            .then(
                hash_album(&left.album, &preview_album_artist(left))
                    .cmp(&hash_album(&right.album, &preview_album_artist(right))),
            )
            .then(left.track_number.cmp(&right.track_number))
            .then(left.path.cmp(&right.path))
    });
    let mut selected_artists = HashSet::<String>::new();
    let mut selected_album = HashMap::<String, String>::new();
    let mut album_tracks = HashMap::<String, usize>::new();
    parsed
        .into_iter()
        .filter(|record| {
            let artist = hash_artist(&preview_album_artist(record));
            if !selected_artists.contains(&artist) {
                if selected_artists.len() >= INSTANT_PREVIEW_ARTISTS {
                    return false;
                }
                selected_artists.insert(artist.clone());
            }
            let album = hash_album(&record.album, &preview_album_artist(record));
            let chosen = selected_album
                .entry(artist)
                .or_insert_with(|| album.clone());
            if *chosen != album {
                return false;
            }
            let count = album_tracks.entry(album).or_default();
            if *count >= 8 {
                return false;
            }
            *count += 1;
            true
        })
        .collect()
}

fn preview_catalog_from_parsed(parsed_files: &[ParsedFile], artist_limit: usize) -> Vec<Artist> {
    let mut artists = Vec::<Artist>::new();
    let mut artist_positions = HashMap::<String, usize>::new();
    let mut album_positions = HashMap::<String, (usize, usize)>::new();
    let mut ordered = parsed_files.iter().collect::<Vec<_>>();
    ordered.sort_unstable_by(|left, right| {
        let left_artist = hash_artist(&preview_album_artist(left));
        let right_artist = hash_artist(&preview_album_artist(right));
        left_artist
            .cmp(&right_artist)
            .then(left.album.cmp(&right.album))
            .then(left.track_number.cmp(&right.track_number))
            .then(left.path.cmp(&right.path))
    });
    for parsed in ordered {
        let artist_name = preview_album_artist(parsed);
        let artist_id = hash_artist(&artist_name);
        let artist_index = if let Some(index) = artist_positions.get(&artist_id).copied() {
            index
        } else {
            if artists.len() >= artist_limit {
                continue;
            }
            let index = artists.len();
            artists.push(Artist {
                id: artist_id.clone(),
                name: artist_name.clone(),
                ..Artist::default()
            });
            artist_positions.insert(artist_id.clone(), index);
            index
        };
        let album_id = hash_album(&parsed.album, &artist_name);
        let (owner_index, album_index) = if let Some(position) = album_positions.get(&album_id) {
            *position
        } else {
            let album_index = artists[artist_index].albums.len();
            artists[artist_index].albums.push(Album {
                id: album_id.clone(),
                name: parsed.album.clone(),
                cover_url: parsed.cover_url.clone(),
                first_release_date: parsed.release_date.clone(),
                primary_type: "Album".to_string(),
                contributing_artists: vec![artist_name.clone()],
                contributing_artists_ids: vec![artist_id.clone()],
                ..Album::default()
            });
            album_positions.insert(album_id.clone(), (artist_index, album_index));
            (artist_index, album_index)
        };
        let track_artist = parsed
            .track_artists
            .first()
            .cloned()
            .unwrap_or_else(|| artist_name.clone());
        let track_id = hash_song(
            &parsed.title,
            &track_artist,
            &parsed.album,
            parsed.track_number,
        );
        let album = &mut artists[owner_index].albums[album_index];
        if album.cover_url.is_empty() && !parsed.cover_url.is_empty() {
            album.cover_url.clone_from(&parsed.cover_url);
        }
        if !album.songs.iter().any(|song| song.id == track_id) {
            album.songs.push(Song {
                id: track_id,
                name: parsed.title.clone(),
                artist: track_artist,
                contributing_artists: parsed.track_artists.clone(),
                contributing_artist_ids: parsed
                    .track_artists
                    .iter()
                    .map(|artist| hash_artist(artist))
                    .collect(),
                track_number: parsed.track_number,
                path: parsed.path.to_string(),
                duration: parsed.duration_seconds,
            });
        }
    }
    for artist in &mut artists {
        artist
            .albums
            .sort_unstable_by(|left, right| left.name.cmp(&right.name));
        for album in &mut artist.albums {
            album.songs.sort_unstable_by(|left, right| {
                left.track_number
                    .cmp(&right.track_number)
                    .then(left.name.cmp(&right.name))
            });
        }
        artist.icon_url = artist
            .albums
            .iter()
            .find_map(|album| (!album.cover_url.is_empty()).then(|| album.cover_url.clone()))
            .unwrap_or_default();
    }
    artists
}

/// Produces a playable first-run catalog before durable indexing completes.
pub fn build_instant_library_preview(
    path_to_library: &str,
) -> Result<(Vec<Artist>, LibraryIndexReport), Box<dyn Error + Send + Sync>> {
    let started = Instant::now();
    let files = discover_instant_preview_files(Path::new(path_to_library));
    if files.is_empty() {
        return Err(
            std::io::Error::other("The selected folder contains no supported audio files").into(),
        );
    }
    let references = files.iter().collect::<Vec<_>>();
    let (threads, _) = parse_thread_count(Path::new(path_to_library));
    let parsed = parse_file_batch(&references, &HashMap::new(), threads)?;
    // Bound first content to one album and eight songs per sampled artist.
    let mut parsed = select_instant_preview_records(parsed);
    for record in &mut parsed {
        if record.cover_url.is_empty() {
            record.cover_url = preview_local_cover(
                Path::new(record.path.as_ref())
                    .parent()
                    .unwrap_or_else(|| Path::new(path_to_library)),
            )
            .unwrap_or_default();
        }
    }
    // Extract at most one embedded picture per sampled album.
    let refresh_paths = parsed
        .iter()
        .map(|record| record.path.to_string())
        .collect::<HashSet<_>>();
    attach_one_embedded_cover_per_album(&mut parsed, &refresh_paths);
    let library = preview_catalog_from_parsed(&parsed, INSTANT_PREVIEW_ARTISTS);
    if library.is_empty() {
        return Err(std::io::Error::other("No playable preview could be built").into());
    }
    let elapsed = elapsed_us(started.elapsed());
    info!(
        elapsed_us = elapsed,
        sampled_files = files.len(),
        artists = library.len(),
        albums = library
            .iter()
            .map(|artist| artist.albums.len())
            .sum::<usize>(),
        "instant library preview ready"
    );
    Ok((
        library,
        LibraryIndexReport {
            scanned_files: files.len(),
            indexed_files: parsed.len(),
            skipped_files: 0,
            warning_count: parsed
                .iter()
                .filter(|record| record.error.is_some())
                .count(),
            warnings: Vec::new(),
            timing: LibraryIndexTiming {
                run_kind: LibraryIndexRunKind::Cold,
                parsing_wall_us: elapsed,
                parser_threads: threads,
                total_us: elapsed,
                ..LibraryIndexTiming::default()
            },
        },
    ))
}

/// Builds the minimal playable catalog.
pub fn index_available_library_to_database(
    path_to_library: &str,
) -> Result<(Vec<Artist>, LibraryIndexReport), Box<dyn Error + Send + Sync>> {
    index_library_to_database_phase(
        path_to_library,
        LibraryIndexPhase::Available,
        IndexMode::Incremental,
        &ScanCancellation::default(),
        None,
    )
}

pub fn index_available_library_to_database_with_cancellation(
    path_to_library: &str,
    cancellation: &ScanCancellation,
) -> Result<(Vec<Artist>, LibraryIndexReport), Box<dyn Error + Send + Sync>> {
    index_library_to_database_phase(
        path_to_library,
        LibraryIndexPhase::Available,
        IndexMode::Incremental,
        cancellation,
        None,
    )
}

pub fn index_available_library_to_database_progressive(
    path_to_library: &str,
    progress: CatalogProgressSender,
) -> Result<(Vec<Artist>, LibraryIndexReport), Box<dyn Error + Send + Sync>> {
    index_library_to_database_phase(
        path_to_library,
        LibraryIndexPhase::Available,
        IndexMode::Incremental,
        &ScanCancellation::default(),
        Some(progress),
    )
}

pub fn index_available_library_to_database_progressive_with_cancellation(
    path_to_library: &str,
    progress: CatalogProgressSender,
    cancellation: &ScanCancellation,
) -> Result<(Vec<Artist>, LibraryIndexReport), Box<dyn Error + Send + Sync>> {
    index_library_to_database_phase(
        path_to_library,
        LibraryIndexPhase::Available,
        IndexMode::Incremental,
        cancellation,
        Some(progress),
    )
}

/// Enriches albums produced by [`index_available_library_to_database`].
pub fn enrich_library_to_database(
    path_to_library: &str,
) -> Result<(Vec<Artist>, LibraryIndexReport), Box<dyn Error + Send + Sync>> {
    let result = index_library_to_database_phase(
        path_to_library,
        LibraryIndexPhase::Enriched,
        IndexMode::Incremental,
        &ScanCancellation::default(),
        None,
    )?;
    crate::persistence::connection::snapshot_after_import(&connect()?, true);
    Ok(result)
}

pub fn enrich_library_to_database_with_cancellation(
    path_to_library: &str,
    cancellation: &ScanCancellation,
) -> Result<(Vec<Artist>, LibraryIndexReport), Box<dyn Error + Send + Sync>> {
    let result = index_library_to_database_phase(
        path_to_library,
        LibraryIndexPhase::Enriched,
        IndexMode::Incremental,
        cancellation,
        None,
    )?;
    crate::persistence::connection::snapshot_after_import(&connect()?, true);
    Ok(result)
}

pub fn index_library_to_database(
    path_to_library: &str,
) -> Result<(Vec<Artist>, LibraryIndexReport), Box<dyn Error + Send + Sync>> {
    enrich_library_to_database(path_to_library)
}

pub fn index_library_to_database_with_cancellation(
    path_to_library: &str,
    cancellation: &ScanCancellation,
) -> Result<(Vec<Artist>, LibraryIndexReport), Box<dyn Error + Send + Sync>> {
    let result = index_library_to_database_phase(
        path_to_library,
        LibraryIndexPhase::Enriched,
        IndexMode::Incremental,
        cancellation,
        None,
    )?;
    crate::persistence::connection::snapshot_after_import(&connect()?, true);
    Ok(result)
}

/// Reconstructs normalized catalog entities from available files.
pub fn repair_library_database(
    path_to_library: &str,
) -> Result<(Vec<Artist>, LibraryIndexReport), Box<dyn Error + Send + Sync>> {
    let result = index_library_to_database_phase(
        path_to_library,
        LibraryIndexPhase::Enriched,
        IndexMode::Repair,
        &ScanCancellation::default(),
        None,
    )?;
    crate::persistence::connection::snapshot_after_import(&connect()?, true);
    Ok(result)
}

pub fn repair_library_database_with_cancellation(
    path_to_library: &str,
    cancellation: &ScanCancellation,
) -> Result<(Vec<Artist>, LibraryIndexReport), Box<dyn Error + Send + Sync>> {
    let result = index_library_to_database_phase(
        path_to_library,
        LibraryIndexPhase::Enriched,
        IndexMode::Repair,
        cancellation,
        None,
    )?;
    crate::persistence::connection::snapshot_after_import(&connect()?, true);
    Ok(result)
}

pub fn export_library_from_database(
    pool: &DbPool,
) -> Result<Vec<Artist>, Box<dyn Error + Send + Sync>> {
    let export_started = Instant::now();
    let mut conn = pool.get()?;
    let overrides = load_metadata_overrides(&mut conn)?;
    let artist_rows = diesel::sql_query(
        "SELECT artist.id, artist.name, COALESCE(art.uri, '') AS icon_url,
                artist.followers, COALESCE(artist.description, '') AS description
         FROM artist_entity artist
         LEFT JOIN artwork art ON art.id = artist.artwork_id
         WHERE EXISTS (
             SELECT 1 FROM album_artist albums
             WHERE albums.artist_id = artist.id AND albums.role = 'primary'
         )
         ORDER BY artist.name COLLATE NOCASE",
    )
    .load::<ArtistViewRow>(&mut conn)?;
    // Load the release graph with two set-based queries.
    let mut albums_by_artist = export_albums_by_artist(&mut conn, &overrides)?;
    let query_us = elapsed_us(export_started.elapsed());

    let mut artists = Vec::with_capacity(artist_rows.len());
    for artist_info in artist_rows {
        let artist_id = artist_info.id;
        let albums = albums_by_artist.remove(&artist_id).unwrap_or_default();
        artists.push(Artist {
            id: artist_id.clone(),
            name: value_override(&overrides, "artist", &artist_id, "name", artist_info.name),
            icon_url: value_override(
                &overrides,
                "artist",
                &artist_id,
                "icon_url",
                artist_info.icon_url.unwrap_or_default(),
            ),
            followers: typed_override(
                &overrides,
                "artist",
                &artist_id,
                "followers",
                artist_info.followers.max(0) as u64,
            ),
            albums,
            featured_on_album_ids: typed_override(
                &overrides,
                "artist",
                &artist_id,
                "featured_on_album_ids",
                Vec::new(),
            ),
            description: value_override(
                &overrides,
                "artist",
                &artist_id,
                "description",
                artist_info.description.unwrap_or_default(),
            ),
        });
    }

    info!(
        query_and_album_projection_us = query_us,
        total_us = elapsed_us(export_started.elapsed()),
        artists = artists.len(),
        "full library export completed"
    );
    Ok(artists)
}

#[cfg(test)]
mod external_library_tests {
    use std::collections::{BTreeMap, HashMap, HashSet};
    use std::io::{Cursor, Read, Seek, SeekFrom};
    use std::path::{Path, PathBuf};

    use diesel::connection::{SimpleConnection, TransactionManager};
    use diesel::sqlite::SqliteConnection;
    use diesel::{Connection, RunQueryDsl};
    use parson_core::{FileId, LibraryRegistration, ProductCapability};

    use super::{
        AudioFormat, DiscoveredFile, DurationSource, ExistingFileSnapshot, IndexMode,
        LibraryIndexPhase, OwnedReleaseEvidence, ParsedFile, ParserStrategy, ReconcileInputs,
        StringInterner, TAG_PARSER_VERSION, all_available_snapshots,
        artist_identity_is_one_edit_apart, consensus_release_date, discover_files,
        embedded_cover_representative, embedded_cover_with_lofty, embedded_flac_cover,
        embedded_mp4_cover, encode_syncsafe_u32, hydrate_progressive_catalog_artwork,
        index_library_to_database, infer_album_artists, infer_artist_aliases,
        infer_artist_aliases_for, inherit_original_release_covers, inventory_candidates,
        load_album_inference_cache, local_cover_for, mp3_duration, normalize_genre_key,
        normalized_release_date, parse_aiff_fast, parse_flac_fast, parse_mp3, parse_mp4_fast,
        parse_ogg_fast, parse_wav_fast, parse_with_lofty, prepare_track_seeds, prepare_tracks,
        raw_metadata_reusable, reconcile_normalized_tables, resolve_duplicate_tracks,
        resolve_inventory_cover, resolve_release_presentations, resolve_release_presentations_for,
        slash_decorated_variant, snapshot_to_parsed, split_genres,
        stage_superseded_file_identities, sync_core_file_references,
    };

    fn parsed_track(
        path: &str,
        title: &str,
        track_number: u16,
        duration_seconds: f64,
    ) -> ParsedFile {
        ParsedFile {
            path: path.into(),
            title: title.into(),
            album: "Harbor Lights".into(),
            track_artists: vec!["Casey Rivers".into()],
            album_artists: vec!["Casey Rivers".into()],
            genres: Vec::new(),
            release_date: "2002".into(),
            track_number,
            disc_number: 0,
            duration_seconds,
            duration_source: super::DurationSource::Exact,
            cover_url: String::new(),
            musicbrainz_recording_id: String::new(),
            musicbrainz_release_id: String::new(),
            musicbrainz_artist_id: String::new(),
            musicbrainz_album_artist_id: String::new(),
            error: None,
            embedded_artwork: None,
            tag_parse_us: 0,
            duration_us: 0,
            parse_strategy: ParserStrategy::Test,
            bytes_read: 0,
            read_calls: 0,
            seeks: 0,
            file_opens: 0,
            parser_fallbacks: 0,
            fast_path_error: None,
        }
    }

    fn discovered_file(path: &str, extension: &str, size_bytes: i64) -> DiscoveredFile {
        let native_path = PathBuf::from(path);
        DiscoveredFile {
            native_directory: native_path.parent().unwrap_or(Path::new("")).to_path_buf(),
            native_path,
            path: path.into(),
            directory: String::new().into(),
            file_name: String::new().into(),
            format: AudioFormat::from_extension(extension),
            size_bytes,
            modified_at_ns: 0,
            stable_identity: None,
            tag_fingerprint: None,
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn denied_io_uring_probe_selects_the_buffered_fallback() {
        let denied = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert!(!super::io_uring_probe_succeeded(Err(denied)));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn io_uring_prefetches_bounded_start_and_end_regions() {
        let path = std::env::temp_dir().join(format!(
            "parson-io-uring-region-test-{}.bin",
            uuid::Uuid::new_v4()
        ));
        let mut contents = vec![0x33; 512 * 1024];
        let contents_len = contents.len();
        contents[..16].fill(0x11);
        contents[contents_len - 16..].fill(0x77);
        std::fs::write(&path, &contents).expect("write io_uring fixture");
        let path_text = path.to_string_lossy().into_owned();
        let file = discovered_file(&path_text, "m4a", contents.len() as i64);
        let Some(prefetched) = super::prefetch_tag_regions(&[&file], 16) else {
            // Restricted containers intentionally use buffered metadata reads.
            std::fs::remove_file(path).expect("remove io_uring fixture");
            return;
        };
        let result = prefetched
            .into_iter()
            .next()
            .flatten()
            .expect("both edge reads should complete");
        assert_eq!(result.bytes_read, super::tag_region_bytes() as u64);
        assert_eq!(&result.regions[0].1[..16], &[0x11; 16]);
        assert_eq!(
            &result.regions[1].1[result.regions[1].1.len() - 16..],
            &[0x77; 16]
        );
        std::fs::remove_file(path).expect("remove io_uring fixture");
    }

    #[test]
    fn cold_pipeline_stages_records_while_parsers_are_active() {
        let directory =
            std::env::temp_dir().join(format!("parson-stream-stage-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("create streaming fixture");
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&1_000_036_u32.to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16_u32.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&2_u16.to_le_bytes());
        wav.extend_from_slice(&48_000_u32.to_le_bytes());
        wav.extend_from_slice(&192_000_u32.to_le_bytes());
        wav.extend_from_slice(&4_u16.to_le_bytes());
        wav.extend_from_slice(&16_u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&1_000_000_u32.to_le_bytes());

        let mut files = Vec::new();
        for index in 0..600 {
            let path = directory.join(format!("{index:04}.wav"));
            std::fs::write(&path, &wav).expect("write streaming WAV");
            files.push(discovered_file(
                &path.to_string_lossy(),
                "wav",
                wav.len() as i64,
            ));
        }
        let manager = diesel::r2d2::ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = diesel::r2d2::Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("streaming SQLite pool");
        let mut connection = pool.get().expect("streaming SQLite connection");
        type Manager = <super::PooledSqliteConnection as diesel::Connection>::TransactionManager;
        Manager::begin_transaction(&mut connection).expect("begin streaming transaction");
        let mut pipeline = super::ColdParsePipeline::new_with_progress(
            &directory,
            connection,
            None,
            super::ScanCancellation::default(),
        )
        .expect("create cold streaming pipeline");
        pipeline.schedule_batch(files.clone());
        let mut result = pipeline.finish(&files).expect("finish streaming parse");
        let count = diesel::sql_query("SELECT COUNT(*) AS count FROM cold_parsed_stage")
            .get_result::<super::CountRow>(result.connection.as_mut().expect("returned connection"))
            .expect("count staged rows")
            .count;
        assert_eq!(count, files.len() as i64);
        assert_eq!(result.parsed.len(), files.len());
        assert!(result.database_staging_us > 0);
        assert!(result.parsing_staging_overlap_us > 0);
        Manager::rollback_transaction(result.connection.as_mut().unwrap())
            .expect("rollback streaming test");
        std::fs::remove_dir_all(directory).expect("remove streaming fixture");
    }

    #[test]
    fn warning_details_are_bounded_without_losing_the_aggregate_count() {
        let parsed = (0..(super::MAX_WARNING_DETAILS + 17))
            .map(|index| {
                let mut track = parsed_track(&format!("track-{index}.mp3"), "Track", 1, 0.0);
                track.error = Some("metadata unavailable".into());
                track
            })
            .collect::<Vec<_>>();

        let (count, details) = super::collect_scan_warnings(&parsed);
        assert_eq!(count, super::MAX_WARNING_DETAILS + 17);
        assert_eq!(details.len(), super::MAX_WARNING_DETAILS);
    }

    #[test]
    fn scan_cancellation_is_cooperative_and_clone_visible() {
        let cancellation = super::ScanCancellation::default();
        let observer = cancellation.clone();
        assert!(!observer.is_cancelled());
        cancellation.cancel();
        assert!(observer.is_cancelled());
    }

    #[test]
    fn cancelled_parse_batches_do_not_open_more_audio_files() {
        let file = discovered_file("/does/not/need/to/exist.mp3", "mp3", 1_000_000);
        let cancellation = super::ScanCancellation::default();
        cancellation.cancel();

        let parsed = super::parse_file_batch_with_cancellation(
            &[&file],
            &HashMap::new(),
            1,
            Some(&cancellation),
        )
        .expect("cancelled batch");

        assert!(parsed.is_empty());
    }

    #[test]
    fn prepared_tracks_reuse_normalized_metadata_and_entity_ids() {
        let mut parsed = vec![
            parsed_track("C:/Music/Harbor Lights/01.mp3", "Solara", 1, 289.0),
            parsed_track("C:/Music/Harbor Lights/02.mp3", "Keep the Light", 2, 283.0),
        ];
        parsed[0].genres = vec!["Pop".into()];
        parsed[1].genres = vec!["Pop".into()];

        let mut interner = StringInterner::with_capacity(parsed.len() * 12);
        let seeds = prepare_track_seeds(&parsed, &mut interner);
        let aliases = infer_artist_aliases(&seeds);
        let album_artists = infer_album_artists(&seeds, &aliases);
        let prepared = super::prepare_tracks(seeds, &aliases, &album_artists, &mut interner);

        assert!(std::sync::Arc::ptr_eq(
            &prepared[0].normalized_album,
            &prepared[1].normalized_album,
        ));
        assert!(std::sync::Arc::ptr_eq(
            &prepared[0].resolved_album_artist,
            &prepared[1].resolved_album_artist,
        ));
        assert!(std::sync::Arc::ptr_eq(
            &prepared[0].genres[0].normalized_name,
            &prepared[1].genres[0].normalized_name,
        ));
        assert_eq!(prepared[0].album_id, prepared[1].album_id);
        assert_ne!(prepared[0].track_id, prepared[1].track_id);
        assert_eq!(prepared[0].track_id, prepared[0].recording_id);
    }

    #[test]
    fn dominant_track_artist_supplies_missing_release_artist_without_hiding_compilations() {
        let mut parsed = (1..=4)
            .map(|number| {
                parsed_track(
                    &format!("C:/Music/Release/{number:02}.flac"),
                    &format!("Track {number}"),
                    number,
                    200.0,
                )
            })
            .collect::<Vec<_>>();
        for track in &mut parsed {
            track.album_artists.clear();
        }
        parsed[3].track_artists = vec!["Guest Performer".into()];
        let mut interner = StringInterner::with_capacity(64);
        let seeds = prepare_track_seeds(&parsed, &mut interner);
        let inferred = infer_album_artists(&seeds, &HashMap::new());
        assert_eq!(
            inferred.values().next().map(String::as_str),
            Some("Casey Rivers")
        );

        parsed[2].track_artists = vec!["Guest Performer".into()];
        let seeds = prepare_track_seeds(&parsed, &mut interner);
        let inferred = infer_album_artists(&seeds, &HashMap::new());
        assert_eq!(
            inferred.values().next().map(String::as_str),
            Some("Various Artists"),
            "track artists: {:?}; inferred: {:?}",
            parsed
                .iter()
                .map(|track| &track.track_artists)
                .collect::<Vec<_>>(),
            inferred,
        );
    }

    fn reusable_snapshot() -> ExistingFileSnapshot {
        ExistingFileSnapshot {
            file_id: 1,
            path: "track.mp3".into(),
            size_bytes: 512,
            modified_at_ns: 123,
            stable_identity: Some("file-id".into()),
            tag_fingerprint: Some("tag".into()),
            title: Some("Track".into()),
            album: Some("Album".into()),
            track_artists_json: "[]".into(),
            album_artists_json: "[]".into(),
            genres_json: "[]".into(),
            release_date: None,
            track_number: Some(1),
            disc_number: Some(1),
            duration_seconds: 1.0,
            duration_source: "exact".into(),
            cover_url: None,
            parser_version: Some(TAG_PARSER_VERSION.into()),
            cover_resolver_version: None,
            classification_version: None,
            musicbrainz_recording_id: None,
            musicbrainz_release_id: None,
            musicbrainz_artist_id: None,
            musicbrainz_album_artist_id: None,
            error: None,
            embedded_artwork_offset: None,
            embedded_artwork_length: None,
        }
    }

    fn mpeg1_layer3_file(length: usize) -> Vec<u8> {
        let mut bytes = vec![0; length.max(128)];
        // MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo.
        bytes[..4].copy_from_slice(&[0xff, 0xfb, 0x90, 0x00]);
        bytes
    }

    struct CountingCursor {
        inner: Cursor<Vec<u8>>,
        bytes_read: usize,
    }

    impl Read for CountingCursor {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let read = self.inner.read(buffer)?;
            self.bytes_read += read;
            Ok(read)
        }
    }

    impl Seek for CountingCursor {
        fn seek(&mut self, position: SeekFrom) -> std::io::Result<u64> {
            self.inner.seek(position)
        }
    }

    fn mp4_atom(kind: [u8; 4], content: Vec<u8>) -> Vec<u8> {
        let size = 8_u32
            .checked_add(u32::try_from(content.len()).expect("test atom content"))
            .expect("test atom size");
        let mut atom = Vec::with_capacity(size as usize);
        atom.extend_from_slice(&size.to_be_bytes());
        atom.extend_from_slice(&kind);
        atom.extend_from_slice(&content);
        atom
    }

    fn mp4_data(data_type: u32, value: &[u8]) -> Vec<u8> {
        let mut content = Vec::with_capacity(8 + value.len());
        content.extend_from_slice(&data_type.to_be_bytes());
        content.extend_from_slice(&0_u32.to_be_bytes());
        content.extend_from_slice(value);
        mp4_atom(*b"data", content)
    }

    fn mp4_item(kind: [u8; 4], data_type: u32, value: &[u8]) -> Vec<u8> {
        mp4_atom(kind, mp4_data(data_type, value))
    }

    #[test]
    fn flac_fast_path_skips_picture_blocks_and_preserves_catalog_metadata() {
        let mut streaminfo = vec![0_u8; 34];
        let sample_rate = 44_100_u64;
        let total_samples = sample_rate * 245;
        let packed = (sample_rate << 44) | (1_u64 << 41) | (15_u64 << 36) | total_samples;
        streaminfo[10..18].copy_from_slice(&packed.to_be_bytes());

        let comments = [
            "TITLE=Fast Song",
            "ALBUM=Fast Album",
            "ARTIST=First Artist",
            "ARTIST=Second Artist",
            "ALBUMARTIST=Album Artist",
            "GENRE=Electronic",
            "DATE=2024-03-01",
            "TRACKNUMBER=7/12",
            "DISCNUMBER=2/3",
        ];
        let mut vorbis = Vec::new();
        vorbis.extend_from_slice(&0_u32.to_le_bytes());
        vorbis.extend_from_slice(&(comments.len() as u32).to_le_bytes());
        for comment in comments {
            vorbis.extend_from_slice(&(comment.len() as u32).to_le_bytes());
            vorbis.extend_from_slice(comment.as_bytes());
        }

        let picture = vec![0x5a; 5 * 1024 * 1024];
        let mut picture_block = Vec::with_capacity(picture.len() + 64);
        picture_block.extend_from_slice(&3_u32.to_be_bytes());
        picture_block.extend_from_slice(&9_u32.to_be_bytes());
        picture_block.extend_from_slice(b"image/png");
        picture_block.extend_from_slice(&0_u32.to_be_bytes());
        picture_block.extend_from_slice(&600_u32.to_be_bytes());
        picture_block.extend_from_slice(&600_u32.to_be_bytes());
        picture_block.extend_from_slice(&24_u32.to_be_bytes());
        picture_block.extend_from_slice(&0_u32.to_be_bytes());
        picture_block.extend_from_slice(&(picture.len() as u32).to_be_bytes());
        picture_block.extend_from_slice(&picture);
        let mut bytes = b"fLaC".to_vec();
        bytes.extend_from_slice(&[0, 0, 0, 34]);
        bytes.extend_from_slice(&streaminfo);
        let comment_len = vorbis.len() as u32;
        bytes.extend_from_slice(&[
            4,
            ((comment_len >> 16) & 0xff) as u8,
            ((comment_len >> 8) & 0xff) as u8,
            (comment_len & 0xff) as u8,
        ]);
        bytes.extend_from_slice(&vorbis);
        let picture_len = picture_block.len() as u32;
        bytes.extend_from_slice(&[
            0x80 | 6,
            ((picture_len >> 16) & 0xff) as u8,
            ((picture_len >> 8) & 0xff) as u8,
            (picture_len & 0xff) as u8,
        ]);
        bytes.extend_from_slice(&picture_block);

        let mut reader = CountingCursor {
            inner: Cursor::new(bytes.clone()),
            bytes_read: 0,
        };
        let metadata = parse_flac_fast(&mut reader).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("Fast Song"));
        assert_eq!(metadata.album.as_deref(), Some("Fast Album"));
        assert_eq!(metadata.track_artists, ["First Artist", "Second Artist"]);
        assert_eq!(metadata.album_artists, ["Album Artist"]);
        assert_eq!(metadata.genre, "Electronic");
        assert_eq!(metadata.release_date.as_deref(), Some("2024-03-01"));
        assert_eq!(metadata.track_number, 7);
        assert_eq!(metadata.disc_number, 2);
        assert!((metadata.duration_seconds - 245.0).abs() < f64::EPSILON);
        assert!(reader.bytes_read < 1024, "read {} bytes", reader.bytes_read);
        let region = metadata.embedded_artwork.expect("FLAC picture region");
        assert_eq!(region.length as usize, picture.len());
        assert_eq!(
            &bytes[region.offset as usize..][..region.length as usize],
            picture
        );

        let mut cover_reader = CountingCursor {
            inner: Cursor::new(bytes.clone()),
            bytes_read: 0,
        };
        assert_eq!(
            embedded_flac_cover(&mut cover_reader).unwrap(),
            Some(picture.clone())
        );
        assert!(cover_reader.bytes_read < 5 * 1024 * 1024 + 1024);

        let id3_payload = vec![0_u8; 37];
        let mut prefixed = b"ID3\x04\x00\x00".to_vec();
        prefixed.extend_from_slice(&encode_syncsafe_u32(id3_payload.len() as u32));
        prefixed.extend_from_slice(&id3_payload);
        prefixed.extend_from_slice(&bytes);
        let mut prefixed_reader = CountingCursor {
            inner: Cursor::new(prefixed.clone()),
            bytes_read: 0,
        };
        let prefixed_metadata = parse_flac_fast(&mut prefixed_reader).unwrap();
        assert_eq!(prefixed_metadata.title.as_deref(), Some("Fast Song"));
        assert_eq!(prefixed_metadata.parse_strategy, ParserStrategy::FlacFast);
        assert!(prefixed_reader.bytes_read < 1024);
        let mut prefixed_cover_reader = CountingCursor {
            inner: Cursor::new(prefixed),
            bytes_read: 0,
        };
        assert_eq!(
            embedded_flac_cover(&mut prefixed_cover_reader).unwrap(),
            Some(picture)
        );
    }

    #[test]
    fn mp4_fast_path_skips_mdat_and_cover_atoms_and_preserves_catalog_metadata() {
        let ftyp = mp4_atom(*b"ftyp", b"M4A \0\0\0\0M4A isom".to_vec());
        let mdat = mp4_atom(*b"mdat", vec![0x31; 5 * 1024 * 1024]);

        let mut mvhd = vec![0_u8; 20];
        mvhd[12..16].copy_from_slice(&44_100_u32.to_be_bytes());
        mvhd[16..20].copy_from_slice(&(44_100_u32 * 180).to_be_bytes());
        let mvhd = mp4_atom(*b"mvhd", mvhd);

        let mut ilst = Vec::new();
        ilst.extend(mp4_item(*b"\xa9nam", 1, b"Fast M4A"));
        ilst.extend(mp4_item(*b"\xa9alb", 1, b"Fast Album"));
        ilst.extend(mp4_item(*b"\xa9ART", 1, b"Track Artist"));
        ilst.extend(mp4_item(*b"aART", 1, b"Album Artist"));
        // Legacy MP4 genres use one-based ID3v1 indexes.
        ilst.extend(mp4_item(*b"gnre", 0, &[0, 14]));
        ilst.extend(mp4_item(*b"\xa9day", 1, b"2025"));
        ilst.extend(mp4_item(*b"trkn", 0, &[0, 0, 0, 9, 0, 12, 0, 0]));
        ilst.extend(mp4_item(*b"disk", 0, &[0, 0, 0, 2, 0, 3, 0, 0]));
        let picture = vec![0x7f; 5 * 1024 * 1024];
        ilst.extend(mp4_atom(*b"covr", mp4_data(13, &picture)));
        let ilst = mp4_atom(*b"ilst", ilst);
        let mut meta = vec![0_u8; 4];
        meta.extend(ilst);
        let meta = mp4_atom(*b"meta", meta);
        let udta = mp4_atom(*b"udta", meta);
        let mut moov_content = mvhd;
        moov_content.extend(udta);
        let moov = mp4_atom(*b"moov", moov_content);

        let mut bytes = ftyp;
        bytes.extend(mdat);
        bytes.extend(moov);
        let length = bytes.len() as u64;
        let mut reader = CountingCursor {
            inner: Cursor::new(bytes),
            bytes_read: 0,
        };
        let metadata = parse_mp4_fast(&mut reader, length).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("Fast M4A"));
        assert_eq!(metadata.album.as_deref(), Some("Fast Album"));
        assert_eq!(metadata.track_artists, ["Track Artist"]);
        assert_eq!(metadata.album_artists, ["Album Artist"]);
        assert_eq!(metadata.genre, "Pop");
        assert_eq!(metadata.release_date.as_deref(), Some("2025"));
        assert_eq!(metadata.track_number, 9);
        assert_eq!(metadata.disc_number, 2);
        assert!((metadata.duration_seconds - 180.0).abs() < f64::EPSILON);
        assert!(reader.bytes_read < 2048, "read {} bytes", reader.bytes_read);
        let region = metadata.embedded_artwork.expect("MP4 cover region");
        assert_eq!(region.length as usize, picture.len());
        assert_eq!(
            &reader.inner.get_ref()[region.offset as usize..][..region.length as usize],
            picture
        );

        let mut cover_reader = CountingCursor {
            inner: Cursor::new(reader.inner.into_inner()),
            bytes_read: 0,
        };
        assert_eq!(
            embedded_mp4_cover(&mut cover_reader, length).unwrap(),
            Some(picture)
        );
        assert!(cover_reader.bytes_read < 5 * 1024 * 1024 + 2048);
    }

    #[test]
    #[ignore = "set PARSON_PARSE_BENCH_FILE to a real FLAC or M4A file"]
    fn benchmarks_fast_parser_against_lofty_on_external_file() {
        let path = std::env::var("PARSON_PARSE_BENCH_FILE")
            .expect("PARSON_PARSE_BENCH_FILE must point to a FLAC or M4A file");
        let bytes = std::fs::read(&path).expect("read benchmark media");
        let extension = Path::new(&path)
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        let mut fast_reader = CountingCursor {
            inner: Cursor::new(bytes.clone()),
            bytes_read: 0,
        };
        let fast_started = std::time::Instant::now();
        let fast = match extension.as_str() {
            "flac" => parse_flac_fast(&mut fast_reader).unwrap(),
            "m4a" | "alac" => parse_mp4_fast(&mut fast_reader, bytes.len() as u64).unwrap(),
            _ => panic!("unsupported benchmark extension: {extension}"),
        };
        let fast_elapsed = fast_started.elapsed();

        let mut lofty_reader = CountingCursor {
            inner: Cursor::new(bytes.clone()),
            bytes_read: 0,
        };
        let lofty_started = std::time::Instant::now();
        let lofty = parse_with_lofty(&mut lofty_reader).unwrap();
        let lofty_elapsed = lofty_started.elapsed();

        assert_eq!(fast.title, lofty.title);
        assert_eq!(fast.album, lofty.album);
        assert_eq!(fast.track_artists, lofty.track_artists);
        assert_eq!(fast.album_artists, lofty.album_artists);
        assert_eq!(fast.genre, lofty.genre);
        assert_eq!(fast.release_date, lofty.release_date);
        assert_eq!(fast.track_number, lofty.track_number);
        assert_eq!(fast.disc_number, lofty.disc_number);
        assert!((fast.duration_seconds - lofty.duration_seconds).abs() < 0.01);

        let mut fast_cover_reader = CountingCursor {
            inner: Cursor::new(bytes.clone()),
            bytes_read: 0,
        };
        let fast_cover_started = std::time::Instant::now();
        let fast_cover = match extension.as_str() {
            "flac" => embedded_flac_cover(&mut fast_cover_reader).unwrap(),
            "m4a" | "alac" => {
                embedded_mp4_cover(&mut fast_cover_reader, bytes.len() as u64).unwrap()
            }
            _ => unreachable!(),
        };
        let fast_cover_elapsed = fast_cover_started.elapsed();
        let mut lofty_cover_reader = CountingCursor {
            inner: Cursor::new(bytes),
            bytes_read: 0,
        };
        let lofty_cover_started = std::time::Instant::now();
        let lofty_cover = embedded_cover_with_lofty(&mut lofty_cover_reader);
        let lofty_cover_elapsed = lofty_cover_started.elapsed();
        assert_eq!(fast_cover, lofty_cover);
        eprintln!(
            "extension={extension} file_bytes={} fast_bytes={} lofty_bytes={} fast_us={} lofty_us={} fast_cover_bytes={} lofty_cover_bytes={} fast_cover_us={} lofty_cover_us={}",
            fast_reader.inner.get_ref().len(),
            fast_reader.bytes_read,
            lofty_reader.bytes_read,
            fast_elapsed.as_micros(),
            lofty_elapsed.as_micros(),
            fast_cover_reader.bytes_read,
            lofty_cover_reader.bytes_read,
            fast_cover_elapsed.as_micros(),
            lofty_cover_elapsed.as_micros(),
        );
    }

    #[test]
    #[ignore = "set PARSON_PARSE_BENCH_FILE to any supported real audio file"]
    fn benchmarks_production_parser_io_on_external_file() {
        let path = std::env::var("PARSON_PARSE_BENCH_FILE")
            .expect("PARSON_PARSE_BENCH_FILE must point to audio media");
        let extension = Path::new(&path)
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let size = std::fs::metadata(&path).expect("benchmark metadata").len();
        let file = discovered_file(&path, &extension, size as i64);
        let started = std::time::Instant::now();
        let parsed = super::parse_audio_file(&file, "");
        println!(
            "PRODUCTION_PARSE extension={} strategy={:?} elapsed_us={} size={} bytes_read={} read_calls={} seeks={} fallbacks={} error={:?}",
            extension,
            parsed.parse_strategy,
            started.elapsed().as_micros(),
            size,
            parsed.bytes_read,
            parsed.read_calls,
            parsed.seeks,
            parsed.parser_fallbacks,
            parsed.error,
        );
        assert!(parsed.error.is_none(), "production parse failed");
    }

    #[test]
    fn mp3_metadata_skips_large_embedded_art_during_the_cold_pass() {
        use id3::frame::{Picture, PictureType};
        use id3::{Tag, TagLike, Version};

        let mut tag = Tag::new();
        tag.set_title("Track");
        tag.set_album("Album");
        tag.set_artist("Artist");
        tag.set_track(7);
        tag.add_frame(Picture {
            mime_type: "image/jpeg".into(),
            picture_type: PictureType::CoverFront,
            description: "Front".into(),
            data: vec![0x5a; 2 * 1024 * 1024],
        });
        for version in [Version::Id3v22, Version::Id3v23, Version::Id3v24] {
            let mut bytes = Vec::new();
            tag.write_to(&mut bytes, version)
                .expect("encode ID3 fixture");
            bytes.extend(mpeg1_layer3_file(64 * 1024));
            let length = bytes.len() as u64;
            let mut legacy_reader = CountingCursor {
                inner: Cursor::new(bytes.clone()),
                bytes_read: 0,
            };
            id3::Tag::read_from2(&mut legacy_reader).expect("legacy full-tag read");
            let mut reader = CountingCursor {
                inner: Cursor::new(bytes),
                bytes_read: 0,
            };

            let metadata = parse_mp3(&mut reader, length).expect("parse MP3 fixture");

            assert_eq!(metadata.title.as_deref(), Some("Track"));
            assert_eq!(metadata.album.as_deref(), Some("Album"));
            assert_eq!(metadata.track_artists, ["Artist"]);
            assert_eq!(metadata.track_number, 7);
            assert!(
                reader.bytes_read.saturating_mul(16) < legacy_reader.bytes_read,
                "compact {version:?} parser read {} bytes versus {} for the full tag",
                reader.bytes_read,
                legacy_reader.bytes_read,
            );
        }
    }

    #[test]
    fn mp3_duration_prefers_xing_frame_count() {
        let mut bytes = mpeg1_layer3_file(64 * 1024);
        bytes[36..40].copy_from_slice(b"Xing");
        bytes[40..44].copy_from_slice(&1_u32.to_be_bytes());
        bytes[44..48].copy_from_slice(&1_000_u32.to_be_bytes());
        let length = bytes.len() as u64;

        let mut reader = Cursor::new(bytes);
        let (duration, source) = mp3_duration(&mut reader, length).unwrap();

        assert_eq!(source, DurationSource::HeaderDerived);
        assert!((duration - 26.122_448).abs() < 0.001);
        assert!(reader.position() <= 8 * 1024);
    }

    #[test]
    fn mp3_duration_accepts_info_frame_count() {
        let mut bytes = mpeg1_layer3_file(64 * 1024);
        bytes[36..40].copy_from_slice(b"Info");
        bytes[40..44].copy_from_slice(&1_u32.to_be_bytes());
        bytes[44..48].copy_from_slice(&500_u32.to_be_bytes());
        let length = bytes.len() as u64;

        let (duration, source) = mp3_duration(&mut Cursor::new(bytes), length).unwrap();

        assert_eq!(source, DurationSource::HeaderDerived);
        assert!((duration - 13.061_224).abs() < 0.001);
    }

    #[test]
    fn mp3_duration_checks_vbri_before_estimating_cbr() {
        let mut bytes = mpeg1_layer3_file(64 * 1024);
        bytes[36..40].copy_from_slice(b"VBRI");
        bytes[50..54].copy_from_slice(&2_000_u32.to_be_bytes());
        let length = bytes.len() as u64;

        let (duration, source) = mp3_duration(&mut Cursor::new(bytes), length).unwrap();

        assert_eq!(source, DurationSource::HeaderDerived);
        assert!((duration - 52.244_897).abs() < 0.001);
    }

    #[test]
    fn mp3_duration_uses_file_length_and_bitrate_for_cbr() {
        let bytes = mpeg1_layer3_file(16_000);
        let length = bytes.len() as u64;

        let (duration, source) = mp3_duration(&mut Cursor::new(bytes), length).unwrap();

        assert_eq!(source, DurationSource::Estimated);
        assert!((duration - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn mp3_duration_retains_the_wide_fallback_for_leading_junk() {
        let mut bytes = vec![0; 32 * 1024];
        bytes[20_000..20_004].copy_from_slice(&[0xff, 0xfb, 0x90, 0x00]);
        let length = bytes.len() as u64;
        let mut reader = Cursor::new(bytes);

        let (duration, source) = mp3_duration(&mut reader, length).unwrap();

        assert_eq!(source, DurationSource::Estimated);
        assert!(duration > 0.0);
        assert!(reader.position() > 8 * 1024);
    }

    #[test]
    fn reusable_metadata_does_not_require_a_cover() {
        let mut file = discovered_file("track.mp3", "mp3", 512);
        file.modified_at_ns = 123;
        file.tag_fingerprint = Some("tag".into());
        assert!(raw_metadata_reusable(
            &reusable_snapshot(),
            &file,
            LibraryIndexPhase::Enriched
        ));
    }

    #[test]
    fn reusable_metadata_requires_matching_stable_identity_when_available() {
        let mut file = discovered_file("renamed.mp3", "mp3", 512);
        file.modified_at_ns = 123;
        file.tag_fingerprint = Some("tag".into());
        file.stable_identity = Some("file-id".into());
        assert!(raw_metadata_reusable(
            &reusable_snapshot(),
            &file,
            LibraryIndexPhase::Enriched
        ));

        file.stable_identity = Some("replacement-id".into());
        assert!(!raw_metadata_reusable(
            &reusable_snapshot(),
            &file,
            LibraryIndexPhase::Enriched
        ));
    }

    #[test]
    fn resolver_changes_clear_stale_fallbacks_without_clearing_warm_embedded_art() {
        let mut stale = parsed_track("/library/release/01.flac", "First", 1, 180.0);
        stale.cover_url = "/library/release/c.jpg".into();
        assert!(super::reconcile_reused_cover(
            &mut stale,
            String::new(),
            true
        ));
        assert!(stale.cover_url.is_empty());

        let mut warm = parsed_track("/library/release/01.flac", "First", 1, 180.0);
        warm.cover_url = "/managed/embedded.jpg".into();
        assert!(!super::reconcile_reused_cover(
            &mut warm,
            String::new(),
            false
        ));
        assert_eq!(warm.cover_url, "/managed/embedded.jpg");
    }

    #[test]
    fn artist_typo_gate_accepts_one_edit_but_not_similar_real_names() {
        assert!(artist_identity_is_one_edit_apart(
            "mrogan vale",
            "morgan vale"
        ));
        assert!(!artist_identity_is_one_edit_apart(
            "the jackson 5",
            "the jacksons"
        ));
        assert!(!artist_identity_is_one_edit_apart(
            "morgan vale",
            "marlon vale"
        ));
    }

    #[test]
    fn release_years_use_valid_metadata_consensus_or_an_unambiguous_folder_year() {
        assert_eq!(
            normalized_release_date("2000-02-29").as_deref(),
            Some("2000")
        );
        assert_eq!(normalized_release_date("not-a-year"), None);
        assert_eq!(
            consensus_release_date(&["2002-11-05".into(), "2002-11-05".into()], &[],),
            "2002"
        );
        assert_eq!(
            consensus_release_date(&["2002".into(), "2002-11-05".into()], &[]),
            "2002"
        );
        assert_eq!(
            consensus_release_date(
                &["1992".into(), "1992".into()],
                &["C:/Music/1991 Open Circuit/01.mp3".into()],
            ),
            "1991"
        );
        assert_eq!(
            consensus_release_date(
                &["1992".into()],
                &["C:/Music/1 Studio albums/1991 Open Circuit @320".into()],
            ),
            "1991"
        );
        assert_eq!(
            consensus_release_date(
                &["2007-10-29".into()],
                &["C:/Music/2007 Night Signal/01.mp3".into()],
            ),
            "2007"
        );
        assert_eq!(
            consensus_release_date(
                &[],
                &[
                    "C:/Music/1987 Second Wind/CD1/01.mp3".into(),
                    "C:/Music/1987 Second Wind/CD2/01.mp3".into(),
                ],
            ),
            "1987"
        );
        assert_eq!(
            consensus_release_date(
                &[],
                &["C:/Music/1969-1975 Archive Collection/01.mp3".into()],
            ),
            ""
        );
    }

    #[test]
    fn duplicate_tracks_require_matching_release_slot_title_and_duration() {
        let parsed = vec![
            parsed_track("C:/mp3/01.mp3", "Solara", 1, 294.866),
            parsed_track("C:/flac/01.flac", "Solára", 1, 294.896),
            parsed_track("C:/mp3/02.mp3", "Keep the Light", 2, 283.664),
            parsed_track(
                "C:/flac/02.flac",
                "Keep the Light (featuring Guest Voice)",
                2,
                283.626,
            ),
            parsed_track("C:/one/03.mp3", "Intro", 3, 30.0),
            parsed_track("C:/two/03.mp3", "Intro", 3, 45.0),
            parsed_track("C:/one/04.mp3", "Song One", 4, 240.0),
            parsed_track("C:/two/04.mp3", "Song Two", 4, 240.0),
        ];
        let discovered = parsed
            .iter()
            .map(|track| {
                let extension = if track.path.ends_with(".flac") {
                    "flac"
                } else {
                    "mp3"
                };
                discovered_file(&track.path, extension, 10_000_000)
            })
            .collect::<Vec<_>>();
        let discovered_by_path = discovered
            .iter()
            .map(|file| (file.path.as_ref(), file))
            .collect::<std::collections::HashMap<_, _>>();
        let mut interner = super::StringInterner::with_capacity(parsed.len() * 8);
        let seeds = super::prepare_track_seeds(&parsed, &mut interner);
        let aliases = infer_artist_aliases(&seeds);
        let album_artists = infer_album_artists(&seeds, &aliases);
        let prepared = super::prepare_tracks(seeds, &aliases, &album_artists, &mut interner);

        let resolved = resolve_duplicate_tracks(&prepared, &discovered_by_path);

        assert_eq!(resolved["C:/mp3/01.mp3"].id, resolved["C:/flac/01.flac"].id);
        assert_eq!(resolved["C:/mp3/01.mp3"].title, "Solára");
        assert_eq!(resolved["C:/mp3/02.mp3"].id, resolved["C:/flac/02.flac"].id);
        assert_eq!(
            resolved["C:/mp3/02.mp3"].title,
            "Keep the Light (featuring Guest Voice)"
        );
        assert!(!resolved.contains_key("C:/one/03.mp3"));
        assert!(!resolved.contains_key("C:/one/04.mp3"));
    }

    #[test]
    fn slash_decorations_require_the_complete_leading_artist() {
        assert!(slash_decorated_variant(
            "morgan vale/Alexelie",
            "Morgan Vale"
        ));
        assert!(!slash_decorated_variant("North/South", "North/South"));
        assert!(!slash_decorated_variant("Artist One/Artist Two", "Artist"));
    }

    #[test]
    fn empty_scans_fail_before_database_initialization() {
        let directory =
            std::env::temp_dir().join(format!("music-empty-scan-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("empty scan directory");
        let result =
            index_library_to_database(directory.to_str().expect("UTF-8 empty scan directory"));
        std::fs::remove_dir_all(directory).expect("empty scan cleanup");
        let error = match result {
            Ok(_) => panic!("empty scan should be rejected"),
            Err(error) => error,
        };
        assert!(
            error.to_string().contains("no supported audio files"),
            "unexpected empty scan error: {error}"
        );
    }

    #[test]
    fn resolves_editions_relative_to_the_available_catalog() {
        let mut evidence = std::collections::HashMap::new();
        evidence.insert(
            "original".to_string(),
            OwnedReleaseEvidence {
                album_name: "First Light".to_string(),
                album_artist: "Morgan Vale".to_string(),
                paths: vec!["C:/Music/First Light".to_string()],
                track_titles: vec!["Open the Morning".to_string(); 9],
                track_durations: Vec::new(),
                genres: Vec::new(),
                release_dates: vec!["1982".to_string(); 9],
                directory_years: Vec::new(),
            },
        );
        evidence.insert(
            "edition".to_string(),
            OwnedReleaseEvidence {
                album_name: "First Light (Special Edition)".to_string(),
                album_artist: "Morgan Vale".to_string(),
                paths: vec!["C:/Music/First Light Special".to_string()],
                track_titles: vec!["Open the Morning".to_string(); 12],
                track_durations: Vec::new(),
                genres: Vec::new(),
                release_dates: vec!["2001".to_string(); 12],
                directory_years: Vec::new(),
            },
        );
        evidence.insert(
            "only-deluxe".to_string(),
            OwnedReleaseEvidence {
                album_name: "Night Signal (Deluxe Version)".to_string(),
                album_artist: "Jordan Hale".to_string(),
                paths: vec!["C:/Music/Night Signal".to_string()],
                track_titles: vec!["One More Turn".to_string(); 15],
                track_durations: Vec::new(),
                genres: Vec::new(),
                release_dates: vec!["2007".to_string(); 15],
                directory_years: Vec::new(),
            },
        );
        evidence.insert(
            "multidisc".to_string(),
            OwnedReleaseEvidence {
                album_name: "Archive Past, Present and Future (Volume I) (Uncut Release) CD1"
                    .to_string(),
                album_artist: "Morgan Vale".to_string(),
                paths: vec!["C:/Music/Archive/CD1".to_string()],
                track_titles: vec!["Morning Line".to_string(); 30],
                track_durations: Vec::new(),
                genres: Vec::new(),
                release_dates: vec!["1995".to_string(); 30],
                directory_years: Vec::new(),
            },
        );

        let resolved = resolve_release_presentations(&evidence);
        assert_eq!(resolved["edition"].primary_type, "Special Edition");
        assert_eq!(resolved["original"].first_release_date, "1982");
        assert_eq!(resolved["edition"].first_release_date, "2001");
        assert_eq!(resolved["edition"].title, "First Light (Special Edition)");
        assert_eq!(
            resolved["edition"].release_group_id,
            resolved["original"].release_group_id
        );
        assert_eq!(
            resolved["edition"].original_album_id.as_deref(),
            Some("original")
        );
        assert!(resolved["edition"].metadata_json.contains("title_analysis"));
        assert!(resolved["edition"].metadata_json.contains("confidence"));
        assert_eq!(resolved["only-deluxe"].primary_type, "Album");
        assert_eq!(resolved["only-deluxe"].title, "Night Signal");
        assert_eq!(resolved["only-deluxe"].original_album_id, None);
        assert_eq!(resolved["only-deluxe"].release_group_title, "Night Signal");
        assert_eq!(
            resolved["multidisc"].title,
            "Archive Past, Present and Future (Volume I) (Uncut Release)"
        );
        assert_eq!(resolved["multidisc"].primary_type, "Album");
    }

    #[test]
    fn a_regional_single_variant_keeps_its_release_form() {
        let release = |album_name: &str, path: &str| OwnedReleaseEvidence {
            album_name: album_name.to_string(),
            album_artist: "Artist".to_string(),
            paths: vec![path.to_string(); 4],
            track_titles: vec!["Lead Song".to_string(); 4],
            track_durations: Vec::new(),
            genres: Vec::new(),
            release_dates: vec!["1995".to_string(); 4],
            directory_years: vec!["1995".to_string(); 4],
        };
        let evidence = HashMap::from([
            (
                "original".to_string(),
                release("Lead Song", "C:/Music/Artist/5 Single albums/Lead Song"),
            ),
            (
                "regional".to_string(),
                release(
                    "Lead Song (UK CDS2 - Austria)",
                    "C:/Music/Artist/5 Single albums/Lead Song UK",
                ),
            ),
        ]);

        let resolved = resolve_release_presentations(&evidence);
        assert_eq!(resolved["regional"].primary_type, "Single");
        assert_eq!(resolved["regional"].title, "Lead Song (UK CDS2 - Austria)");
        assert_eq!(
            resolved["regional"].original_album_id.as_deref(),
            None,
            "release variants only use edition linking for album-form releases"
        );
    }

    #[test]
    fn ambiguous_original_candidates_do_not_drive_edition_inheritance() {
        let release = |album_name: &str| OwnedReleaseEvidence {
            album_name: album_name.to_string(),
            album_artist: "Morgan Vale".to_string(),
            paths: vec![format!("/Music/{album_name}")],
            track_titles: vec!["Pulse".to_string()],
            track_durations: Vec::new(),
            genres: Vec::new(),
            release_dates: vec!["1991".to_string()],
            directory_years: Vec::new(),
        };
        let evidence = HashMap::from([
            ("disc-one".to_string(), release("Open Circuit CD1")),
            ("disc-two".to_string(), release("Open Circuit CD2")),
            (
                "edition".to_string(),
                release("Open Circuit (Special Edition)"),
            ),
        ]);

        let resolved = resolve_release_presentations(&evidence);

        assert_eq!(resolved["edition"].original_album_id, None);
    }

    #[test]
    fn legacy_canonical_database_titles_recover_the_complete_display_title() {
        let metadata = super::StoredReleaseMetadata {
            title_analysis: Some(super::analyze_release_title("Ready for Dawn: The Remaster")),
        };

        assert_eq!(
            super::catalog_album_title("Ready for Dawn: The".into(), Some(&metadata)),
            "Ready for Dawn: The Remaster"
        );
        assert_eq!(
            super::catalog_album_title("Unchanged title".into(), None),
            "Unchanged title"
        );

        let lone_deluxe = super::StoredReleaseMetadata {
            title_analysis: Some(super::analyze_release_title(
                "Night Signal (Deluxe Version)",
            )),
        };
        assert_eq!(
            super::catalog_album_title("Night Signal".into(), Some(&lone_deluxe)),
            "Night Signal"
        );
    }

    #[test]
    fn front_art_beats_back_art() {
        let directory =
            std::env::temp_dir().join(format!("music-cover-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("create cover fixture directory");
        image::RgbImage::new(600, 470)
            .save(directory.join("b.jpeg"))
            .expect("write back fixture");
        image::RgbImage::new(350, 350)
            .save(directory.join("f.jpeg"))
            .expect("write front fixture");

        let selected = local_cover_for(&directory.join("track.mp3"));
        assert!(selected.ends_with("f.jpeg"), "selected {selected}");
        std::fs::remove_dir_all(directory).expect("remove cover fixture directory");
    }

    #[test]
    fn cover_cache_signature_changes_with_the_resolver() {
        let candidates = vec![super::DiscoveredImage {
            path: PathBuf::from("Album/front.jpg"),
            size_bytes: 42,
            modified_at_ns: 7,
        }];

        let previous = super::inventory_signature_for_version(&candidates, "legacy");
        let current = super::inventory_signature(&candidates);

        assert_ne!(previous, current);
        assert_eq!(
            current,
            super::inventory_signature(&candidates),
            "the same resolver and inventory should retain a warm cache hit"
        );
    }

    #[test]
    fn repair_scans_bypass_matching_cover_cache_entries() {
        let cached = super::CoverCacheRow {
            directory: "/library/release".into(),
            inventory_signature: "matching-signature".into(),
            cover_path: "/library/release/front.jpg".into(),
            content_hash: Some("cached-hash".into()),
        };

        assert!(super::cached_cover_is_reusable(
            &cached,
            "matching-signature",
            true
        ));
        assert!(!super::cached_cover_is_reusable(
            &cached,
            "matching-signature",
            false
        ));
    }

    #[test]
    fn front_cover_aliases_beat_back_and_booklet_scans() {
        for front_name in [
            "F.JPG",
            "front.jpeg",
            "frontcover.jpg",
            "album-front.png",
            "AlbumArtSmall.jpg",
            "folder.webp",
            "cover.jpg",
            "jacket.jpg",
            "sleeve.png",
        ] {
            let directory = std::env::temp_dir()
                .join(format!("music-cover-alias-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&directory).expect("create cover alias fixture");
            image::RgbImage::new(900, 900)
                .save(directory.join("back.jpg"))
                .expect("write back fixture");
            image::RgbImage::new(900, 900)
                .save(directory.join("booklet-01.jpg"))
                .expect("write booklet fixture");
            image::RgbImage::new(400, 400)
                .save(directory.join(front_name))
                .expect("write front fixture");

            let selected = local_cover_for(&directory.join("track.flac"));
            assert!(
                selected.ends_with(front_name),
                "{front_name} should win, selected {selected}"
            );
            std::fs::remove_dir_all(directory).expect("remove cover alias fixture");
        }
    }

    #[test]
    fn ambiguous_single_letter_scan_does_not_override_an_earlier_square_candidate() {
        let directory = std::env::temp_dir().join(format!(
            "music-ambiguous-cover-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).expect("create ambiguous cover fixture");
        image::RgbImage::new(320, 320)
            .save(directory.join("a.jpg"))
            .expect("write first cover candidate");
        image::RgbImage::new(1200, 1200)
            .save(directory.join("c.jpg"))
            .expect("write ambiguous scan candidate");

        let selected = local_cover_for(&directory.join("track.mp3"));

        assert!(selected.ends_with("a.jpg"), "selected {selected}");
        std::fs::remove_dir_all(directory).expect("remove ambiguous cover fixture");
    }

    #[test]
    fn corrupt_named_cover_does_not_override_a_decodable_candidate() {
        let directory =
            std::env::temp_dir().join(format!("music-obvious-cover-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("create obvious cover fixture");
        std::fs::write(directory.join("folder.jpg"), b"not an encoded image")
            .expect("write filename-only cover fixture");
        image::RgbImage::new(800, 800)
            .save(directory.join("scan.png"))
            .expect("write decodable alternative fixture");

        let selected = local_cover_for(&directory.join("track.mp3"));
        assert!(selected.ends_with("scan.png"), "selected {selected}");
        std::fs::remove_dir_all(directory).expect("remove obvious cover fixture");
    }

    #[test]
    fn ambiguous_artwork_is_fallback_while_square_named_front_art_is_preferred() {
        let directory = std::env::temp_dir().join(format!(
            "music-cover-confidence-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).expect("create cover confidence fixture");

        image::RgbImage::new(1200, 600)
            .save(directory.join("cover.jpg"))
            .expect("write panoramic named cover");
        let panoramic = super::local_cover_resolution_for(&directory.join("track.mp3"));
        assert!(panoramic.path.ends_with("cover.jpg"));
        assert!(!panoramic.preferred);

        image::RgbImage::new(600, 600)
            .save(directory.join("scan.jpg"))
            .expect("write square alternative");
        let square_over_panorama = super::local_cover_resolution_for(&directory.join("track.mp3"));
        assert!(square_over_panorama.path.ends_with("scan.jpg"));
        assert!(!square_over_panorama.preferred);

        std::fs::remove_file(directory.join("cover.jpg")).expect("remove panoramic cover");
        std::fs::remove_file(directory.join("scan.jpg")).expect("remove square alternative");
        image::RgbImage::new(1200, 600)
            .save(directory.join("scan.jpg"))
            .expect("write generic panoramic artwork");
        let generic_panorama = super::local_cover_resolution_for(&directory.join("track.mp3"));
        assert!(generic_panorama.path.is_empty());

        std::fs::remove_file(directory.join("scan.jpg")).expect("remove generic panorama");
        image::RgbImage::new(120, 120)
            .save(directory.join("front.jpg"))
            .expect("write tiny named cover");
        let tiny = super::local_cover_resolution_for(&directory.join("track.mp3"));
        assert!(tiny.path.ends_with("front.jpg"));
        assert!(!tiny.preferred);

        image::RgbImage::new(600, 600)
            .save(directory.join("scan.jpg"))
            .expect("write full-size alternative");
        let full_size_over_tiny = super::local_cover_resolution_for(&directory.join("track.mp3"));
        assert!(full_size_over_tiny.path.ends_with("scan.jpg"));
        assert!(!full_size_over_tiny.preferred);

        std::fs::remove_file(directory.join("front.jpg")).expect("remove tiny cover");
        let generic = super::local_cover_resolution_for(&directory.join("track.mp3"));
        assert!(generic.path.ends_with("scan.jpg"));
        assert!(!generic.preferred);

        std::fs::remove_file(directory.join("scan.jpg")).expect("remove generic artwork");
        image::RgbImage::new(600, 600)
            .save(directory.join("front.jpg"))
            .expect("write square named cover");
        let preferred = super::local_cover_resolution_for(&directory.join("track.mp3"));
        assert!(preferred.path.ends_with("front.jpg"));
        assert!(preferred.preferred);

        std::fs::remove_dir_all(directory).expect("remove cover confidence fixture");
    }

    #[test]
    fn paired_cover_spreads_extract_the_front_panel() {
        let root =
            std::env::temp_dir().join(format!("music-cover-spread-test-{}", uuid::Uuid::new_v4()));
        let managed = root.join("managed");
        std::fs::create_dir_all(&managed).expect("create managed cover fixture");

        let landscape = root.join("landscape");
        std::fs::create_dir_all(&landscape).expect("create landscape cover fixture");
        image::RgbImage::new(500, 500)
            .save(landscape.join("rear.jpg"))
            .expect("write landscape back fixture");
        image::RgbImage::from_fn(800, 400, |x, _| {
            if x < 400 {
                image::Rgb([220, 20, 20])
            } else {
                image::Rgb([20, 220, 20])
            }
        })
        .save(landscape.join("scan.jpg"))
        .expect("write landscape spread fixture");
        let landscape_inventory = super::reconcile_files(&super::normalize_path(&landscape));
        let landscape_cover = super::resolve_inventory_cover_with_storage(
            &super::inventory_candidates(&landscape_inventory, &landscape),
            &landscape,
            Some(&managed),
        );
        let landscape_pixels = image::open(&landscape_cover.path)
            .expect("decode extracted landscape cover")
            .to_rgb8();
        assert!(!landscape_cover.preferred);
        assert_eq!(landscape_pixels.dimensions(), (400, 400));
        let landscape_center = landscape_pixels.get_pixel(200, 200);
        assert!(landscape_center[1] > 180 && landscape_center[0] < 60);

        image::RgbImage::new(400, 360)
            .save(landscape.join("front.jpg"))
            .expect("write explicit front fixture");
        let explicit_inventory = super::reconcile_files(&super::normalize_path(&landscape));
        let explicit_cover = super::resolve_inventory_cover_with_storage(
            &super::inventory_candidates(&explicit_inventory, &landscape),
            &landscape,
            Some(&managed),
        );
        assert!(explicit_cover.path.ends_with("front.jpg"));

        let portrait = root.join("portrait");
        std::fs::create_dir_all(&portrait).expect("create portrait cover fixture");
        image::RgbImage::new(500, 500)
            .save(portrait.join("back.jpg"))
            .expect("write portrait back fixture");
        image::RgbImage::from_fn(400, 800, |x, y| {
            if y >= 400 {
                image::Rgb([20, 220, 20])
            } else if x < 200 {
                image::Rgb([220, 20, 20])
            } else {
                image::Rgb([20, 20, 220])
            }
        })
        .save(portrait.join("artwork.jpg"))
        .expect("write portrait spread fixture");
        let portrait_inventory = super::reconcile_files(&super::normalize_path(&portrait));
        let portrait_cover = super::resolve_inventory_cover_with_storage(
            &super::inventory_candidates(&portrait_inventory, &portrait),
            &portrait,
            Some(&managed),
        );
        let portrait_pixels = image::open(&portrait_cover.path)
            .expect("decode extracted portrait cover")
            .to_rgb8();
        assert!(!portrait_cover.preferred);
        assert_eq!(portrait_pixels.dimensions(), (400, 400));
        let portrait_top = portrait_pixels.get_pixel(200, 80);
        let portrait_bottom = portrait_pixels.get_pixel(200, 320);
        assert!(portrait_top[0] > 180 && portrait_top[2] < 60);
        assert!(portrait_bottom[2] > 180 && portrait_bottom[0] < 60);

        std::fs::remove_dir_all(root).expect("remove cover spread fixture");
    }

    #[test]
    fn back_and_booklet_art_are_not_used_as_last_resort_covers() {
        for name in [
            "back.jpg",
            "backcover.jpg",
            "coverback.jpg",
            "front-back.jpg",
            "rear.png",
            "booklet01.jpg",
            "traycard.jpg",
            "inlay.png",
            "cd1.jpg",
            "disc.webp",
            "inside.jpg",
            "spine.jpg",
            "obi.jpg",
            "artist.jpg",
            "logo.png",
            "fanart.jpg",
            "banner.jpg",
        ] {
            let directory = std::env::temp_dir().join(format!(
                "music-non-front-cover-test-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&directory).expect("create non-front fixture");
            image::RgbImage::new(800, 800)
                .save(directory.join(name))
                .expect("write non-front artwork");

            let selected = super::local_cover_resolution_for(&directory.join("track.mp3"));

            assert!(selected.path.is_empty(), "selected {}", selected.path);
            std::fs::remove_dir_all(directory).expect("remove non-front fixture");
        }
    }

    #[test]
    fn local_fallback_is_used_only_when_embedded_art_is_absent() {
        let fallback_covers =
            HashMap::from([("/library/release", "/library/release/a.jpg".to_string())]);
        let refresh_paths = HashSet::from(["/library/release/01.flac".to_string()]);
        let mut with_embedded = vec![parsed_track("/library/release/01.flac", "First", 1, 180.0)];
        with_embedded[0].cover_url = "/managed/embedded.jpg".into();

        super::attach_fallback_local_covers(&mut with_embedded, &fallback_covers, &refresh_paths);
        assert_eq!(with_embedded[0].cover_url, "/managed/embedded.jpg");

        let mut without_embedded =
            vec![parsed_track("/library/release/01.flac", "First", 1, 180.0)];
        super::attach_fallback_local_covers(
            &mut without_embedded,
            &fallback_covers,
            &refresh_paths,
        );
        assert_eq!(without_embedded[0].cover_url, "/library/release/a.jpg");
    }

    #[test]
    fn embedded_cover_lookup_opens_only_one_changed_representative_per_album() {
        let parsed = vec![
            parsed_track("first.mp3", "First", 1, 1.0),
            parsed_track("second.mp3", "Second", 2, 1.0),
            parsed_track("unchanged.mp3", "Unchanged", 3, 1.0),
        ];
        let refresh_paths = HashSet::from(["first.mp3".to_string(), "second.mp3".to_string()]);

        let representative = embedded_cover_representative(&[0, 1, 2], &parsed, &refresh_paths)
            .expect("one changed representative");

        assert_eq!(&*representative.path, "first.mp3");
    }

    #[test]
    fn embedded_cover_lookup_prefers_a_track_with_known_artwork() {
        let first = parsed_track("first.mp3", "First", 1, 1.0);
        let mut second = parsed_track("second.mp3", "Second", 2, 1.0);
        second.embedded_artwork = Some(super::EmbeddedArtworkRegion {
            offset: 128,
            length: 512,
        });
        let parsed = vec![first, second];
        let refresh_paths = HashSet::from(["first.mp3".to_string(), "second.mp3".to_string()]);

        let representative = embedded_cover_representative(&[0, 1], &parsed, &refresh_paths)
            .expect("one artwork-bearing representative");

        assert_eq!(&*representative.path, "second.mp3");
    }

    #[test]
    fn album_artwork_selection_keeps_file_level_cover_evidence() {
        let mut first = parsed_track("disc-1/first.mp3", "First", 1, 1.0);
        first.cover_url = "disc-1/front.jpg".into();
        let mut second = parsed_track("disc-2/second.mp3", "Second", 2, 1.0);
        second.cover_url = "disc-2/front.jpg".into();
        let third = parsed_track("disc-3/third.mp3", "Third", 3, 1.0);
        let mut parsed = vec![first, second, third];
        let refresh_paths = parsed
            .iter()
            .map(|record| record.path.to_string())
            .collect::<HashSet<_>>();

        super::attach_one_embedded_cover_per_album(&mut parsed, &refresh_paths);

        assert_eq!(parsed[0].cover_url, "disc-1/front.jpg");
        assert_eq!(parsed[1].cover_url, "disc-2/front.jpg");
        assert!(parsed[2].cover_url.is_empty());
    }

    #[test]
    fn core_reference_refresh_replaces_a_superseded_identity_at_the_same_path() {
        let mut connection = diesel::sqlite::SqliteConnection::establish(":memory:")
            .expect("in-memory core reference database");
        connection
            .batch_execute(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE library_scan_job (id INTEGER PRIMARY KEY);
                 INSERT INTO library_scan_job (id) VALUES (1), (2);
                 CREATE TABLE music_file_reference (
                     core_file_id TEXT NOT NULL PRIMARY KEY,
                     core_library_id TEXT NOT NULL,
                     path TEXT NOT NULL,
                     last_seen_scan_id INTEGER NOT NULL,
                     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                     UNIQUE(core_library_id, path),
                     FOREIGN KEY(last_seen_scan_id) REFERENCES library_scan_job(id)
                 );",
            )
            .expect("core reference schema");

        let library = LibraryRegistration::new(
            "C:/Music/Large Library",
            ProductCapability::new("music").expect("music capability"),
        );
        let path = "C:/Music/Large Library/Album/track.flac";
        let old_id = FileId::within(&library.id, "windows:123:456");
        diesel::sql_query(
            "INSERT INTO music_file_reference
                (core_file_id, core_library_id, path, last_seen_scan_id)
             VALUES (?, ?, ?, 1)",
        )
        .bind::<diesel::sql_types::Text, _>(old_id.as_str())
        .bind::<diesel::sql_types::Text, _>(library.id.as_str())
        .bind::<diesel::sql_types::Text, _>(path)
        .execute(&mut connection)
        .expect("legacy identity reference");

        let file = DiscoveredFile {
            native_path: PathBuf::from(path),
            native_directory: PathBuf::from("C:/Music/Large Library/Album"),
            path: path.into(),
            directory: "C:/Music/Large Library/Album".into(),
            file_name: "track.flac".into(),
            format: AudioFormat::Flac,
            size_bytes: 42,
            modified_at_ns: 7,
            stable_identity: None,
            tag_fingerprint: None,
        };
        sync_core_file_references(&mut connection, &library, 2, &[file])
            .expect("identity transition is idempotent");

        let rows =
            diesel::sql_query("SELECT core_file_id AS id FROM music_file_reference WHERE path = ?")
                .bind::<diesel::sql_types::Text, _>(path)
                .load::<super::TextIdRow>(&mut connection)
                .expect("refreshed reference");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, FileId::within(&library.id, path).as_str());
    }

    #[test]
    fn incremental_cleanup_follows_stable_files_to_superseded_normalized_identities() {
        let mut connection = SqliteConnection::establish(":memory:")
            .expect("in-memory normalized identity database");
        connection
            .batch_execute(
                "CREATE TABLE track_entity (id TEXT PRIMARY KEY, album_id TEXT);
                 CREATE TABLE track_file (track_id TEXT NOT NULL, file_id INTEGER NOT NULL);
                 CREATE TEMP TABLE library_rebuild_stage (track_id TEXT NOT NULL, file_id INTEGER);
                 CREATE TEMP TABLE affected_track (id TEXT PRIMARY KEY) WITHOUT ROWID;
                 CREATE TEMP TABLE affected_album (id TEXT PRIMARY KEY) WITHOUT ROWID;
                 INSERT INTO track_entity VALUES
                    ('available-track', 'available-album'),
                    ('unchanged-track', 'unchanged-album'),
                    ('unrelated-track', 'unrelated-album');
                 INSERT INTO track_file VALUES
                    ('available-track', 10),
                    ('unchanged-track', 20),
                    ('unrelated-track', 30);
                 INSERT INTO library_rebuild_stage VALUES
                    ('enriched-track', 10),
                    ('unchanged-track', 20);",
            )
            .expect("normalized identity fixture");

        stage_superseded_file_identities(&mut connection).expect("stage superseded identities");

        let tracks = diesel::sql_query("SELECT id FROM affected_track ORDER BY id")
            .load::<super::TextIdRow>(&mut connection)
            .expect("affected tracks")
            .into_iter()
            .map(|row| row.id)
            .collect::<Vec<_>>();
        let albums = diesel::sql_query("SELECT id FROM affected_album ORDER BY id")
            .load::<super::TextIdRow>(&mut connection)
            .expect("affected albums")
            .into_iter()
            .map(|row| row.id)
            .collect::<Vec<_>>();

        assert_eq!(tracks, ["available-track"]);
        assert_eq!(albums, ["available-album"]);
    }

    #[test]
    fn same_titled_releases_in_distinct_directories_keep_distinct_identities() {
        let mut album_track = parsed_track(
            "/music/artist/albums/2001-release/01.flac",
            "Opening Track",
            1,
            240.0,
        );
        album_track.album = "Shared Title".into();
        let mut single_track = parsed_track(
            "/music/artist/singles/2002-release/01.flac",
            "Shared Title",
            1,
            210.0,
        );
        single_track.album = "Shared Title".into();
        let parsed = vec![album_track, single_track];
        let mut interner = StringInterner::with_capacity(32);
        let seeds = prepare_track_seeds(&parsed, &mut interner);
        let album_artists = infer_album_artists(&seeds, &HashMap::new());
        let prepared = prepare_tracks(seeds, &HashMap::new(), &album_artists, &mut interner);

        assert_ne!(prepared[0].album_id, prepared[1].album_id);
        assert_ne!(prepared[0].track_id, prepared[1].track_id);
    }

    #[test]
    fn editions_inherit_original_art_only_when_their_own_cover_is_unsuitable() {
        let directory =
            std::env::temp_dir().join(format!("music-edition-cover-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("create edition cover fixture");
        let original = directory.join("original.jpg");
        let wide_edition = directory.join("edition-booklet.jpg");
        let square_edition = directory.join("edition-front.jpg");
        image::RgbImage::new(600, 600)
            .save(&original)
            .expect("write original cover");
        image::RgbImage::new(1200, 600)
            .save(&wide_edition)
            .expect("write unsuitable edition art");
        image::RgbImage::new(700, 700)
            .save(&square_edition)
            .expect("write preferred edition cover");

        let mut evidence = HashMap::new();
        evidence.insert(
            "original".to_string(),
            OwnedReleaseEvidence {
                album_name: "Open Circuit".to_string(),
                album_artist: "Morgan Vale".to_string(),
                paths: vec!["/Music/Open Circuit".to_string()],
                track_titles: vec!["Pulse".to_string()],
                track_durations: Vec::new(),
                genres: Vec::new(),
                release_dates: vec!["1991".to_string()],
                directory_years: Vec::new(),
            },
        );
        evidence.insert(
            "edition".to_string(),
            OwnedReleaseEvidence {
                album_name: "Open Circuit (Special Edition)".to_string(),
                album_artist: "Morgan Vale".to_string(),
                paths: vec!["/Music/Open Circuit Special Edition".to_string()],
                track_titles: vec!["Pulse".to_string()],
                track_durations: Vec::new(),
                genres: Vec::new(),
                release_dates: vec!["2001".to_string()],
                directory_years: Vec::new(),
            },
        );
        let presentations = resolve_release_presentations(&evidence);
        let original_path = original.to_string_lossy().into_owned();
        let wide_path = wide_edition.to_string_lossy().into_owned();
        let square_path = square_edition.to_string_lossy().into_owned();

        let mut covers = HashMap::from([
            ("original".to_string(), original_path.clone()),
            ("edition".to_string(), wide_path),
        ]);
        inherit_original_release_covers(&mut covers, &presentations);
        assert_eq!(covers["edition"], original_path);

        covers.insert("edition".to_string(), square_path.clone());
        inherit_original_release_covers(&mut covers, &presentations);
        assert_eq!(covers["edition"], square_path);

        covers.remove("edition");
        inherit_original_release_covers(&mut covers, &presentations);
        assert_eq!(covers["edition"], original_path);

        std::fs::remove_dir_all(directory).expect("remove edition cover fixture");
    }

    #[test]
    fn multidisc_tracks_find_release_level_artwork() {
        let directory = std::env::temp_dir().join(format!(
            "music-multidisc-cover-test-{}",
            uuid::Uuid::new_v4()
        ));
        let disc = directory.join("CD 1");
        std::fs::create_dir_all(&disc).expect("create multidisc fixture");
        image::RgbImage::new(600, 600)
            .save(directory.join("front.jpg"))
            .expect("write release-level cover");

        let selected = local_cover_for(&disc.join("01 Track.mp3"));
        assert!(selected.ends_with("front.jpg"), "selected {selected}");
        std::fs::remove_dir_all(directory).expect("remove multidisc fixture");
    }

    #[test]
    fn artwork_subdirectories_contribute_front_covers_without_contributing_back_scans() {
        let directory = std::env::temp_dir().join(format!(
            "music-artwork-directory-test-{}",
            uuid::Uuid::new_v4()
        ));
        let artwork = directory.join("Artwork");
        std::fs::create_dir_all(&artwork).expect("create artwork directory fixture");
        image::RgbImage::new(900, 900)
            .save(directory.join("back.jpg"))
            .expect("write release-level back scan");
        image::RgbImage::new(600, 600)
            .save(artwork.join("front.jpg"))
            .expect("write nested front cover");

        let selected = super::local_cover_resolution_for(&directory.join("track.flac"));

        assert!(selected.path.ends_with("Artwork/front.jpg"));
        assert!(selected.preferred);
        std::fs::remove_dir_all(directory).expect("remove artwork directory fixture");
    }

    #[test]
    fn progressive_catalog_hydrates_album_and_artist_artwork() {
        let directory = std::env::temp_dir().join(format!(
            "music-progressive-cover-test-{}",
            uuid::Uuid::new_v4()
        ));
        let disc = directory.join("Disc 1");
        std::fs::create_dir_all(&disc).expect("create progressive artwork fixture");
        let track = disc.join("01 Track.flac");
        std::fs::write(&track, []).expect("write representative track");
        let cover = directory.join("folder.jpg");
        std::fs::write(&cover, [1_u8]).expect("write local artwork");
        let mut catalog = vec![crate::domain::Artist {
            albums: vec![crate::domain::Album {
                songs: vec![crate::domain::Song {
                    path: track.to_string_lossy().into_owned(),
                    ..crate::domain::Song::default()
                }],
                ..crate::domain::Album::default()
            }],
            ..crate::domain::Artist::default()
        }];

        hydrate_progressive_catalog_artwork(&mut catalog);

        assert_eq!(catalog[0].albums[0].cover_url, cover.to_string_lossy());
        assert_eq!(catalog[0].icon_url, cover.to_string_lossy());
        std::fs::remove_dir_all(directory).expect("remove progressive artwork fixture");
    }

    #[test]
    fn splits_embedded_genres_without_splitting_r_and_b() {
        assert_eq!(
            split_genres("R&B; Pop/Rock, Soul"),
            vec!["Pop", "R&B", "Rock", "Soul"]
        );
        assert_eq!(normalize_genre_key("R&B"), normalize_genre_key("Rnb"));
        assert_eq!(
            normalize_genre_key("Pop-Rock"),
            normalize_genre_key("Pop Rock")
        );
    }

    #[test]
    #[ignore = "requires PARSON_TEST_LIBRARY and performs a full external library scan"]
    fn indexes_and_categorizes_external_library() {
        let _ = tracing_subscriber::fmt()
            .with_env_filter(tracing_subscriber::EnvFilter::new("info"))
            .try_init();
        let path = std::env::var("PARSON_TEST_LIBRARY")
            .expect("PARSON_TEST_LIBRARY must point to the library under audit");
        let (artists, report) = index_library_to_database(&path).expect("external library index");
        println!(
            "INDEX_REPORT={}",
            serde_json::to_string(&report).expect("serialize index report")
        );

        assert!(report.scanned_files > 0, "the external library was empty");
        assert!(
            !artists.is_empty(),
            "the external library produced no artists"
        );

        let mut categories = BTreeMap::<String, usize>::new();
        let mut releases = Vec::new();
        for artist in &artists {
            assert_eq!(artist.id.len(), 16, "verbose artist id: {}", artist.id);
            for album in &artist.albums {
                assert_eq!(album.id.len(), 16, "verbose album id: {}", album.id);
                *categories.entry(album.primary_type.clone()).or_default() += 1;
                releases.push(format!(
                    "{}\t{}\t{}\t{}",
                    album.primary_type,
                    artist.name,
                    album.name,
                    album.songs.len()
                ));
                for song in &album.songs {
                    assert_eq!(song.id.len(), 16, "verbose song id: {}", song.id);
                }
            }
        }

        releases.sort();
        println!(
            "CATEGORY_COUNTS={}",
            serde_json::to_string(&categories).unwrap()
        );
        println!("RELEASES_BEGIN");
        for release in releases {
            println!("{release}");
        }
        println!("RELEASES_END");
    }

    #[test]
    #[ignore = "requires PARSON_TEST_LIBRARY and benchmarks two complete external scans"]
    fn benchmarks_external_library_warm_refresh() {
        let path = std::env::var("PARSON_TEST_LIBRARY")
            .expect("PARSON_TEST_LIBRARY must point to the benchmark library");
        let canonical = std::fs::canonicalize(&path).expect("benchmark root must exist");
        assert_eq!(canonical, Path::new(&path).canonicalize().unwrap());
        let (first_catalog, first) =
            index_library_to_database(&path).expect("first external library index");
        let (warm_catalog, warm) =
            index_library_to_database(&path).expect("warm external library index");
        println!(
            "FIRST_TOTAL_US={} WARM_TOTAL_US={} FILES={} BYTES_READ={} BYTES_P50={} BYTES_P95={} OPENS={} METADATA_OPS={} READS={} SEEKS={} FALLBACKS={} ENUM_US={} PARSE_WALL_US={} STAGE_US={} PARSE_STAGE_OVERLAP_PERCENT={} COMMIT_US={} PROJECT_US={} CPU_US={} CPU_PERCENT={} QUEUE_DEPTH={} EXPLAINED_PERCENT={} WARM_EXPLAINED_PERCENT={}",
            first.timing.total_us,
            warm.timing.total_us,
            first.scanned_files,
            first.timing.bytes_read,
            first.timing.bytes_read_p50,
            first.timing.bytes_read_p95,
            first.timing.file_opens,
            first.timing.metadata_operations,
            first.timing.read_calls,
            first.timing.seeks,
            first.timing.parser_fallbacks,
            first.timing.enumeration_us,
            first.timing.parsing_wall_us,
            first.timing.database_staging_us,
            first.timing.parsing_database_overlap_percent,
            first.timing.database_commit_us,
            first.timing.normalization_inference_us,
            first.timing.cpu_time_us,
            first.timing.cpu_utilization_percent,
            first.timing.storage_queue_depth,
            first.timing.explained_wall_percent,
            warm.timing.explained_wall_percent,
        );
        assert_eq!(
            serde_json::to_value(&first_catalog).unwrap(),
            serde_json::to_value(&warm_catalog).unwrap()
        );
        assert!(first.timing.bytes_read_p50 < 64 * 1024);
        assert!(first.timing.bytes_read_p95 < 256 * 1024);
        assert!(first.timing.parsing_database_overlap_percent >= 80);
        assert!(first.timing.explained_wall_percent >= 95.0);
        assert!(warm.timing.explained_wall_percent >= 95.0);
        assert_eq!(warm.scanned_files, first.scanned_files);
        assert_eq!(warm.indexed_files, 0);
        assert!(warm.timing.total_us < first.timing.total_us);
    }

    #[test]
    #[ignore = "requires PARSON_TEST_LIBRARY and writes its device's offline index profile"]
    fn benchmarks_and_caches_offline_device_profile() {
        let path = std::env::var("PARSON_TEST_LIBRARY")
            .expect("PARSON_TEST_LIBRARY must point to the intended music directory");
        super::benchmark_and_cache_indexer_device_profile(Path::new(&path))
            .expect("offline device profiling should succeed");
    }

    #[test]
    fn common_pcm_parsers_skip_audio_payloads() {
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&1_000_036_u32.to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16_u32.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&2_u16.to_le_bytes());
        wav.extend_from_slice(&48_000_u32.to_le_bytes());
        wav.extend_from_slice(&192_000_u32.to_le_bytes());
        wav.extend_from_slice(&4_u16.to_le_bytes());
        wav.extend_from_slice(&16_u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&1_000_000_u32.to_le_bytes());
        wav.resize(wav.len() + 1_000_000, 0);
        let mut reader = Cursor::new(wav);
        let length = reader.get_ref().len() as u64;
        let metadata = parse_wav_fast(&mut reader, length).unwrap();
        assert_eq!(metadata.parse_strategy, ParserStrategy::WavFast);
        assert!((metadata.duration_seconds - 5.208333).abs() < 0.001);

        let mut aiff = Vec::new();
        aiff.extend_from_slice(b"FORM");
        aiff.extend_from_slice(&1_000_038_u32.to_be_bytes());
        aiff.extend_from_slice(b"AIFFCOMM");
        aiff.extend_from_slice(&18_u32.to_be_bytes());
        aiff.extend_from_slice(&2_u16.to_be_bytes());
        aiff.extend_from_slice(&48_000_u32.to_be_bytes());
        aiff.extend_from_slice(&16_u16.to_be_bytes());
        aiff.extend_from_slice(&[0x40, 0x0e, 0xbb, 0x80, 0, 0, 0, 0, 0, 0]);
        aiff.extend_from_slice(b"SSND");
        aiff.extend_from_slice(&1_000_000_u32.to_be_bytes());
        aiff.resize(aiff.len() + 1_000_000, 0);
        let mut reader = Cursor::new(aiff);
        let length = reader.get_ref().len() as u64;
        let metadata = parse_aiff_fast(&mut reader, length).unwrap();
        assert_eq!(metadata.parse_strategy, ParserStrategy::AiffFast);
        assert!((metadata.duration_seconds - 1.0).abs() < 0.001);
    }

    #[test]
    fn ogg_opus_parser_reads_edge_regions_and_tags() {
        fn page(sequence: u32, granule: u64, packets: &[&[u8]]) -> Vec<u8> {
            let mut output = Vec::new();
            output.extend_from_slice(b"OggS\0\x02");
            output.extend_from_slice(&granule.to_le_bytes());
            output.extend_from_slice(&1_u32.to_le_bytes());
            output.extend_from_slice(&sequence.to_le_bytes());
            output.extend_from_slice(&0_u32.to_le_bytes());
            output.push(packets.len() as u8);
            for packet in packets {
                output.push(packet.len() as u8);
            }
            for packet in packets {
                output.extend_from_slice(packet);
            }
            output
        }
        let mut head = b"OpusHead\x01\x02\x38\x01\x80\xbb\0\0\0\0\0".to_vec();
        head.resize(19, 0);
        let mut tags = b"OpusTags".to_vec();
        tags.extend_from_slice(&0_u32.to_le_bytes());
        tags.extend_from_slice(&2_u32.to_le_bytes());
        for value in [
            b"TITLE=Edge Song".as_slice(),
            b"ARTIST=Edge Artist".as_slice(),
        ] {
            tags.extend_from_slice(&(value.len() as u32).to_le_bytes());
            tags.extend_from_slice(value);
        }
        let mut bytes = page(0, 0, &[&head, &tags]);
        bytes.resize(256 * 1024, 0);
        bytes.extend(page(1, 48_312, &[b"audio"]));
        let mut reader = Cursor::new(bytes);
        let length = reader.get_ref().len() as u64;
        let metadata = parse_ogg_fast(&mut reader, length).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("Edge Song"));
        assert_eq!(metadata.track_artists, ["Edge Artist"]);
        assert!((metadata.duration_seconds - 1.0).abs() < 0.001);
    }

    #[test]
    #[ignore = "requires PARSON_TEST_LIBRARY and benchmarks the production two-phase import"]
    fn benchmarks_external_library_available_then_enriched() {
        let path = std::env::var("PARSON_TEST_LIBRARY")
            .expect("PARSON_TEST_LIBRARY must point to the benchmark library");
        let (_, available) = super::index_available_library_to_database(&path)
            .expect("available external library index");
        let (_, enriched) =
            super::enrich_library_to_database(&path).expect("enriched external library index");
        let (_, warm) =
            super::enrich_library_to_database(&path).expect("warm external library index");
        println!(
            "AVAILABLE_TOTAL_US={} AVAILABLE_ENUMERATION_US={} AVAILABLE_PARSE_WALL_US={} AVAILABLE_BYTES_READ={} AVAILABLE_READ_CALLS={} AVAILABLE_SEEKS={} AVAILABLE_FALLBACKS={} AVAILABLE_THREADS={} ENRICHED_TOTAL_US={} ENRICHED_COVER_US={} WARM_TOTAL_US={}",
            available.timing.total_us,
            available.timing.enumeration_us,
            available.timing.parsing_wall_us,
            available.timing.bytes_read,
            available.timing.read_calls,
            available.timing.seeks,
            available.timing.parser_fallbacks,
            available.timing.parser_threads,
            enriched.timing.total_us,
            enriched.timing.cover_discovery_us,
            warm.timing.total_us,
        );
        assert_eq!(available.scanned_files, enriched.scanned_files);
        assert_eq!(enriched.scanned_files, warm.scanned_files);
        assert_eq!(enriched.timing.tag_parsing_us, 0);
        assert_eq!(warm.indexed_files, 0);
        assert_eq!(warm.timing.normalization_inference_us, 0);
    }

    #[test]
    #[ignore = "requires PARSON_TEST_LIBRARY and an enriched benchmark database"]
    fn benchmarks_external_enriched_auto_refresh() {
        let path = std::env::var("PARSON_TEST_LIBRARY")
            .expect("PARSON_TEST_LIBRARY must point to the benchmark library");
        let started = std::time::Instant::now();
        let (_, report) =
            super::enrich_library_to_database(&path).expect("enriched automatic refresh");
        println!(
            "AUTO_REFRESH_TOTAL_US={} FILES={} INDEXED={} ENUMERATION_US={} PARSE_WALL_US={} BYTES_READ={}",
            started.elapsed().as_micros(),
            report.scanned_files,
            report.indexed_files,
            report.timing.enumeration_us,
            report.timing.parsing_wall_us,
            report.timing.bytes_read,
        );
        assert_eq!(report.indexed_files, 0);
        assert_eq!(report.timing.parsing_wall_us, 0);
        assert_eq!(report.timing.bytes_read, 0);
    }

    #[test]
    #[ignore = "requires PARSON_TEST_LIBRARY and benchmarks first-content publication"]
    fn benchmarks_external_instant_library_preview() {
        let path = std::env::var("PARSON_TEST_LIBRARY")
            .expect("PARSON_TEST_LIBRARY must point to the benchmark library");
        let started = std::time::Instant::now();
        let (library, report) =
            super::build_instant_library_preview(&path).expect("instant external library preview");
        let songs = library
            .iter()
            .flat_map(|artist| &artist.albums)
            .map(|album| album.songs.len())
            .sum::<usize>();
        println!(
            "INSTANT_PREVIEW_US={} ARTISTS={} ALBUMS={} SONGS={} SAMPLED={}",
            started.elapsed().as_micros(),
            library.len(),
            library
                .iter()
                .map(|artist| artist.albums.len())
                .sum::<usize>(),
            songs,
            report.scanned_files,
        );
        assert!(!library.is_empty());
        assert!(songs > 0);
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
    }

    #[test]
    #[ignore = "requires PARSON_TEST_LIBRARY and benchmarks progressive publication overhead"]
    fn benchmarks_external_progressive_library_scan() {
        let path = std::env::var("PARSON_TEST_LIBRARY")
            .expect("PARSON_TEST_LIBRARY must point to the benchmark library");
        let (sender, mut receiver) = tokio::sync::mpsc::channel::<Vec<crate::domain::Artist>>(1);
        let consumer = std::thread::spawn(move || {
            let mut publications = 0_usize;
            let mut latest_songs = 0_usize;
            while let Some(catalog) = receiver.blocking_recv() {
                publications += 1;
                latest_songs = catalog
                    .iter()
                    .flat_map(|artist| &artist.albums)
                    .map(|album| album.songs.len())
                    .sum();
            }
            (publications, latest_songs)
        });
        let started = std::time::Instant::now();
        let (library, report) =
            super::index_available_library_to_database_progressive(&path, sender)
                .expect("progressive external library index");
        let elapsed = started.elapsed();
        let (publications, latest_published_songs) = consumer.join().expect("progress consumer");
        let final_songs = library
            .iter()
            .flat_map(|artist| &artist.albums)
            .map(|album| album.songs.len())
            .sum::<usize>();
        println!(
            "PROGRESSIVE_TOTAL_US={} REPORT_TOTAL_US={} FILES={} PUBLICATIONS={} LATEST_PUBLISHED_SONGS={} FINAL_SONGS={}",
            elapsed.as_micros(),
            report.timing.total_us,
            report.scanned_files,
            publications,
            latest_published_songs,
            final_songs,
        );
        assert!(publications > 0);
        assert!(latest_published_songs > 0);
        assert_eq!(report.scanned_files, report.indexed_files);
        assert!(final_songs >= latest_published_songs);
    }

    #[test]
    fn instant_preview_discovery_spreads_through_a_shared_top_level_folder() {
        let root = std::env::temp_dir().join(format!(
            "parson-instant-discovery-test-{}",
            uuid::Uuid::new_v4()
        ));
        for artist in 0..30 {
            let album = root
                .join("Music")
                .join(format!("Artist {artist:02}"))
                .join("Album");
            std::fs::create_dir_all(&album).expect("create preview fixture album");
            for track in 0..12 {
                std::fs::write(album.join(format!("{track:02}.flac")), [])
                    .expect("write preview fixture track");
            }
        }
        let discovered = super::discover_instant_preview_files(&root);
        let directories = discovered
            .iter()
            .map(|file| file.native_directory.clone())
            .collect::<HashSet<_>>();
        std::fs::remove_dir_all(&root).expect("remove preview fixture");
        assert_eq!(
            discovered.len(),
            30 * super::INSTANT_PREVIEW_FILES_PER_DIRECTORY
        );
        assert_eq!(directories.len(), 30);
    }

    #[test]
    fn instant_preview_is_bounded_diverse_playable_and_searchable() {
        let mut parsed = Vec::new();
        for artist in 0..30 {
            for album in 0..2 {
                for track in 0..10 {
                    let mut record = parsed_track(
                        &format!("/music/artist-{artist}/album-{album}/{track}.flac"),
                        &format!("Song {artist} {album} {track}"),
                        track + 1,
                        180.0,
                    );
                    record.track_artists = vec![format!("Artist {artist}")];
                    record.album_artists = record.track_artists.clone();
                    record.album = format!("Album {artist} {album}");
                    record.cover_url = format!("/covers/{artist}-{album}.jpg");
                    parsed.push(record);
                }
            }
        }
        let selected = super::select_instant_preview_records(parsed);
        let catalog = super::preview_catalog_from_parsed(&selected, super::INSTANT_PREVIEW_ARTISTS);
        assert_eq!(catalog.len(), super::INSTANT_PREVIEW_ARTISTS);
        assert!(catalog.iter().all(|artist| artist.albums.len() == 1));
        assert!(
            catalog
                .iter()
                .all(|artist| artist.albums[0].songs.len() == 8)
        );
        assert!(catalog.iter().all(|artist| !artist.icon_url.is_empty()));
        let index =
            crate::library::search::SearchIndex::build(&catalog).expect("preview search index");
        let artist_name = catalog[0].name.clone();
        assert!(
            !index
                .search(&artist_name, 10)
                .expect("preview search")
                .is_empty()
        );
    }

    #[test]
    fn alias_inference_only_compares_partitioned_shared_recording_candidates() {
        let mut parsed = Vec::new();
        for index in 0..12 {
            let mut track = parsed_track(
                &format!("/canonical/{index}.mp3"),
                &format!("Recording {}", index % 2),
                index + 1,
                180.0,
            );
            track.track_artists = vec!["Morgan Vale".into()];
            track.album_artists = track.track_artists.clone();
            track.album = format!("Album {}", index % 3);
            parsed.push(track);
        }
        for index in 0..2 {
            let mut track = parsed_track(
                &format!("/suspect/{index}.mp3"),
                &format!("Recording {index}"),
                index + 1,
                180.0,
            );
            track.track_artists = vec!["Mrogan Vale".into()];
            track.album_artists = track.track_artists.clone();
            parsed.push(track);
        }
        for index in 0..100 {
            let mut track = parsed_track(
                &format!("/distractor/{index}.mp3"),
                &format!("Recording {}", index % 2),
                1,
                180.0,
            );
            track.track_artists = vec![format!("Unrelated Artist {index}")];
            track.album_artists = track.track_artists.clone();
            parsed.push(track);
        }

        let mut interner = StringInterner::with_capacity(parsed.len() * 8);
        let seeds = prepare_track_seeds(&parsed, &mut interner);
        let changed = HashSet::from(["mrogan vale".to_string()]);
        let (aliases, comparisons) = infer_artist_aliases_for(&seeds, &HashMap::new(), &changed);

        assert_eq!(aliases["mrogan vale"], "Morgan Vale");
        assert_eq!(comparisons, 1);

        let (retained, comparisons) = infer_artist_aliases_for(&seeds, &aliases, &HashSet::new());
        assert_eq!(retained, aliases);
        assert_eq!(comparisons, 0);
    }

    #[test]
    fn unchanged_release_presentations_are_reused_without_reclassification() {
        let evidence = HashMap::from([
            (
                "unchanged".to_string(),
                OwnedReleaseEvidence {
                    album_name: "Live at Home".into(),
                    album_artist: "Artist".into(),
                    paths: vec!["/music/live".into()],
                    track_titles: vec!["Live Song".into()],
                    track_durations: Vec::new(),
                    genres: Vec::new(),
                    release_dates: vec!["2000".into()],
                    directory_years: Vec::new(),
                },
            ),
            (
                "changed".to_string(),
                OwnedReleaseEvidence {
                    album_name: "Studio Album".into(),
                    album_artist: "Other Artist".into(),
                    paths: vec!["/music/studio".into()],
                    track_titles: vec!["Song".into()],
                    track_durations: Vec::new(),
                    genres: Vec::new(),
                    release_dates: vec!["2001".into()],
                    directory_years: Vec::new(),
                },
            ),
        ]);
        let mut retained = resolve_release_presentations(&evidence);
        retained.get_mut("unchanged").unwrap().primary_type = "Cached".into();
        let resolved = resolve_release_presentations_for(
            &evidence,
            &retained,
            &HashSet::from(["changed".to_string()]),
        );

        assert_eq!(resolved["unchanged"].primary_type, "Cached");
        assert_ne!(resolved["changed"].primary_type, "Cached");
    }

    #[test]
    #[ignore = "requires PARSON_TEST_LIBRARY and audits external artwork folders"]
    fn selects_front_art_from_external_library() {
        let path = std::env::var("PARSON_TEST_LIBRARY")
            .expect("PARSON_TEST_LIBRARY must point to the library under audit");
        let inventory = discover_files(&path);
        let directories = inventory
            .audio_files
            .iter()
            .map(|file| file.native_directory.clone())
            .collect::<std::collections::HashSet<_>>();
        for directory in directories {
            let candidates = inventory_candidates(&inventory, &directory);
            let has_named_front = candidates.iter().any(|candidate| {
                candidate
                    .path
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .is_some_and(|stem| {
                        matches!(
                            stem.to_ascii_lowercase().as_str(),
                            "f" | "front" | "cover" | "folder"
                        )
                    })
            });
            if !has_named_front {
                continue;
            }
            let selected = resolve_inventory_cover(&candidates, &directory).path;
            assert!(
                !selected.is_empty(),
                "missed named front artwork in {}",
                directory.display()
            );
            let selected_stem = std::path::Path::new(&selected)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            assert!(
                !matches!(selected_stem.as_str(), "b" | "back" | "rear"),
                "selected back artwork for {}: {selected}",
                directory.display()
            );
        }
    }

    #[test]
    #[ignore = "requires PARSON_CATALOG_DB and audits every raw catalog album title"]
    fn audits_external_catalog_title_normalization() {
        let path = std::env::var("PARSON_CATALOG_DB")
            .expect("PARSON_CATALOG_DB must point to the catalog database");
        let mut connection = SqliteConnection::establish(&path).expect("open catalog read-only");
        diesel::sql_query("PRAGMA query_only = ON")
            .execute(&mut connection)
            .expect("make catalog audit connection read-only");
        let titles = diesel::sql_query(
            "SELECT DISTINCT album AS id FROM raw_file_metadata
             WHERE album IS NOT NULL AND TRIM(album) <> ''",
        )
        .load::<super::TextIdRow>(&mut connection)
        .expect("load raw catalog album titles");
        let stop_words = ["a", "an", "and", "for", "in", "of", "the", "to", "with"];
        let mut suspicious = Vec::new();

        for row in &titles {
            let analysis = super::analyze_release_title(&row.id);
            assert!(!analysis.display_title.is_empty(), "{}", row.id);
            assert!(
                !super::normalize_album_identity(&row.id).is_empty(),
                "{}",
                row.id
            );
            if analysis.display_title != analysis.original_title {
                assert!(
                    analysis
                        .variant_kinds
                        .contains(&crate::library::normalize::ReleaseVariantKind::Disc),
                    "non-disc display truncation: {} -> {}",
                    row.id,
                    analysis.display_title
                );
            }
            if analysis.is_edition
                && analysis
                    .canonical_title
                    .split_whitespace()
                    .next_back()
                    .is_some_and(|word| stop_words.contains(&word.to_ascii_lowercase().as_str()))
            {
                suspicious.push((row.id.clone(), analysis.canonical_title));
            }
        }

        assert!(
            suspicious.is_empty(),
            "suspicious edition truncations: {suspicious:#?}"
        );
        println!("AUDITED_RAW_ALBUM_TITLES={}", titles.len());
    }

    #[test]
    #[ignore = "requires PARSON_REBUILD_CATALOG_DB and mutates that explicit isolated database"]
    fn rebuilds_external_catalog_from_persisted_metadata() {
        let path = std::env::var("PARSON_REBUILD_CATALOG_DB")
            .expect("PARSON_REBUILD_CATALOG_DB must point to an isolated catalog copy");
        let mut connection = SqliteConnection::establish(&path).expect("open isolated catalog");
        connection
            .batch_execute("PRAGMA foreign_keys = ON;")
            .expect("enable catalog integrity checks");
        let snapshots = all_available_snapshots(&mut connection).expect("load persisted metadata");
        let parsed = snapshots.iter().map(snapshot_to_parsed).collect::<Vec<_>>();
        let file_ids = snapshots
            .iter()
            .map(|snapshot| (snapshot.path.clone(), snapshot.file_id))
            .collect::<HashMap<_, _>>();
        let changed_paths = parsed
            .iter()
            .map(|parsed| parsed.path.as_ref())
            .collect::<HashSet<_>>();
        let discovered_files = HashMap::new();
        let artwork_hashes = diesel::sql_query("SELECT id, uri FROM artwork")
            .load::<super::ArtworkIdentityRow>(&mut connection)
            .expect("load persisted artwork identities")
            .into_iter()
            .map(|row| (row.uri, row.id))
            .collect::<HashMap<_, _>>();

        reconcile_normalized_tables(
            &mut connection,
            ReconcileInputs {
                root_id: 0,
                parsed_files: &parsed,
                file_ids: &file_ids,
                discovered_files: &discovered_files,
                artwork_hashes: &artwork_hashes,
                phase: LibraryIndexPhase::Enriched,
                mode: IndexMode::Repair,
                changed_paths: &changed_paths,
            },
        )
        .expect("rebuild normalized catalog from persisted metadata");

        let duplicate_file_links = diesel::sql_query(
            "SELECT COUNT(*) AS count FROM (
                 SELECT file_id FROM track_file GROUP BY file_id HAVING COUNT(*) > 1
             )",
        )
        .get_result::<super::CountRow>(&mut connection)
        .expect("audit duplicate file links")
        .count;
        let orphaned_search_documents = diesel::sql_query(
            "SELECT COUNT(*) AS count FROM library_search_document document
             WHERE (entity_type = 'album' AND NOT EXISTS (SELECT 1 FROM album_entity WHERE id = document.entity_id))
                OR (entity_type = 'song' AND NOT EXISTS (SELECT 1 FROM track_entity WHERE id = document.entity_id))
                OR (entity_type = 'artist' AND NOT EXISTS (SELECT 1 FROM artist_entity WHERE id = document.entity_id))",
        )
        .get_result::<super::CountRow>(&mut connection)
        .expect("audit orphaned search documents")
        .count;
        assert_eq!(duplicate_file_links, 0);
        assert_eq!(orphaned_search_documents, 0);
        println!("REBUILT_FILES={}", snapshots.len());
    }

    #[test]
    #[ignore = "requires PARSON_CATALOG_DB and audits cached release evidence"]
    fn audits_external_catalog_release_classification() {
        let path = std::env::var("PARSON_CATALOG_DB")
            .expect("PARSON_CATALOG_DB must point to the catalog database");
        let filter = std::env::var("PARSON_AUDIT_FILTER")
            .unwrap_or_default()
            .to_ascii_lowercase();
        let mut connection = SqliteConnection::establish(&path).expect("open catalog read-only");
        diesel::sql_query("PRAGMA query_only = ON")
            .execute(&mut connection)
            .expect("make catalog audit connection read-only");
        let mut cached =
            load_album_inference_cache(&mut connection).expect("load release evidence");
        let durations = diesel::sql_query(
            "SELECT album_id AS id, json_group_array(duration_seconds) AS durations_json
             FROM track_entity GROUP BY album_id",
        )
        .load::<super::AlbumDurationsRow>(&mut connection)
        .expect("load release durations");
        for row in durations {
            if let Some((evidence, _)) = cached.get_mut(&row.id) {
                evidence.track_durations =
                    serde_json::from_str(&row.durations_json).expect("decode release durations");
            }
        }
        let mut categories = BTreeMap::<String, usize>::new();
        let mut changed = BTreeMap::<(String, String), usize>::new();
        let mut findings = Vec::new();

        for (album_id, (evidence, stored)) in cached {
            let classification = evidence.classify();
            *categories
                .entry(classification.primary_type.clone())
                .or_default() += 1;
            if stored.primary_type != classification.primary_type {
                *changed
                    .entry((
                        stored.primary_type.clone(),
                        classification.primary_type.clone(),
                    ))
                    .or_default() += 1;
            }
            let searchable =
                format!("{} {}", evidence.album_artist, evidence.album_name).to_ascii_lowercase();
            if (!filter.is_empty() && searchable.contains(&filter))
                || (filter.is_empty()
                    && (classification.confidence < 0.5
                        || stored.primary_type != classification.primary_type))
            {
                findings.push(format!(
                    "{:.3}\t{}\t{}\t{}\t{}\t{}\t{}",
                    classification.confidence,
                    stored.primary_type,
                    classification.primary_type,
                    evidence.track_titles.len(),
                    evidence.album_artist,
                    evidence.album_name,
                    album_id,
                ));
            }
        }
        findings.sort();
        println!("CATEGORY_COUNTS={categories:?}");
        println!("CLASSIFICATION_CHANGES={changed:?}");
        println!("AUDIT_FINDINGS={}", findings.len());
        for finding in findings {
            println!("{finding}");
        }
    }
}

fn load_metadata_overrides(
    conn: &mut SqliteConnection,
) -> Result<MetadataOverrides, Box<dyn Error + Send + Sync>> {
    let rows = diesel::sql_query(
        "SELECT entity_type, entity_id, field_name, value_json FROM metadata_override",
    )
    .load::<MetadataOverrideRow>(conn)?;

    let mut overrides = MetadataOverrides::new();
    for row in rows {
        overrides
            .entry(row.entity_type)
            .or_default()
            .entry(row.entity_id)
            .or_default()
            .insert(row.field_name, row.value_json);
    }
    Ok(overrides)
}

#[derive(Debug, QueryableByName)]
struct ArtistViewRow {
    #[diesel(sql_type = Text)]
    id: String,
    #[diesel(sql_type = Text)]
    name: String,
    #[diesel(sql_type = Nullable<Text>)]
    icon_url: Option<String>,
    #[diesel(sql_type = BigInt)]
    followers: i64,
    #[diesel(sql_type = Nullable<Text>)]
    description: Option<String>,
}

fn export_albums_by_artist(
    conn: &mut SqliteConnection,
    overrides: &MetadataOverrides,
) -> Result<HashMap<String, Vec<Album>>, Box<dyn Error + Send + Sync>> {
    let rows = diesel::sql_query(
        "SELECT a.id, a.title, art.uri AS cover_url, a.primary_type, a.description,
                a.first_release_date, a.musicbrainz_id, a.wikidata_id, a.release_album_json,
                aa.artist_id
         FROM album_entity a
         JOIN album_artist aa ON aa.album_id = a.id AND aa.role = 'primary'
         LEFT JOIN artwork art ON art.id = a.artwork_id
         ORDER BY aa.artist_id, a.normalized_title",
    )
    .load::<AlbumRow>(conn)?;
    let mut tracks_by_album = export_all_tracks(conn, overrides)?;

    let mut albums_by_artist = HashMap::<String, Vec<Album>>::new();
    for row in rows {
        let songs = tracks_by_album.remove(&row.id).unwrap_or_default();
        let album_id = row.id.clone();
        let artist_id = row.artist_id;
        let stored_primary_type = row.primary_type.unwrap_or_default();
        let stored_release_metadata = row
            .release_album_json
            .as_deref()
            .and_then(|metadata| serde_json::from_str::<StoredReleaseMetadata>(metadata).ok());
        // Recover legacy display titles from analysis JSON before enrichment.
        let catalog_title = catalog_album_title(row.title, stored_release_metadata.as_ref());
        let inferred_edition_type = if stored_primary_type.eq_ignore_ascii_case("edition") {
            stored_release_metadata
                .as_ref()
                .and_then(|metadata| metadata.title_analysis.as_ref())
                .map(edition_primary_type)
                .unwrap_or(stored_primary_type)
        } else {
            stored_primary_type
        };
        let mut album = Album {
            id: album_id.clone(),
            name: value_override(overrides, "album", &album_id, "name", catalog_title),
            cover_url: value_override(
                overrides,
                "album",
                &album_id,
                "cover_url",
                row.cover_url.unwrap_or_default(),
            ),
            songs,
            first_release_date: typed_override(
                overrides,
                "album",
                &album_id,
                "first_release_date",
                row.first_release_date.unwrap_or_default(),
            ),
            musicbrainz_id: typed_override(
                overrides,
                "album",
                &album_id,
                "musicbrainz_id",
                row.musicbrainz_id.unwrap_or_default(),
            ),
            wikidata_id: typed_override(
                overrides,
                "album",
                &album_id,
                "wikidata_id",
                row.wikidata_id,
            ),
            primary_type: typed_override(
                overrides,
                "album",
                &album_id,
                "primary_type",
                inferred_edition_type,
            ),
            description: value_override(
                overrides,
                "album",
                &album_id,
                "description",
                row.description.unwrap_or_default(),
            ),
            contributing_artists: typed_override(
                overrides,
                "album",
                &album_id,
                "contributing_artists",
                Vec::new(),
            ),
            contributing_artists_ids: typed_override(
                overrides,
                "album",
                &album_id,
                "contributing_artists_ids",
                Vec::new(),
            ),
            release_album: None,
            release_group_album: None,
        };
        if album.primary_type.is_empty() {
            album.primary_type = classify_release_type(&album);
        }
        albums_by_artist.entry(artist_id).or_default().push(album);
    }

    Ok(albums_by_artist)
}

fn export_all_tracks(
    conn: &mut SqliteConnection,
    overrides: &MetadataOverrides,
) -> Result<HashMap<String, Vec<Song>>, Box<dyn Error + Send + Sync>> {
    let query_started = Instant::now();
    let rows = diesel::sql_query(
        "SELECT t.album_id, t.id, t.title, COALESCE(ar.name, 'Unknown Artist') AS artist,
                t.track_number, t.duration_seconds, fe.path
         FROM track_entity t
         LEFT JOIN track_artist ta ON ta.track_id = t.id AND ta.role = 'primary'
         LEFT JOIN artist_entity ar ON ar.id = ta.artist_id
         LEFT JOIN track_file tf ON tf.track_id = t.id AND tf.is_primary = true
         LEFT JOIN file_entry fe ON fe.id = tf.file_id
         ORDER BY t.album_id, t.disc_number, t.track_number, t.normalized_title",
    )
    .load::<TrackRow>(conn)?;
    let query_us = elapsed_us(query_started.elapsed());

    let mut tracks_by_album = HashMap::with_capacity(rows.len().saturating_div(8).max(1));
    for row in rows {
        let song = Song {
            id: row.id.clone(),
            name: value_override(overrides, "track", &row.id, "name", row.title),
            artist: value_override(overrides, "track", &row.id, "artist", row.artist),
            contributing_artists: typed_override(
                overrides,
                "track",
                &row.id,
                "contributing_artists",
                Vec::new(),
            ),
            contributing_artist_ids: typed_override(
                overrides,
                "track",
                &row.id,
                "contributing_artist_ids",
                Vec::new(),
            ),
            track_number: typed_override(
                overrides,
                "track",
                &row.id,
                "track_number",
                row.track_number.max(0) as u16,
            ),
            path: typed_override(
                overrides,
                "track",
                &row.id,
                "path",
                row.path.unwrap_or_default(),
            ),
            duration: typed_override(
                overrides,
                "track",
                &row.id,
                "duration",
                row.duration_seconds,
            ),
        };
        tracks_by_album
            .entry(row.album_id)
            .or_insert_with(Vec::new)
            .push(song);
    }
    info!(
        query_us,
        total_us = elapsed_us(query_started.elapsed()),
        albums = tracks_by_album.len(),
        "track export completed"
    );
    Ok(tracks_by_album)
}
