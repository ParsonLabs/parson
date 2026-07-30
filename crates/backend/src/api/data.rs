use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};

use actix_multipart::Multipart;
use actix_web::{HttpRequest, HttpResponse, delete, get, post, web};
use chrono::{Datelike, NaiveDate, Utc};
use diesel::connection::SimpleConnection;
use diesel::deserialize::QueryableByName;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Integer, Nullable, Text};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::api::auth::authenticated_user_id;
use crate::api::error::{bad_request, internal_server_error, not_found};
use crate::domain::Artist;
use crate::library::state::{LibraryLifecycle, library_unavailable_response};
use crate::persistence::connection::DbPool;
use crate::settings;

const BACKUP_FORMAT_VERSION: u32 = 1;
const PUBLIC_INDEX_VERSION: u32 = 1;
const MAX_RESTORE_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_RESTORE_EXTRACTED_BYTES: u64 = 32 * 1024 * 1024 * 1024;
const MAX_RESTORE_ENTRIES: usize = 1_000_000;
const AUTOMATIC_BACKUP_INTERVAL_HOURS: i64 = 24;
const DAILY_BACKUP_COUNT: usize = 7;
const WEEKLY_BACKUP_COUNT: usize = 4;
const MONTHLY_BACKUP_COUNT: usize = 3;
static BACKUP_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Serialize)]
struct DataStatus {
    database_bytes: u64,
    user_file_bytes: u64,
    cache_bytes: u64,
    listen_history_items: i64,
    favorite_items: i64,
    playlist_items: i64,
    backups: Vec<BackupSummary>,
    automatic_backup_interval_hours: i64,
    daily_backup_count: usize,
    weekly_backup_count: usize,
    monthly_backup_count: usize,
    restore_pending: bool,
    reset_pending: bool,
}

#[derive(Deserialize)]
struct ResetRequest {
    confirmation: String,
}

#[derive(Clone, Serialize)]
struct BackupSummary {
    filename: String,
    created_at: String,
    size_bytes: u64,
    tier: Option<BackupTier>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum BackupTier {
    Daily,
    Weekly,
    Monthly,
}

#[derive(Clone, Deserialize, Serialize)]
struct BackupMetadata {
    created_at: String,
    meaningful_fingerprint: String,
}

#[derive(Serialize)]
struct BackupManifest {
    format: &'static str,
    version: u32,
    created_at: String,
    product: &'static str,
    product_version: &'static str,
    includes: [&'static str; 6],
    excludes: [&'static str; 3],
}

#[derive(Serialize)]
struct PublicLibraryIndex {
    format: &'static str,
    version: u32,
    generated_at: String,
    privacy: PublicPrivacyStatement,
    summary: PublicIndexSummary,
    artists: Vec<PublicArtist>,
}

#[derive(Serialize)]
struct PublicPrivacyStatement {
    contains_personal_data: bool,
    omitted: [&'static str; 11],
}

#[derive(Default, Serialize)]
struct PublicIndexSummary {
    artists: usize,
    albums: usize,
    tracks: usize,
    total_duration_seconds: f64,
    total_file_bytes: u64,
    formats: HashMap<String, usize>,
}

#[derive(Serialize)]
struct PublicArtist {
    id: String,
    name: String,
    musicbrainz_ids: Vec<String>,
    albums: Vec<PublicAlbum>,
}

#[derive(Serialize)]
struct PublicAlbum {
    id: String,
    title: String,
    first_release_date: String,
    primary_type: String,
    musicbrainz_id: String,
    wikidata_id: Option<String>,
    contributing_artists: Vec<String>,
    release: Option<PublicReleaseDetails>,
    genres: Vec<String>,
    tracks: Vec<PublicTrack>,
}

#[derive(Serialize)]
struct PublicReleaseDetails {
    date: String,
    country: String,
    status: String,
    barcode: String,
    quality: String,
    packaging: String,
    catalog_numbers: Vec<String>,
    labels: Vec<String>,
}

#[derive(Serialize)]
struct PublicTrack {
    id: String,
    title: String,
    artist: String,
    contributing_artists: Vec<String>,
    track_number: u16,
    duration_seconds: f64,
    audio: Option<PublicAudioDetails>,
}

#[derive(Clone, Serialize)]
struct PublicAudioDetails {
    format: String,
    container: Option<String>,
    codec: Option<String>,
    average_bitrate_bps: Option<u64>,
    sample_rate: Option<i32>,
    channels: Option<i32>,
    disc_number: Option<i32>,
    musicbrainz_recording_id: Option<String>,
    musicbrainz_release_id: Option<String>,
    size_bytes: u64,
}

#[derive(QueryableByName)]
struct AudioDetailsRow {
    #[diesel(sql_type = Text)]
    path: String,
    #[diesel(sql_type = Text)]
    extension: String,
    #[diesel(sql_type = BigInt)]
    size_bytes: i64,
    #[diesel(sql_type = Nullable<Text>)]
    codec: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    container: Option<String>,
    #[diesel(sql_type = Nullable<Integer>)]
    bitrate: Option<i32>,
    #[diesel(sql_type = Nullable<Integer>)]
    sample_rate: Option<i32>,
    #[diesel(sql_type = Nullable<Integer>)]
    channels: Option<i32>,
    #[diesel(sql_type = Nullable<Integer>)]
    disc_number: Option<i32>,
    #[diesel(sql_type = Nullable<Text>)]
    musicbrainz_recording_id: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    musicbrainz_release_id: Option<String>,
}

#[derive(Serialize)]
struct PersonalDataExport {
    format: &'static str,
    version: u32,
    exported_at: String,
    profile: serde_json::Value,
    listen_history: Vec<serde_json::Value>,
    favorites: Vec<serde_json::Value>,
    searches: Vec<serde_json::Value>,
    playlists: Vec<serde_json::Value>,
}

fn safe_backup_filename(value: &str) -> Option<&str> {
    (!value.is_empty()
        && value.len() <= 128
        && value.starts_with("parson-backup-")
        && value.ends_with(".tar.zst")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')))
    .then_some(value)
}

fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| {
            entry
                .metadata()
                .ok()
                .map(|metadata| {
                    if metadata.is_dir() {
                        directory_size(&entry.path())
                    } else if metadata.is_file() {
                        metadata.len()
                    } else {
                        0
                    }
                })
                .unwrap_or(0)
        })
        .sum()
}

fn clear_cache_at(root: &Path) -> std::io::Result<u64> {
    let mut cleared = 0;
    for name in ["Album Covers", "Artist Icons", "Artwork", "Cache"] {
        let path = root.join(name);
        cleared += directory_size(&path);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(&path)?,
            Ok(_) => fs::remove_file(&path)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        fs::create_dir_all(path)?;
    }
    Ok(cleared)
}

fn backup_directory() -> PathBuf {
    settings::data_path(&["Backups"])
}

fn backup_metadata_path(filename: &str) -> PathBuf {
    backup_directory().join(format!("{filename}.meta.json"))
}

#[derive(Clone)]
struct BackupRecord {
    summary: BackupSummary,
    created_at: chrono::DateTime<Utc>,
    meaningful_fingerprint: Option<String>,
}

fn list_backup_records() -> std::io::Result<Vec<BackupRecord>> {
    let directory = backup_directory();
    fs::create_dir_all(&directory)?;
    let mut backups = fs::read_dir(&directory)?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let filename = entry.file_name().to_string_lossy().into_owned();
            safe_backup_filename(&filename)?;
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let sidecar = fs::read(directory.join(format!("{filename}.meta.json")))
                .ok()
                .and_then(|bytes| serde_json::from_slice::<BackupMetadata>(&bytes).ok());
            let created_at = sidecar
                .as_ref()
                .and_then(|metadata| {
                    chrono::DateTime::parse_from_rfc3339(&metadata.created_at).ok()
                })
                .map(|time| time.with_timezone(&Utc))
                .or_else(|| metadata.modified().ok().map(chrono::DateTime::<Utc>::from))?;
            Some(BackupRecord {
                summary: BackupSummary {
                    created_at: created_at.to_rfc3339(),
                    filename,
                    size_bytes: metadata.len(),
                    tier: None,
                },
                created_at,
                meaningful_fingerprint: sidecar.map(|metadata| metadata.meaningful_fingerprint),
            })
        })
        .collect::<Vec<_>>();
    backups.sort_by_key(|right| std::cmp::Reverse(right.created_at));
    Ok(backups)
}

fn retention_plan(backups: &[BackupRecord], today: NaiveDate) -> HashMap<String, BackupTier> {
    let mut retained = HashMap::new();
    let mut daily_dates = std::collections::HashSet::new();
    let mut weekly = [None::<&BackupRecord>; WEEKLY_BACKUP_COUNT];
    let mut monthly = HashMap::<(i32, u32), &BackupRecord>::new();

    for backup in backups {
        let date = backup.created_at.date_naive();
        let age = today.signed_duration_since(date).num_days();
        if age < DAILY_BACKUP_COUNT as i64 {
            if daily_dates.len() < DAILY_BACKUP_COUNT && daily_dates.insert(date) {
                retained.insert(backup.summary.filename.clone(), BackupTier::Daily);
            }
            continue;
        }
        let weekly_end = DAILY_BACKUP_COUNT as i64 + (WEEKLY_BACKUP_COUNT as i64 * 7) - 1;
        if age <= weekly_end {
            let bucket = ((age - DAILY_BACKUP_COUNT as i64) / 7).max(0) as usize;
            if bucket < WEEKLY_BACKUP_COUNT {
                // Iteration is newest to oldest, so replacement promotes the
                // oldest available restore point in each seven-day band.
                weekly[bucket] = Some(backup);
            }
            continue;
        }
        monthly.insert((date.year(), date.month()), backup);
    }

    for backup in weekly.into_iter().flatten() {
        retained.insert(backup.summary.filename.clone(), BackupTier::Weekly);
    }
    let mut months = monthly.into_iter().collect::<Vec<_>>();
    months.sort_unstable_by(|(left, _), (right, _)| right.cmp(left));
    for (_, backup) in months.into_iter().take(MONTHLY_BACKUP_COUNT) {
        retained.insert(backup.summary.filename.clone(), BackupTier::Monthly);
    }
    retained
}

fn list_backups() -> std::io::Result<Vec<BackupSummary>> {
    let records = list_backup_records()?;
    let plan = retention_plan(&records, Utc::now().date_naive());
    Ok(records
        .into_iter()
        .filter_map(|mut record| {
            record.summary.tier = plan.get(&record.summary.filename).copied();
            record.summary.tier.map(|_| record.summary)
        })
        .collect())
}

fn prune_old_backups() -> std::io::Result<()> {
    let records = list_backup_records()?;
    let retained = retention_plan(&records, Utc::now().date_naive());
    for backup in records {
        if retained.contains_key(&backup.summary.filename) {
            continue;
        }
        let _ = fs::remove_file(backup_directory().join(&backup.summary.filename));
        let _ = fs::remove_file(backup_metadata_path(&backup.summary.filename));
    }
    Ok(())
}

fn automatic_backup_due(pool: &DbPool) -> Result<bool, String> {
    let backups = list_backup_records().map_err(|error| error.to_string())?;
    let Some(latest) = backups.first() else {
        return Ok(true);
    };
    if Utc::now()
        .signed_duration_since(latest.created_at)
        .num_hours()
        < AUTOMATIC_BACKUP_INTERVAL_HOURS
    {
        return Ok(false);
    }
    let fingerprint = meaningful_data_fingerprint(pool)?;
    Ok(latest.meaningful_fingerprint.as_deref() != Some(&fingerprint))
}

fn sql_path(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(|value| value.replace('\'', "''"))
        .ok_or_else(|| "backup path is not valid UTF-8".to_string())
}

fn hash_managed_tree(digest: &mut Sha256, root: &Path, relative: &Path) -> Result<(), String> {
    let directory = root.join(relative);
    let Ok(entries) = fs::read_dir(&directory) else {
        return Ok(());
    };
    let mut entries = entries
        .filter_map(Result::ok)
        .collect::<Vec<std::fs::DirEntry>>();
    entries.sort_unstable_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = path.symlink_metadata().map_err(|error| error.to_string())?;
        let child = relative.join(entry.file_name());
        if metadata.is_dir() {
            hash_managed_tree(digest, root, &child)?;
        } else if metadata.is_file() {
            digest.update(child.to_string_lossy().as_bytes());
            digest.update(metadata.len().to_le_bytes());
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_nanos())
                .unwrap_or_default();
            digest.update(modified.to_le_bytes());
        }
    }
    Ok(())
}

fn meaningful_data_fingerprint(pool: &DbPool) -> Result<String, String> {
    #[derive(QueryableByName)]
    struct RevisionRow {
        #[diesel(sql_type = BigInt)]
        revision: i64,
    }
    let mut connection = pool.get().map_err(|error| error.to_string())?;
    let revision = diesel::sql_query(
        "SELECT CAST(revision AS BIGINT) AS revision
         FROM user_data_change_state WHERE singleton = 1",
    )
    .get_result::<RevisionRow>(&mut connection)
    .map_err(|error| error.to_string())?
    .revision;
    drop(connection);

    let mut digest = Sha256::new();
    digest.update(revision.to_le_bytes());
    for name in [
        "Config",
        "Profile Pictures",
        "Album Covers",
        "Artist Icons",
        "Artwork",
    ] {
        digest.update(name.as_bytes());
        hash_managed_tree(&mut digest, &settings::data_path(&[name]), Path::new(""))?;
    }
    let core = settings::core_database_path();
    if let Ok(metadata) = core.metadata() {
        digest.update(metadata.len().to_le_bytes());
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        digest.update(modified.to_le_bytes());
    }
    Ok(digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn append_safe_tree<W: Write>(
    archive: &mut tar::Builder<W>,
    source: &Path,
    archive_path: &Path,
) -> Result<(), String> {
    archive
        .append_dir(archive_path, source)
        .map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = entry
            .path()
            .symlink_metadata()
            .map_err(|error| error.to_string())?;
        let child_archive_path = archive_path.join(entry.file_name());
        if metadata.is_dir() {
            append_safe_tree(archive, &entry.path(), &child_archive_path)?;
        } else if metadata.is_file() {
            archive
                .append_path_with_name(entry.path(), child_archive_path)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn create_backup_archive(pool: &DbPool) -> Result<BackupSummary, String> {
    let _guard = BACKUP_LOCK
        .lock()
        .map_err(|_| "the backup lock is unavailable".to_string())?;
    let now = Utc::now();
    let meaningful_fingerprint = meaningful_data_fingerprint(pool)?;
    let filename = format!("parson-backup-{}.tar.zst", now.format("%Y%m%dT%H%M%S%3fZ"));
    let directory = backup_directory();
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let destination = directory.join(&filename);
    let temporary = directory.join(format!(".{}.{}.tmp", filename, Uuid::new_v4()));
    let work = directory.join(format!(".snapshot-{}", Uuid::new_v4()));
    fs::create_dir_all(&work).map_err(|error| error.to_string())?;

    let result = (|| -> Result<(), String> {
        let music_snapshot = work.join("parson-music.db");
        let mut connection = pool.get().map_err(|error| error.to_string())?;
        connection
            .batch_execute(&format!(
                "PRAGMA wal_checkpoint(FULL); VACUUM INTO '{}';",
                sql_path(&music_snapshot)?
            ))
            .map_err(|error| error.to_string())?;
        drop(connection);
        sanitize_backup_database(&music_snapshot)?;

        let output = File::create(&temporary).map_err(|error| error.to_string())?;
        let encoder = zstd::Encoder::new(output, 9).map_err(|error| error.to_string())?;
        let mut archive = tar::Builder::new(encoder);
        let manifest = serde_json::to_vec_pretty(&BackupManifest {
            format: "parson-private-backup",
            version: BACKUP_FORMAT_VERSION,
            created_at: now.to_rfc3339(),
            product: "parson-music",
            product_version: env!("CARGO_PKG_VERSION"),
            includes: [
                "music database",
                "core database",
                "accounts and preferences",
                "listen history, favorites, and playlists",
                "profile pictures",
                "library metadata and artwork",
            ],
            excludes: ["music files", "session secrets", "temporary caches"],
        })
        .map_err(|error| error.to_string())?;
        let mut header = tar::Header::new_gnu();
        header.set_size(manifest.len() as u64);
        header.set_mode(0o600);
        header.set_cksum();
        archive
            .append_data(&mut header, "manifest.json", Cursor::new(manifest))
            .map_err(|error| error.to_string())?;
        archive
            .append_path_with_name(&music_snapshot, "Database/parson-music.db")
            .map_err(|error| error.to_string())?;

        let core_database = settings::core_database_path();
        if core_database.is_file() {
            archive
                .append_path_with_name(&core_database, "Database/parson-core.db")
                .map_err(|error| error.to_string())?;
        }
        for name in [
            "Config",
            "Profile Pictures",
            "Album Covers",
            "Artist Icons",
            "Artwork",
        ] {
            let source = settings::data_path(&[name]);
            if source.is_dir() {
                append_safe_tree(&mut archive, &source, Path::new(name))?;
            }
        }
        archive.finish().map_err(|error| error.to_string())?;
        archive
            .into_inner()
            .map_err(|error| error.to_string())?
            .finish()
            .map_err(|error| error.to_string())?;
        fs::rename(&temporary, &destination).map_err(|error| error.to_string())?;
        Ok(())
    })();
    let _ = fs::remove_dir_all(&work);
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result?;
    let metadata = BackupMetadata {
        created_at: now.to_rfc3339(),
        meaningful_fingerprint,
    };
    let metadata_path = backup_metadata_path(&filename);
    let metadata_temporary = metadata_path.with_extension(format!("json.{}.tmp", Uuid::new_v4()));
    let metadata_bytes = serde_json::to_vec_pretty(&metadata).map_err(|error| error.to_string())?;
    if let Err(error) = fs::write(&metadata_temporary, metadata_bytes)
        .and_then(|()| fs::rename(&metadata_temporary, &metadata_path))
    {
        let _ = fs::remove_file(&metadata_temporary);
        let _ = fs::remove_file(&destination);
        return Err(error.to_string());
    }
    let _ = prune_old_backups();
    let size_bytes = destination
        .metadata()
        .map_err(|error| error.to_string())?
        .len();
    Ok(BackupSummary {
        filename,
        created_at: now.to_rfc3339(),
        size_bytes,
        tier: Some(BackupTier::Daily),
    })
}

pub(crate) fn create_safety_backup(pool: &DbPool) -> Result<(), String> {
    create_backup_archive(pool).map(|_| ())
}

fn audio_details(pool: &DbPool) -> Result<HashMap<String, PublicAudioDetails>, String> {
    let mut connection = pool.get().map_err(|error| error.to_string())?;
    diesel::sql_query(
        "SELECT file_entry.path, file_entry.extension, file_entry.size_bytes,
                raw_file_metadata.codec, raw_file_metadata.container,
                raw_file_metadata.bitrate, raw_file_metadata.sample_rate,
                raw_file_metadata.channels, raw_file_metadata.disc_number,
                raw_file_metadata.musicbrainz_recording_id,
                raw_file_metadata.musicbrainz_release_id
         FROM file_entry
         LEFT JOIN raw_file_metadata ON raw_file_metadata.file_id = file_entry.id
         WHERE file_entry.availability = 'available'",
    )
    .load::<AudioDetailsRow>(&mut connection)
    .map_err(|error| error.to_string())
    .map(|rows| {
        rows.into_iter()
            .map(|row| {
                (
                    row.path,
                    PublicAudioDetails {
                        format: row.extension,
                        container: row.container,
                        codec: row.codec,
                        average_bitrate_bps: row.bitrate.filter(|bitrate| *bitrate > 0).map(
                            |bitrate| {
                                let bitrate = bitrate as u64;
                                if bitrate < 10_000 {
                                    bitrate * 1_000
                                } else {
                                    bitrate
                                }
                            },
                        ),
                        sample_rate: row.sample_rate,
                        channels: row.channels,
                        disc_number: row.disc_number,
                        musicbrainz_recording_id: row.musicbrainz_recording_id,
                        musicbrainz_release_id: row.musicbrainz_release_id,
                        size_bytes: row.size_bytes.max(0) as u64,
                    },
                )
            })
            .collect()
    })
}

fn public_index(
    library: &[Artist],
    details: &HashMap<String, PublicAudioDetails>,
) -> PublicLibraryIndex {
    let mut summary = PublicIndexSummary::default();
    let artists = library
        .iter()
        .map(|artist| {
            summary.artists += 1;
            let albums = artist
                .albums
                .iter()
                .map(|album| {
                    summary.albums += 1;
                    let tracks = album
                        .songs
                        .iter()
                        .map(|song| {
                            summary.tracks += 1;
                            summary.total_duration_seconds += song.duration.max(0.0);
                            let mut audio = details.get(&song.path).cloned();
                            if let Some(audio) = &mut audio {
                                audio.container.get_or_insert_with(|| audio.format.clone());
                                if audio.average_bitrate_bps.is_none()
                                    && song.duration.is_finite()
                                    && song.duration > 0.0
                                {
                                    audio.average_bitrate_bps = Some(
                                        ((audio.size_bytes as f64 * 8.0) / song.duration).round()
                                            as u64,
                                    );
                                }
                            }
                            if let Some(audio) = &audio {
                                summary.total_file_bytes += audio.size_bytes;
                                *summary.formats.entry(audio.format.clone()).or_default() += 1;
                            }
                            PublicTrack {
                                id: song.id.clone(),
                                title: song.name.clone(),
                                artist: song.artist.clone(),
                                contributing_artists: song.contributing_artists.clone(),
                                track_number: song.track_number,
                                duration_seconds: song.duration,
                                audio,
                            }
                        })
                        .collect();
                    let release =
                        album
                            .release_album
                            .as_ref()
                            .map(|release| PublicReleaseDetails {
                                date: release.information.date.clone(),
                                country: release.information.country.clone(),
                                status: release.information.status.clone(),
                                barcode: release.information.barcode.clone(),
                                quality: release.information.quality.clone(),
                                packaging: release.information.packaging.clone(),
                                catalog_numbers: release
                                    .labels
                                    .iter()
                                    .map(|label| label.catalog_number.clone())
                                    .filter(|value| !value.is_empty())
                                    .collect(),
                                labels: release
                                    .labels
                                    .iter()
                                    .map(|label| label.name.clone())
                                    .filter(|value| !value.is_empty())
                                    .collect(),
                            });
                    let mut genres = album
                        .release_album
                        .iter()
                        .flat_map(|release| {
                            release
                                .genres
                                .iter()
                                .chain(release.information.genres.iter())
                        })
                        .chain(
                            album
                                .release_group_album
                                .iter()
                                .flat_map(|release| release.genres.iter()),
                        )
                        .map(|genre| genre.name.clone())
                        .filter(|value| !value.is_empty())
                        .collect::<Vec<_>>();
                    genres.sort();
                    genres.dedup();
                    PublicAlbum {
                        id: album.id.clone(),
                        title: album.name.clone(),
                        first_release_date: album.first_release_date.clone(),
                        primary_type: album.primary_type.clone(),
                        musicbrainz_id: album.musicbrainz_id.clone(),
                        wikidata_id: album.wikidata_id.clone(),
                        contributing_artists: album.contributing_artists.clone(),
                        release,
                        genres,
                        tracks,
                    }
                })
                .collect();
            let mut musicbrainz_ids = artist
                .albums
                .iter()
                .flat_map(|album| album.release_album.iter())
                .flat_map(|release| release.information.artist_credits.iter())
                .map(|credit| credit.musicbrainz_id.clone())
                .filter(|id| !id.is_empty())
                .collect::<Vec<_>>();
            musicbrainz_ids.sort();
            musicbrainz_ids.dedup();
            PublicArtist {
                id: artist.id.clone(),
                name: artist.name.clone(),
                musicbrainz_ids,
                albums,
            }
        })
        .collect();
    PublicLibraryIndex {
        format: "parson-public-library-index",
        version: PUBLIC_INDEX_VERSION,
        generated_at: Utc::now().to_rfc3339(),
        privacy: PublicPrivacyStatement {
            contains_personal_data: false,
            omitted: [
                "usernames",
                "display names",
                "email and account data",
                "password hashes and sessions",
                "listen, search, and lyrics history",
                "favorites and private playlists",
                "filesystem paths and filenames",
                "library root locations",
                "server address and instance identity",
                "profile pictures",
                "file timestamps",
            ],
        },
        summary,
        artists,
    }
}

fn public_index_zip(index: &PublicLibraryIndex) -> Result<Vec<u8>, String> {
    let json = serde_json::to_vec_pretty(index).map_err(|error| error.to_string())?;
    let cursor = Cursor::new(Vec::new());
    let mut archive = zip::ZipWriter::new(cursor);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    archive
        .start_file("parson-library-index.json", options)
        .map_err(|error| error.to_string())?;
    archive
        .write_all(&json)
        .map_err(|error| error.to_string())?;
    archive
        .start_file("README.txt", options)
        .map_err(|error| error.to_string())?;
    archive
        .write_all(
            b"Parson share-safe library index\n\nThis archive contains music metadata and audio characteristics only.\nIt excludes accounts, paths, filenames, server identity, playlists, favorites, and activity history.\n",
        )
        .map_err(|error| error.to_string())?;
    archive
        .finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|error| error.to_string())
}

fn valid_archive_entry(path: &Path) -> bool {
    !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn validate_restore_database(path: &Path) -> Result<(), String> {
    #[derive(QueryableByName)]
    struct CheckRow {
        #[diesel(sql_type = Text)]
        integrity_check: String,
    }
    #[derive(QueryableByName)]
    struct CountRow {
        #[diesel(sql_type = BigInt)]
        count: i64,
    }
    let database_path = path
        .to_str()
        .ok_or_else(|| "restored database path is not valid UTF-8".to_string())?;
    let mut connection =
        diesel::SqliteConnection::establish(database_path).map_err(|error| error.to_string())?;
    let checks = diesel::sql_query("PRAGMA integrity_check")
        .load::<CheckRow>(&mut connection)
        .map_err(|error| error.to_string())?;
    if checks.is_empty()
        || checks
            .iter()
            .any(|row| !row.integrity_check.eq_ignore_ascii_case("ok"))
    {
        return Err("the backup database failed its integrity check".to_string());
    }
    let required = diesel::sql_query(
        "SELECT COUNT(*) AS count FROM sqlite_master
         WHERE type = 'table' AND name IN ('user', 'file_entry', 'listen_history_item')",
    )
    .get_result::<CountRow>(&mut connection)
    .map_err(|error| error.to_string())?;
    if required.count != 3 {
        return Err("the backup database is not a compatible Parson database".to_string());
    }
    Ok(())
}

fn sanitize_backup_database(path: &Path) -> Result<(), String> {
    let snapshot_path = path
        .to_str()
        .ok_or_else(|| "snapshot path is not valid UTF-8".to_string())?;
    let mut snapshot =
        diesel::SqliteConnection::establish(snapshot_path).map_err(|error| error.to_string())?;
    snapshot
        .batch_execute(
            "PRAGMA journal_mode = DELETE;
             DELETE FROM refresh_session;
             UPDATE user
             SET token_version = token_version + 1, now_playing = NULL;",
        )
        .map_err(|error| error.to_string())?;
    drop(snapshot);
    validate_restore_database(path)
}

fn validate_and_stage_restore(path: &Path) -> Result<(), String> {
    let input = File::open(path).map_err(|error| error.to_string())?;
    let decoder = zstd::Decoder::new(input).map_err(|error| error.to_string())?;
    let mut archive = tar::Archive::new(decoder);
    let stage = settings::data_path(&["Restore", "staged"]);
    let incoming = settings::data_path(&["Restore", "incoming"]);
    let _ = fs::remove_dir_all(&incoming);
    fs::create_dir_all(&incoming).map_err(|error| error.to_string())?;
    let mut found_manifest = false;
    let mut found_music_database = false;
    let mut extracted_bytes = 0_u64;
    for (entry_index, item) in archive
        .entries()
        .map_err(|error| error.to_string())?
        .enumerate()
    {
        if entry_index >= MAX_RESTORE_ENTRIES {
            return Err("backup contains too many files".to_string());
        }
        let mut item = item.map_err(|error| error.to_string())?;
        extracted_bytes = extracted_bytes
            .checked_add(item.header().size().map_err(|error| error.to_string())?)
            .ok_or_else(|| "backup expanded size is invalid".to_string())?;
        if extracted_bytes > MAX_RESTORE_EXTRACTED_BYTES {
            return Err("backup expands beyond the restore safety limit".to_string());
        }
        let item_path = item.path().map_err(|error| error.to_string())?.into_owned();
        if !valid_archive_entry(&item_path) {
            return Err("backup contains an unsafe path".to_string());
        }
        if !item.header().entry_type().is_file() && !item.header().entry_type().is_dir() {
            return Err("backup contains an unsupported link or special file".to_string());
        }
        if item_path == Path::new("manifest.json") {
            let mut bytes = Vec::new();
            item.read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            let manifest: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
            if manifest["format"] != "parson-private-backup"
                || manifest["version"] != BACKUP_FORMAT_VERSION
            {
                return Err("this is not a supported Parson private backup".to_string());
            }
            found_manifest = true;
            fs::write(incoming.join("manifest.json"), bytes).map_err(|error| error.to_string())?;
            continue;
        }
        if item_path == Path::new("Database/parson-music.db") {
            found_music_database = true;
        }
        item.unpack_in(&incoming)
            .map_err(|error| error.to_string())?;
    }
    if !found_manifest || !found_music_database {
        return Err("backup is incomplete".to_string());
    }
    validate_restore_database(&incoming.join("Database/parson-music.db"))?;
    let _ = fs::remove_dir_all(&stage);
    fs::rename(&incoming, &stage).map_err(|error| error.to_string())?;
    fs::write(
        settings::data_path(&["Restore", "READY"]),
        Utc::now().to_rfc3339(),
    )
    .map_err(|error| error.to_string())
}

#[get("/status")]
async fn status(pool: web::Data<DbPool>) -> HttpResponse {
    let status_pool = pool.get_ref().clone();
    match web::block(move || -> Result<DataStatus, String> {
        #[derive(QueryableByName)]
        struct Counts {
            #[diesel(sql_type = BigInt)]
            history: i64,
            #[diesel(sql_type = BigInt)]
            favorites: i64,
            #[diesel(sql_type = BigInt)]
            playlists: i64,
        }
        let mut connection = status_pool.get().map_err(|error| error.to_string())?;
        let counts = diesel::sql_query(
            "SELECT
              (SELECT COUNT(*) FROM listen_history_item) AS history,
              (SELECT COUNT(*) FROM favorite_song) AS favorites,
              (SELECT COUNT(*) FROM playlist) AS playlists",
        )
        .get_result::<Counts>(&mut connection)
        .map_err(|error| error.to_string())?;
        Ok(DataStatus {
            database_bytes: settings::music_database_path()
                .metadata()
                .map(|metadata| metadata.len())
                .unwrap_or(0),
            user_file_bytes: [
                "Profile Pictures",
                "Album Covers",
                "Artist Icons",
                "Artwork",
            ]
            .iter()
            .map(|name| directory_size(&settings::data_path(&[name])))
            .sum(),
            cache_bytes: ["Album Covers", "Artist Icons", "Artwork", "Cache"]
                .iter()
                .map(|name| directory_size(&settings::data_path(&[name])))
                .sum(),
            listen_history_items: counts.history,
            favorite_items: counts.favorites,
            playlist_items: counts.playlists,
            backups: list_backups().map_err(|error| error.to_string())?,
            automatic_backup_interval_hours: AUTOMATIC_BACKUP_INTERVAL_HOURS,
            daily_backup_count: DAILY_BACKUP_COUNT,
            weekly_backup_count: WEEKLY_BACKUP_COUNT,
            monthly_backup_count: MONTHLY_BACKUP_COUNT,
            restore_pending: settings::data_path(&["Restore", "READY"]).is_file(),
            reset_pending: settings::data_path(&["Reset", "READY"]).is_file(),
        })
    })
    .await
    {
        Ok(Ok(status)) => HttpResponse::Ok().json(status),
        Ok(Err(error)) => {
            tracing::error!(%error, "data status failed");
            internal_server_error("Could not load data status.", "data_status_failed")
        }
        Err(error) => {
            tracing::error!(%error, "data status worker failed");
            internal_server_error("Could not load data status.", "data_status_failed")
        }
    }
}

#[delete("/cache")]
async fn clear_cache() -> HttpResponse {
    let root = settings::data_path(&[]);
    match web::block(move || clear_cache_at(&root)).await {
        Ok(Ok(cleared_bytes)) => HttpResponse::Ok().json(serde_json::json!({
            "cleared_bytes": cleared_bytes
        })),
        Ok(Err(error)) => {
            tracing::error!(%error, "cache clearing failed");
            internal_server_error("Could not clear the cache.", "cache_clear_failed")
        }
        Err(error) => {
            tracing::error!(%error, "cache clearing worker failed");
            internal_server_error("Could not clear the cache.", "cache_clear_failed")
        }
    }
}

#[post("/reset")]
async fn reset_parson(pool: web::Data<DbPool>, body: web::Json<ResetRequest>) -> HttpResponse {
    if body.confirmation != "RESET PARSON" {
        return bad_request(
            "Type RESET PARSON to confirm.",
            "reset_confirmation_required",
        );
    }
    let backup_pool = pool.get_ref().clone();
    match web::block(move || -> Result<(), String> {
        create_safety_backup(&backup_pool)?;
        let reset = settings::data_path(&["Reset"]);
        fs::create_dir_all(&reset).map_err(|error| error.to_string())?;
        fs::write(reset.join("READY"), Utc::now().to_rfc3339()).map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(())) => HttpResponse::Accepted().json(serde_json::json!({
            "restart_required": true,
            "message": "Reset is ready. Restart Parson to finish."
        })),
        Ok(Err(error)) => {
            tracing::error!(%error, "Parson reset staging failed");
            internal_server_error(
                "Could not create the safety backup, so Parson was not reset.",
                "reset_failed",
            )
        }
        Err(error) => {
            tracing::error!(%error, "Parson reset worker failed");
            internal_server_error("Could not prepare the reset.", "reset_failed")
        }
    }
}

#[post("/backups")]
async fn create_backup(pool: web::Data<DbPool>) -> HttpResponse {
    let backup_pool = pool.get_ref().clone();
    match web::block(move || create_backup_archive(&backup_pool)).await {
        Ok(Ok(backup)) => HttpResponse::Created().json(backup),
        Ok(Err(error)) => {
            tracing::error!(%error, "private backup failed");
            internal_server_error("Could not create the backup.", "backup_failed")
        }
        Err(error) => {
            tracing::error!(%error, "private backup worker failed");
            internal_server_error("Could not create the backup.", "backup_failed")
        }
    }
}

#[get("/backups/{filename}")]
async fn download_backup(path: web::Path<String>) -> HttpResponse {
    let Some(filename) = safe_backup_filename(&path) else {
        return bad_request("Invalid backup filename.", "invalid_backup_filename");
    };
    match tokio::fs::File::open(backup_directory().join(filename)).await {
        Ok(file) => {
            let length = file.metadata().await.ok().map(|metadata| metadata.len());
            let mut response = HttpResponse::Ok();
            response.insert_header(("content-type", "application/zstd"));
            response.insert_header((
                "content-disposition",
                format!("attachment; filename=\"{filename}\""),
            ));
            if let Some(length) = length {
                response.insert_header(("content-length", length.to_string()));
            }
            response.streaming(tokio_util::io::ReaderStream::new(file))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            not_found("Backup not found.", "backup_not_found")
        }
        Err(error) => {
            tracing::error!(%error, "backup download failed");
            internal_server_error("Could not download the backup.", "backup_download_failed")
        }
    }
}

#[delete("/backups/{filename}")]
async fn delete_backup(path: web::Path<String>) -> HttpResponse {
    let Some(filename) = safe_backup_filename(&path) else {
        return bad_request("Invalid backup filename.", "invalid_backup_filename");
    };
    match tokio::fs::remove_file(backup_directory().join(filename)).await {
        Ok(()) => HttpResponse::NoContent().finish(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            not_found("Backup not found.", "backup_not_found")
        }
        Err(error) => {
            tracing::error!(%error, "backup deletion failed");
            internal_server_error("Could not delete the backup.", "backup_delete_failed")
        }
    }
}

#[post("/restore")]
async fn restore_backup(mut multipart: Multipart) -> HttpResponse {
    let upload = settings::data_path(&["Restore", format!(".upload-{}", Uuid::new_v4()).as_str()]);
    if let Some(parent) = upload.parent()
        && let Err(error) = tokio::fs::create_dir_all(parent).await
    {
        tracing::error!(%error, "restore directory creation failed");
        return internal_server_error("Could not receive the backup.", "restore_upload_failed");
    }
    let mut total = 0_u64;
    let mut output = match tokio::fs::File::create(&upload).await {
        Ok(file) => file,
        Err(error) => {
            tracing::error!(%error, "restore upload creation failed");
            return internal_server_error("Could not receive the backup.", "restore_upload_failed");
        }
    };
    use tokio::io::AsyncWriteExt;
    let mut field = match multipart.next().await {
        Some(Ok(field)) => field,
        Some(Err(_)) | None => {
            let _ = tokio::fs::remove_file(&upload).await;
            return bad_request("The backup upload is invalid.", "invalid_restore_upload");
        }
    };
    while let Some(chunk) = field.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(_) => {
                let _ = tokio::fs::remove_file(&upload).await;
                return bad_request("The backup upload is invalid.", "invalid_restore_upload");
            }
        };
        total = total.saturating_add(chunk.len() as u64);
        if total > MAX_RESTORE_BYTES || output.write_all(&chunk).await.is_err() {
            let _ = tokio::fs::remove_file(&upload).await;
            return bad_request(
                "The backup is too large or incomplete.",
                "restore_too_large",
            );
        }
    }
    drop(field);
    if multipart.next().await.is_some() || total == 0 {
        let _ = tokio::fs::remove_file(&upload).await;
        return bad_request("Upload exactly one backup file.", "invalid_restore_upload");
    }
    drop(output);
    let validate_path = upload.clone();
    let result = web::block(move || validate_and_stage_restore(&validate_path)).await;
    let _ = tokio::fs::remove_file(&upload).await;
    match result {
        Ok(Ok(())) => HttpResponse::Accepted().json(serde_json::json!({
            "restart_required": true,
            "message": "Backup validated. Restart Parson to apply it."
        })),
        Ok(Err(error)) => bad_request(&error, "invalid_backup"),
        Err(error) => {
            tracing::error!(%error, "restore validation worker failed");
            internal_server_error("Could not validate the backup.", "restore_failed")
        }
    }
}

#[get("/public-index")]
async fn export_public_index(
    pool: web::Data<DbPool>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let library = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let details_pool = pool.get_ref().clone();
    let details = match web::block(move || audio_details(&details_pool)).await {
        Ok(Ok(details)) => details,
        Ok(Err(error)) => {
            tracing::error!(%error, "public index audio details failed");
            return internal_server_error(
                "Could not create the public index.",
                "public_index_failed",
            );
        }
        Err(error) => {
            tracing::error!(%error, "public index audio details worker failed");
            return internal_server_error(
                "Could not create the public index.",
                "public_index_failed",
            );
        }
    };
    match public_index_zip(&public_index(library.artists.as_ref(), &details)) {
        Ok(bytes) => HttpResponse::Ok()
            .insert_header(("content-type", "application/zip"))
            .insert_header((
                "content-disposition",
                format!(
                    "attachment; filename=\"parson-library-index-{}.zip\"",
                    Utc::now().format("%Y-%m-%d")
                ),
            ))
            .body(bytes),
        Err(error) => {
            tracing::error!(%error, "public index serialization failed");
            internal_server_error("Could not create the public index.", "public_index_failed")
        }
    }
}

#[get("/me/export")]
async fn export_personal_data(pool: web::Data<DbPool>, request: HttpRequest) -> HttpResponse {
    let user_id = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let export_pool = pool.get_ref().clone();
    match web::block(move || -> Result<PersonalDataExport, String> {
        let mut connection = export_pool.get().map_err(|error| error.to_string())?;
        let object_rows = |sql: &str,
                           connection: &mut diesel::SqliteConnection|
         -> Result<Vec<serde_json::Value>, String> {
            #[derive(QueryableByName)]
            struct JsonRow {
                #[diesel(sql_type = Text)]
                value: String,
            }
            diesel::sql_query(sql)
                .bind::<Integer, _>(user_id)
                .load::<JsonRow>(connection)
                .map_err(|error| error.to_string())?
                .into_iter()
                .map(|row| serde_json::from_str(&row.value).map_err(|error| error.to_string()))
                .collect()
        };
        let profile = object_rows(
            "SELECT json_object('id', id, 'name', name, 'username', username, 'bitrate', bitrate,
              'created_at', created_at, 'role', role) AS value FROM user WHERE id = ?",
            &mut connection,
        )?
        .into_iter()
        .next()
        .unwrap_or(serde_json::Value::Null);
        Ok(PersonalDataExport {
            format: "parson-personal-data",
            version: 1,
            exported_at: Utc::now().to_rfc3339(),
            profile,
            listen_history: object_rows(
                "SELECT json_object('song_id', song_id, 'listened_at', listened_at) AS value
                 FROM listen_history_item WHERE user_id = ? ORDER BY id DESC",
                &mut connection,
            )?,
            favorites: object_rows(
                "SELECT json_object('song_id', song_id, 'added_at', added_at) AS value
                 FROM favorite_song WHERE user_id = ? ORDER BY added_at DESC",
                &mut connection,
            )?,
            searches: object_rows(
                "SELECT json_object('query', search, 'created_at', created_at) AS value
                 FROM search_item WHERE user_id = ? ORDER BY id DESC",
                &mut connection,
            )?,
            playlists: object_rows(
                "SELECT json_object('id', playlist.id, 'name', playlist.name,
                  'description', playlist.description, 'is_public', playlist.is_public,
                  'created_at', playlist.created_at, 'updated_at', playlist.updated_at,
                  'songs', json((
                    SELECT json_group_array(json_object(
                      'song_id', _playlist_to_song.b,
                      'position', _playlist_to_song.position,
                      'date_added', _playlist_to_song.date_added
                    ))
                    FROM _playlist_to_song
                    WHERE _playlist_to_song.a = playlist.id
                    ORDER BY _playlist_to_song.position, _playlist_to_song.rowid
                  ))) AS value
                 FROM playlist JOIN _playlist_to_user ON _playlist_to_user.a = playlist.id
                 WHERE _playlist_to_user.b = ? ORDER BY playlist.id",
                &mut connection,
            )?,
        })
    })
    .await
    {
        Ok(Ok(export)) => match serde_json::to_vec_pretty(&export) {
            Ok(bytes) => HttpResponse::Ok()
                .insert_header(("content-type", "application/json"))
                .insert_header((
                    "content-disposition",
                    format!("attachment; filename=\"parson-personal-data-{user_id}.json\""),
                ))
                .body(bytes),
            Err(_) => {
                internal_server_error("Could not export your data.", "personal_export_failed")
            }
        },
        Ok(Err(error)) => {
            tracing::error!(%error, "personal data export failed");
            internal_server_error("Could not export your data.", "personal_export_failed")
        }
        Err(error) => {
            tracing::error!(%error, "personal data export worker failed");
            internal_server_error("Could not export your data.", "personal_export_failed")
        }
    }
}

#[delete("/me/history")]
async fn clear_personal_history(pool: web::Data<DbPool>, request: HttpRequest) -> HttpResponse {
    let user_id = match authenticated_user_id(&request) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let clear_pool = pool.get_ref().clone();
    match web::block(move || -> Result<usize, String> {
        let mut connection = clear_pool.get().map_err(|error| error.to_string())?;
        connection
            .immediate_transaction(|connection| {
                let mut deleted = 0;
                for table in [
                    "listen_history_item",
                    "playback_event",
                    "search_item",
                    "lyrics_view_history",
                    "user_track_preference",
                    "user_artist_preference",
                    "user_album_preference",
                    "user_genre_preference",
                    "track_transition",
                    "playback_queue",
                ] {
                    deleted += diesel::sql_query(format!("DELETE FROM {table} WHERE user_id = ?"))
                        .bind::<Integer, _>(user_id)
                        .execute(connection)?;
                }
                diesel::sql_query("UPDATE user SET now_playing = NULL WHERE id = ?")
                    .bind::<Integer, _>(user_id)
                    .execute(connection)?;
                diesel::sql_query("DELETE FROM user_data_retention WHERE user_id = ?")
                    .bind::<Integer, _>(user_id)
                    .execute(connection)?;
                Ok(deleted)
            })
            .map_err(|error: diesel::result::Error| error.to_string())
    })
    .await
    {
        Ok(Ok(deleted)) => HttpResponse::Ok().json(serde_json::json!({ "deleted": deleted })),
        Ok(Err(error)) => {
            tracing::error!(%error, "personal history deletion failed");
            internal_server_error("Could not clear your history.", "history_clear_failed")
        }
        Err(error) => {
            tracing::error!(%error, "personal history deletion worker failed");
            internal_server_error("Could not clear your history.", "history_clear_failed")
        }
    }
}

pub fn configure_admin(cfg: &mut web::ServiceConfig) {
    cfg.service(status)
        .service(create_backup)
        .service(download_backup)
        .service(delete_backup)
        .service(restore_backup)
        .service(export_public_index)
        .service(clear_cache)
        .service(reset_parson);
}

pub fn configure_personal(cfg: &mut web::ServiceConfig) {
    cfg.service(export_personal_data)
        .service(clear_personal_history);
}

pub fn start_automatic_backups(pool: DbPool) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            match automatic_backup_due(&pool) {
                Ok(false) => continue,
                Ok(true) => {}
                Err(error) => {
                    tracing::warn!(%error, "could not evaluate automatic backup state");
                    continue;
                }
            }
            let backup_pool = pool.clone();
            match web::block(move || create_backup_archive(&backup_pool)).await {
                Ok(Ok(backup)) => {
                    tracing::info!(filename = %backup.filename, "automatic private backup created")
                }
                Ok(Err(error)) => tracing::warn!(%error, "automatic private backup failed"),
                Err(error) => tracing::warn!(%error, "automatic private backup worker failed"),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        BackupRecord, BackupSummary, BackupTier, PublicAudioDetails, clear_cache_at,
        clear_personal_history, public_index, public_index_zip, retention_plan,
        safe_backup_filename, sanitize_backup_database, valid_archive_entry,
    };
    use crate::domain::{Album, Artist, Song};
    use actix_web::{App, HttpMessage, http::StatusCode, test as actix_test, web};
    use chrono::{Datelike, TimeZone, Utc};
    use diesel::connection::SimpleConnection;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel::sqlite::SqliteConnection;
    use diesel::{Connection, RunQueryDsl};
    use std::collections::HashMap;
    use std::io::{Cursor, Read};
    use std::path::Path;

    #[test]
    fn public_index_is_allowlist_based_and_never_serializes_private_fields() {
        let library = vec![Artist {
            id: "artist-id".into(),
            name: "An Artist".into(),
            albums: vec![Album {
                id: "album-id".into(),
                name: "An Album".into(),
                songs: vec![Song {
                    id: "song-id".into(),
                    name: "A Track".into(),
                    artist: "An Artist".into(),
                    path: "/home/alice/Music/private-name/song.flac".into(),
                    duration: 123.0,
                    ..Song::default()
                }],
                ..Album::default()
            }],
            ..Artist::default()
        }];
        let mut details = HashMap::new();
        details.insert(
            "/home/alice/Music/private-name/song.flac".into(),
            PublicAudioDetails {
                format: "flac".into(),
                container: Some("flac".into()),
                codec: Some("flac".into()),
                average_bitrate_bps: Some(900_000),
                sample_rate: Some(96_000),
                channels: Some(2),
                disc_number: Some(1),
                musicbrainz_recording_id: Some("recording-id".into()),
                musicbrainz_release_id: Some("release-id".into()),
                size_bytes: 42,
            },
        );
        let serialized =
            serde_json::to_string(&public_index(&library, &details)).expect("public index");
        assert!(serialized.contains("\"contains_personal_data\":false"));
        assert!(serialized.contains("\"sample_rate\":96000"));
        for secret in [
            "/home/alice",
            "private-name",
            "listen_history",
            "instance_id",
            "now_playing",
            "alice@example.com",
            "192.168.1.20",
        ] {
            assert!(
                !serialized.contains(secret),
                "leaked {secret}: {serialized}"
            );
        }
    }

    #[test]
    fn public_index_is_a_native_zip_with_only_share_safe_files() {
        let index = public_index(&[], &HashMap::new());
        let bytes = public_index_zip(&index).expect("public index zip");
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("valid zip");
        assert_eq!(archive.len(), 2);
        let mut json = String::new();
        archive
            .by_name("parson-library-index.json")
            .expect("index entry")
            .read_to_string(&mut json)
            .expect("index JSON");
        assert!(json.contains("\"contains_personal_data\": false"));
        assert!(!json.contains("/home/"));
        assert!(archive.by_name("README.txt").is_ok());
    }

    #[test]
    fn retention_promotes_the_july_25_example_to_fourteen_restore_points() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 7, 25).expect("example date");
        let start = chrono::NaiveDate::from_ymd_opt(2026, 4, 1).expect("start date");
        let mut records = Vec::new();
        for offset in 0..=today.signed_duration_since(start).num_days() {
            let date = today - chrono::Duration::days(offset);
            let created_at = Utc
                .with_ymd_and_hms(date.year(), date.month(), date.day(), 12, 0, 0)
                .single()
                .expect("backup date");
            records.push(BackupRecord {
                summary: BackupSummary {
                    filename: format!("{}.tar.zst", date.format("%Y-%m-%d")),
                    created_at: created_at.to_rfc3339(),
                    size_bytes: 1,
                    tier: None,
                },
                created_at,
                meaningful_fingerprint: Some(format!("revision-{offset}")),
            });
        }

        let plan = retention_plan(&records, today);
        let dates_for = |tier| {
            let mut dates = plan
                .iter()
                .filter_map(|(filename, value)| (*value == tier).then_some(filename.clone()))
                .collect::<Vec<_>>();
            dates.sort_unstable_by(|left, right| right.cmp(left));
            dates
        };
        assert_eq!(
            dates_for(BackupTier::Daily),
            [
                "2026-07-25",
                "2026-07-24",
                "2026-07-23",
                "2026-07-22",
                "2026-07-21",
                "2026-07-20",
                "2026-07-19"
            ]
            .map(|date| format!("{date}.tar.zst"))
        );
        assert_eq!(
            dates_for(BackupTier::Weekly),
            ["2026-07-12", "2026-07-05", "2026-06-28", "2026-06-21"]
                .map(|date| format!("{date}.tar.zst"))
        );
        assert_eq!(
            dates_for(BackupTier::Monthly),
            ["2026-06-01", "2026-05-01", "2026-04-01"].map(|date| format!("{date}.tar.zst"))
        );
        assert_eq!(plan.len(), 14);
    }

    #[test]
    fn archive_and_download_paths_reject_traversal() {
        assert!(safe_backup_filename("parson-backup-20260101T000000Z.tar.zst").is_some());
        assert!(safe_backup_filename("../parson-backup-x.tar.zst").is_none());
        assert!(valid_archive_entry(Path::new("Database/parson-music.db")));
        assert!(!valid_archive_entry(Path::new("../Secrets/session.key")));
        assert!(!valid_archive_entry(Path::new("/etc/passwd")));
    }

    #[test]
    fn cache_clear_is_allowlisted_and_keeps_personal_data() {
        let root = std::env::temp_dir().join(format!("parson-cache-test-{}", uuid::Uuid::new_v4()));
        for name in [
            "Album Covers",
            "Artist Icons",
            "Artwork",
            "Cache",
            "Profile Pictures",
            "Database",
        ] {
            let directory = root.join(name);
            std::fs::create_dir_all(&directory).expect("cache fixture directory");
            std::fs::write(directory.join("item"), [1_u8, 2, 3]).expect("cache fixture file");
        }

        assert_eq!(clear_cache_at(&root).expect("clear cache"), 12);
        for name in ["Album Covers", "Artist Icons", "Artwork", "Cache"] {
            assert!(root.join(name).is_dir());
            assert_eq!(
                std::fs::read_dir(root.join(name))
                    .expect("empty cache directory")
                    .count(),
                0
            );
        }
        assert!(root.join("Profile Pictures/item").is_file());
        assert!(root.join("Database/item").is_file());
        std::fs::remove_dir_all(root).expect("cache test cleanup");
    }

    #[test]
    fn private_backup_snapshots_drop_sessions_and_transient_playback_state() {
        let path =
            std::env::temp_dir().join(format!("parson-backup-test-{}.db", uuid::Uuid::new_v4()));
        let database_path = path.to_str().expect("temporary database path");
        let mut connection =
            SqliteConnection::establish(database_path).expect("temporary backup database");
        connection
            .batch_execute(
                "CREATE TABLE user (
                   id INTEGER PRIMARY KEY, token_version INTEGER NOT NULL, now_playing TEXT
                 );
                 CREATE TABLE refresh_session (id TEXT PRIMARY KEY);
                 CREATE TABLE file_entry (id INTEGER PRIMARY KEY);
                 CREATE TABLE listen_history_item (id INTEGER PRIMARY KEY);
                 INSERT INTO user VALUES (1, 4, 'private-song-id');
                 INSERT INTO refresh_session VALUES ('private-session');",
            )
            .expect("private backup fixture");
        drop(connection);

        sanitize_backup_database(&path).expect("sanitized backup");

        #[derive(diesel::deserialize::QueryableByName)]
        struct SnapshotState {
            #[diesel(sql_type = diesel::sql_types::BigInt)]
            sessions: i64,
            #[diesel(sql_type = diesel::sql_types::Integer)]
            token_version: i32,
            #[diesel(sql_type = diesel::sql_types::Nullable<diesel::sql_types::Text>)]
            now_playing: Option<String>,
        }
        let mut connection =
            SqliteConnection::establish(database_path).expect("reopen sanitized backup");
        let state = diesel::sql_query(
            "SELECT (SELECT COUNT(*) FROM refresh_session) AS sessions,
                    token_version, now_playing FROM user WHERE id = 1",
        )
        .get_result::<SnapshotState>(&mut connection)
        .expect("sanitized state");
        assert_eq!(state.sessions, 0);
        assert_eq!(state.token_version, 5);
        assert!(state.now_playing.is_none());
        drop(connection);
        let _ = std::fs::remove_file(path);
    }

    #[actix_web::test]
    async fn clearing_activity_is_user_scoped_and_removes_derived_preferences() {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("activity pool");
        pool.get()
            .expect("activity connection")
            .batch_execute(
                "CREATE TABLE user (id INTEGER PRIMARY KEY, now_playing TEXT);
                 CREATE TABLE listen_history_item (id INTEGER PRIMARY KEY, user_id INTEGER);
                 CREATE TABLE playback_event (id INTEGER PRIMARY KEY, user_id INTEGER);
                 CREATE TABLE search_item (id INTEGER PRIMARY KEY, user_id INTEGER);
                 CREATE TABLE lyrics_view_history (id INTEGER PRIMARY KEY, user_id INTEGER);
                 CREATE TABLE user_track_preference (user_id INTEGER);
                 CREATE TABLE user_artist_preference (user_id INTEGER);
                 CREATE TABLE user_album_preference (user_id INTEGER);
                 CREATE TABLE user_genre_preference (user_id INTEGER);
                 CREATE TABLE track_transition (user_id INTEGER);
                 CREATE TABLE playback_queue (id TEXT PRIMARY KEY, user_id INTEGER);
                 CREATE TABLE user_data_retention (user_id INTEGER PRIMARY KEY);
                 INSERT INTO user VALUES (7, 'song-one'), (8, 'song-two');
                 INSERT INTO listen_history_item VALUES (1, 7), (2, 8);
                 INSERT INTO playback_event VALUES (1, 7), (2, 8);
                 INSERT INTO search_item VALUES (1, 7), (2, 8);
                 INSERT INTO lyrics_view_history VALUES (1, 7), (2, 8);
                 INSERT INTO user_track_preference VALUES (7), (8);
                 INSERT INTO user_artist_preference VALUES (7), (8);
                 INSERT INTO user_album_preference VALUES (7), (8);
                 INSERT INTO user_genre_preference VALUES (7), (8);
                 INSERT INTO track_transition VALUES (7), (8);
                 INSERT INTO playback_queue VALUES ('one', 7), ('two', 8);
                 INSERT INTO user_data_retention VALUES (7), (8);",
            )
            .expect("activity fixture");
        let pool: crate::persistence::connection::DbPool = std::sync::Arc::new(pool);
        let app = actix_test::init_service(
            App::new()
                .app_data(web::Data::new(pool.clone()))
                .service(clear_personal_history),
        )
        .await;
        let request = actix_test::TestRequest::delete()
            .uri("/me/history")
            .to_request();
        request.extensions_mut().insert(crate::api::auth::Claims {
            sub: "7".to_string(),
            exp: usize::MAX,
            username: "listener".to_string(),
            bitrate: 0,
            token_type: "access".to_string(),
            role: "user".to_string(),
            token_version: 0,
            session_id: None,
        });
        let response = actix_test::call_service(&app, request).await;
        assert_eq!(response.status(), StatusCode::OK);

        #[derive(diesel::deserialize::QueryableByName)]
        struct Count {
            #[diesel(sql_type = diesel::sql_types::BigInt)]
            count: i64,
        }
        let mut connection = pool.get().expect("assertion connection");
        for table in [
            "listen_history_item",
            "playback_event",
            "search_item",
            "lyrics_view_history",
            "user_track_preference",
            "user_artist_preference",
            "user_album_preference",
            "user_genre_preference",
            "track_transition",
            "playback_queue",
            "user_data_retention",
        ] {
            let current = diesel::sql_query(format!(
                "SELECT COUNT(*) AS count FROM {table} WHERE user_id = 7"
            ))
            .get_result::<Count>(&mut connection)
            .expect("current user count");
            let other = diesel::sql_query(format!(
                "SELECT COUNT(*) AS count FROM {table} WHERE user_id = 8"
            ))
            .get_result::<Count>(&mut connection)
            .expect("other user count");
            assert_eq!(current.count, 0, "{table}");
            assert_eq!(other.count, 1, "{table}");
        }
    }
}
