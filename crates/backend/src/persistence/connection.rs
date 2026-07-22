use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use diesel::connection::SimpleConnection;
use diesel::deserialize::QueryableByName;
use diesel::r2d2::{self, ConnectionManager};
use diesel::sql_types::{BigInt, Text};
use diesel::sqlite::SqliteConnection;
use diesel::{Connection, RunQueryDsl};
use diesel_migrations::{EmbeddedMigrations, MigrationHarness, embed_migrations};
use sha2::{Digest, Sha256};

pub type DbPool = Arc<r2d2::Pool<ConnectionManager<SqliteConnection>>>;
type BoxError = Box<dyn Error + Send + Sync + 'static>;

// Embed crates/backend/migrations.
const MIGRATIONS: EmbeddedMigrations = embed_migrations!("./migrations");
const V1_BASELINE_MIGRATION: &str = "20260719000000";
const LEGACY_MUSIC_MIGRATION: &str = "20240721200400";
const DEFAULT_SNAPSHOT_GENERATIONS: usize = 3;
const DEFAULT_INTEGRITY_INTERVAL: Duration = Duration::from_secs(7 * 24 * 60 * 60);
static DATABASE_POOL: OnceLock<Result<DbPool, String>> = OnceLock::new();
static SNAPSHOT_RUNNING: AtomicBool = AtomicBool::new(false);
static SNAPSHOT_PENDING: AtomicBool = AtomicBool::new(false);

#[derive(QueryableByName)]
struct IntegrityRow {
    #[diesel(sql_type = Text)]
    quick_check: String,
}

#[derive(QueryableByName)]
struct CatalogFingerprintRow {
    #[diesel(sql_type = Text)]
    signature: String,
}

#[derive(QueryableByName)]
struct CountQueryRow {
    #[diesel(sql_type = BigInt)]
    count: i64,
}

pub fn check_integrity(connection: &mut SqliteConnection) -> Result<(), BoxError> {
    let started = Instant::now();
    let result = (|| {
        let rows = diesel::sql_query("PRAGMA quick_check(1)").load::<IntegrityRow>(connection)?;
        if rows.len() == 1 && rows[0].quick_check == "ok" {
            Ok(())
        } else {
            let details = rows
                .into_iter()
                .map(|row| row.quick_check)
                .collect::<Vec<_>>()
                .join("; ");
            Err(format!("SQLite integrity check failed: {details}").into())
        }
    })();
    tracing::info!(
        snapshot_integrity_us = started.elapsed().as_micros() as u64,
        success = result.is_ok(),
        "database integrity timing"
    );
    result
}

fn snapshots_enabled() -> bool {
    !std::env::var("PARSON_DATABASE_SNAPSHOTS")
        .is_ok_and(|value| matches!(value.to_ascii_lowercase().as_str(), "0" | "false" | "off"))
}

fn snapshot_generations() -> usize {
    std::env::var("PARSON_DATABASE_SNAPSHOT_GENERATIONS")
        .ok()
        .and_then(|value| value.parse().ok())
        .map(|value: usize| value.clamp(1, 10))
        .unwrap_or(DEFAULT_SNAPSHOT_GENERATIONS)
}

fn integrity_interval() -> Duration {
    std::env::var("PARSON_DATABASE_INTEGRITY_INTERVAL_HOURS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map(|hours| Duration::from_secs(hours.saturating_mul(60 * 60)))
        .unwrap_or(DEFAULT_INTEGRITY_INTERVAL)
}

fn startup_marker(database_path: &Path) -> PathBuf {
    database_path.with_extension("db.running")
}

fn integrity_stamp(database_path: &Path) -> PathBuf {
    database_path.with_extension("db.integrity-checked")
}

fn snapshot_state(database_path: &Path) -> PathBuf {
    database_path.with_extension("db.snapshot-state")
}

fn catalog_fingerprint(connection: &mut SqliteConnection) -> Result<String, BoxError> {
    let rows = diesel::sql_query(
        "SELECT quote(fe.path) || '|' || quote(fe.size_bytes) || '|' ||
                quote(fe.modified_at_ns) || '|' || quote(fe.availability) || '|' ||
                quote(rfm.title) || '|' || quote(rfm.album) || '|' ||
                quote(rfm.track_artists_json) || '|' || quote(rfm.album_artists_json) || '|' ||
                quote(rfm.genres_json) || '|' || quote(rfm.release_date) || '|' ||
                quote(rfm.cover_url) || '|' || quote(rfm.parser_version) || '|' ||
                quote(rfm.track_number) || '|' || quote(rfm.disc_number) || '|' ||
                quote(rfm.duration_seconds) || '|' || quote(rfm.musicbrainz_recording_id) || '|' ||
                quote(rfm.musicbrainz_release_id) || '|' || quote(rfm.musicbrainz_artist_id) || '|' ||
                quote(rfm.musicbrainz_album_artist_id) || '|' || quote(rfm.error) AS signature
         FROM file_entry fe
         JOIN raw_file_metadata rfm ON rfm.file_id = fe.id
         ORDER BY fe.path",
    )
    .load::<CatalogFingerprintRow>(connection)?;
    let mut digest = Sha256::new();
    for row in rows {
        digest.update(row.signature.len().to_le_bytes());
        digest.update(row.signature.as_bytes());
    }
    Ok(digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn integrity_check_due(database_path: &Path, abnormal_shutdown: bool) -> bool {
    if abnormal_shutdown {
        return true;
    }
    fs::metadata(integrity_stamp(database_path))
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|checked| SystemTime::now().duration_since(checked).ok())
        .is_none_or(|age| age >= integrity_interval())
}

fn snapshot_files(database_path: &Path) -> std::io::Result<Vec<PathBuf>> {
    let parent = database_path
        .parent()
        .ok_or_else(|| std::io::Error::other("database path has no parent"))?;
    let database_name = database_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| std::io::Error::other("database name is not valid UTF-8"))?;
    let prefix = format!("{database_name}.snapshot-");
    let mut snapshots = fs::read_dir(parent)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(&prefix) && name.ends_with(".db"))
        })
        .collect::<Vec<_>>();
    snapshots.sort();
    Ok(snapshots)
}

pub fn recovery_snapshot_count() -> Result<usize, BoxError> {
    Ok(snapshot_files(&crate::settings::music_database_path())?.len())
}

pub fn mark_clean_shutdown() {
    let marker = startup_marker(&crate::settings::music_database_path());
    if let Err(error) = fs::remove_file(&marker)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!(%error, path = %marker.display(), "could not clear database startup marker");
    }
}

fn create_verified_snapshot(
    connection: &mut SqliteConnection,
    database_path: &Path,
    generations: usize,
) -> Result<PathBuf, BoxError> {
    let parent = database_path
        .parent()
        .ok_or_else(|| "database path has no parent directory".to_string())?;
    let database_name = database_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "database name is not valid UTF-8".to_string())?;
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let identity = uuid::Uuid::new_v4();
    let temporary = parent.join(format!(
        "{database_name}.snapshot-{timestamp}-{identity}.tmp"
    ));
    let snapshot = parent.join(format!(
        "{database_name}.snapshot-{timestamp}-{identity}.db"
    ));
    let sql_path = temporary.to_string_lossy().replace('\'', "''");
    if let Err(error) = diesel::sql_query(format!("VACUUM INTO '{sql_path}'")).execute(connection) {
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    let verify_url = temporary
        .to_str()
        .ok_or_else(|| "snapshot path is not valid UTF-8".to_string())?;
    let mut verification = SqliteConnection::establish(verify_url)?;
    if let Err(error) = check_integrity(&mut verification) {
        drop(verification);
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    drop(verification);
    fs::rename(&temporary, &snapshot)?;

    let snapshots = snapshot_files(database_path)?;
    for obsolete in snapshots
        .into_iter()
        .rev()
        .skip(generations)
        .collect::<Vec<_>>()
    {
        if let Err(error) = fs::remove_file(&obsolete) {
            tracing::warn!(%error, path = %obsolete.display(), "could not prune old database snapshot");
        }
    }
    Ok(snapshot)
}

/// Starts an asynchronous recovery snapshot after a changed import.
pub fn snapshot_after_import(pool: &DbPool, database_changed: bool) {
    if !database_changed || !snapshots_enabled() {
        return;
    }
    SNAPSHOT_PENDING.store(true, Ordering::Release);
    if SNAPSHOT_RUNNING.swap(true, Ordering::AcqRel) {
        tracing::debug!("database recovery snapshot queued behind running snapshot");
        return;
    }

    let pool = pool.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("database-snapshot".into())
        .spawn(move || {
            while SNAPSHOT_PENDING.swap(false, Ordering::AcqRel) {
                let snapshot_started = Instant::now();
                let database_path = crate::settings::music_database_path();
                let result = pool
                    .get()
                    .map_err(|error| -> BoxError { Box::new(error) })
                    .and_then(|mut connection| {
                        let fingerprint = catalog_fingerprint(&mut connection)?;
                        let unchanged = !snapshot_files(&database_path)?.is_empty()
                            && fs::read_to_string(snapshot_state(&database_path))
                                .is_ok_and(|previous| previous.trim() == fingerprint);
                        if unchanged {
                            tracing::debug!(
                                "database catalog unchanged; recovery snapshot skipped"
                            );
                            return Ok(None);
                        }
                        let snapshot = create_verified_snapshot(
                            &mut connection,
                            &database_path,
                            snapshot_generations(),
                        )?;
                        fs::write(snapshot_state(&database_path), format!("{fingerprint}\n"))?;
                        Ok(Some(snapshot))
                    });
                match result {
                    Ok(Some(snapshot)) => tracing::info!(
                        path = %snapshot.display(),
                        snapshot_integrity_us = snapshot_started.elapsed().as_micros() as u64,
                        "database recovery snapshot created"
                    ),
                    Ok(None) => tracing::debug!(
                        snapshot_integrity_us = snapshot_started.elapsed().as_micros() as u64,
                        "database recovery snapshot skipped"
                    ),
                    Err(error) => tracing::warn!(
                        %error,
                        snapshot_integrity_us = snapshot_started.elapsed().as_micros() as u64,
                        "could not create database recovery snapshot"
                    ),
                }
            }
            SNAPSHOT_RUNNING.store(false, Ordering::Release);
            // Close the race between the final pending check and clearing RUNNING.
            if SNAPSHOT_PENDING.load(Ordering::Acquire) {
                snapshot_after_import(&pool, true);
            }
        })
    {
        SNAPSHOT_RUNNING.store(false, Ordering::Release);
        SNAPSHOT_PENDING.store(false, Ordering::Release);
        tracing::warn!(%error, "could not start database snapshot worker");
    }
}

#[derive(Debug)]
struct ConfigureConnection;

impl r2d2::CustomizeConnection<SqliteConnection, diesel::r2d2::Error> for ConfigureConnection {
    fn on_acquire(&self, connection: &mut SqliteConnection) -> Result<(), diesel::r2d2::Error> {
        connection
            .batch_execute(
                "PRAGMA synchronous = NORMAL;
                 PRAGMA foreign_keys = ON;
                 PRAGMA busy_timeout = 30000;
                 -- 64 MiB leaves enough room for catalog indexes and staging
                 -- tables without allowing SQLite's page cache to grow freely.
                 PRAGMA cache_size = -65536;
                 PRAGMA temp_store = MEMORY;
                 PRAGMA mmap_size = 268435456;",
            )
            .map_err(diesel::r2d2::Error::QueryError)
    }
}

fn recover_interrupted_scan_jobs(connection: &mut SqliteConnection) -> Result<usize, BoxError> {
    // Clear scan stages left on reused connections after interrupted imports.
    connection.batch_execute(
        "DROP TABLE IF EXISTS temp.file_metadata_stage;
         DROP TABLE IF EXISTS temp.current_scan_path;
         DROP TABLE IF EXISTS temp.changed_scan_path;
         DROP TABLE IF EXISTS temp.library_rebuild_stage;
         DROP TABLE IF EXISTS temp.library_genre_stage;
         DROP TABLE IF EXISTS temp.affected_album;
         DROP TABLE IF EXISTS temp.affected_track;
         DROP TABLE IF EXISTS temp.affected_artist;",
    )?;
    Ok(diesel::sql_query(
        "UPDATE library_scan_job
         SET status = 'failed', finished_at = CURRENT_TIMESTAMP,
             message = 'Server stopped before scan completion'
         WHERE status = 'running'",
    )
    .execute(connection)?)
}

fn open_pool() -> Result<DbPool, BoxError> {
    let path = crate::settings::music_database_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let legacy = crate::settings::legacy_music_database_path();
    if migrate_legacy_database(&legacy, &path)? {
        tracing::info!(from = %legacy.display(), to = %path.display(), "migrated legacy database filename");
    }
    let url = path
        .to_str()
        .ok_or_else(|| format!("Database path is not valid UTF-8: {path:?}"))?;
    let mut connection = SqliteConnection::establish(url)?;
    connection.batch_execute(
        "PRAGMA journal_mode = WAL;
         PRAGMA busy_timeout = 30000;",
    )?;
    prepare_legacy_schema_for_baseline(&mut connection)?;
    connection.run_pending_migrations(MIGRATIONS)?;
    let marker = startup_marker(&path);
    let abnormal_shutdown = marker.exists();
    let recovered = recover_interrupted_scan_jobs(&mut connection)?;
    if recovered > 0 {
        tracing::warn!(recovered, "marked interrupted library scans as failed");
    }
    if integrity_check_due(&path, abnormal_shutdown || recovered > 0) {
        check_integrity(&mut connection)?;
        fs::write(integrity_stamp(&path), b"ok\n")?;
    }
    fs::write(&marker, b"running\n")?;

    let manager = ConnectionManager::<SqliteConnection>::new(url);
    let pool = Arc::new(
        r2d2::Pool::builder()
            .max_size(16)
            .connection_customizer(Box::new(ConfigureConnection))
            .build(manager)?,
    );
    Ok(pool)
}

/// Prepares the schema created by the deleted pre-1.0 migration for the
/// idempotent v1 baseline. The baseline then creates every newer table, index,
/// view, and trigger while preserving rows in the overlapping legacy tables.
fn prepare_legacy_schema_for_baseline(connection: &mut SqliteConnection) -> Result<bool, BoxError> {
    let migration_tables = diesel::sql_query(
        "SELECT CAST(COUNT(*) AS BIGINT) AS count FROM sqlite_schema
         WHERE type = 'table' AND name = '__diesel_schema_migrations'",
    )
    .get_result::<CountQueryRow>(connection)?
    .count;
    if migration_tables == 0 {
        return Ok(false);
    }
    let legacy_recorded = diesel::sql_query(format!(
        "SELECT CAST(COUNT(*) AS BIGINT) AS count
         FROM __diesel_schema_migrations
         WHERE version = '{LEGACY_MUSIC_MIGRATION}'"
    ))
    .get_result::<CountQueryRow>(connection)?
    .count
        > 0;
    if !legacy_recorded {
        return Ok(false);
    }

    let token_version_exists = diesel::sql_query(
        "SELECT CAST(COUNT(*) AS BIGINT) AS count
         FROM pragma_table_info('user') WHERE name = 'token_version'",
    )
    .get_result::<CountQueryRow>(connection)?
    .count
        > 0;
    if token_version_exists {
        return Ok(false);
    }

    connection.batch_execute(
        "ALTER TABLE \"user\"
         ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;",
    )?;
    tracing::info!(
        legacy_version = LEGACY_MUSIC_MIGRATION,
        baseline_version = V1_BASELINE_MIGRATION,
        "prepared pre-1.0 database for the v1 baseline migration"
    );
    Ok(true)
}

fn migrate_legacy_database(legacy: &Path, product: &Path) -> Result<bool, std::io::Error> {
    if product.exists() || !legacy.exists() {
        return Ok(false);
    }
    fs::rename(legacy, product)?;
    for suffix in ["-wal", "-shm"] {
        let mut legacy_sidecar = legacy.as_os_str().to_os_string();
        legacy_sidecar.push(suffix);
        let legacy_sidecar = PathBuf::from(legacy_sidecar);
        if legacy_sidecar.exists() {
            let mut product_sidecar = product.as_os_str().to_os_string();
            product_sidecar.push(suffix);
            let product_sidecar = PathBuf::from(product_sidecar);
            fs::rename(legacy_sidecar, product_sidecar)?;
        }
    }
    Ok(true)
}

/// Returns the initialized process-wide database pool.
pub fn connect() -> Result<DbPool, BoxError> {
    match DATABASE_POOL.get_or_init(|| open_pool().map_err(|error| error.to_string())) {
        Ok(pool) => Ok(pool.clone()),
        Err(error) => Err(error.clone().into()),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use diesel::connection::SimpleConnection;
    use diesel::deserialize::QueryableByName;
    use diesel::sqlite::SqliteConnection;
    use diesel::{Connection, RunQueryDsl};

    #[test]
    fn legacy_database_filename_migrates_without_overwriting_product_database() {
        let directory = std::env::temp_dir().join(format!(
            "parson-database-name-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).expect("test directory");
        let legacy = directory.join("music.db");
        let product = directory.join("parson-music.db");
        std::fs::write(&legacy, b"legacy").expect("legacy database");
        std::fs::write(format!("{}-wal", legacy.display()), b"wal").expect("legacy wal");

        assert!(super::migrate_legacy_database(&legacy, &product).expect("migration"));
        assert_eq!(
            std::fs::read(&product).expect("product database"),
            b"legacy"
        );
        assert!(PathBuf::from(format!("{}-wal", product.display())).exists());

        std::fs::write(&legacy, b"second").expect("second legacy database");
        assert!(!super::migrate_legacy_database(&legacy, &product).expect("no overwrite"));
        assert_eq!(
            std::fs::read(&product).expect("product database"),
            b"legacy"
        );
        std::fs::remove_dir_all(directory).expect("remove test directory");
    }

    use super::{
        LEGACY_MUSIC_MIGRATION, MIGRATIONS, V1_BASELINE_MIGRATION, catalog_fingerprint,
        check_integrity, create_verified_snapshot, prepare_legacy_schema_for_baseline,
        recover_interrupted_scan_jobs, snapshot_files,
    };
    use diesel_migrations::MigrationHarness;

    #[test]
    fn integrity_check_accepts_a_healthy_database() {
        let mut connection = diesel::sqlite::SqliteConnection::establish(":memory:")
            .expect("in-memory sqlite connection");
        check_integrity(&mut connection).expect("healthy database");
    }

    #[test]
    fn legacy_database_is_upgraded_by_the_idempotent_baseline() {
        let mut connection = SqliteConnection::establish(":memory:").expect("migration database");
        connection
            .batch_execute(&format!(
                "CREATE TABLE __diesel_schema_migrations (
                    version VARCHAR(50) PRIMARY KEY NOT NULL,
                    run_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT INTO __diesel_schema_migrations (version)
                 VALUES ('{LEGACY_MUSIC_MIGRATION}');
                 CREATE TABLE \"user\" (
                    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    name TEXT,
                    username TEXT NOT NULL UNIQUE,
                    password TEXT NOT NULL,
                    image TEXT,
                    bitrate INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    now_playing TEXT,
                    role TEXT NOT NULL DEFAULT 'user'
                 );
                 INSERT INTO \"user\" (username, password, role)
                 VALUES ('legacy-admin', 'preserved-hash', 'admin');
                 CREATE TABLE listen_history_item (
                    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    song_id TEXT NOT NULL,
                    listened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE INDEX idx_listen_history_user
                 ON listen_history_item(user_id);"
            ))
            .expect("legacy database fixture");

        assert!(
            prepare_legacy_schema_for_baseline(&mut connection).expect("prepare legacy schema")
        );
        connection
            .run_pending_migrations(MIGRATIONS)
            .expect("apply idempotent baseline");

        let adopted = diesel::sql_query(format!(
            "SELECT COUNT(*) AS count FROM __diesel_schema_migrations
             WHERE version = '{V1_BASELINE_MIGRATION}'"
        ))
        .get_result::<CountRow>(&mut connection)
        .expect("adopted migration count")
        .count;
        assert_eq!(adopted, 1);
        let token_version = diesel::sql_query(
            "SELECT CAST(token_version AS TEXT) AS value
             FROM \"user\" WHERE username = 'legacy-admin'",
        )
        .get_result::<TextRow>(&mut connection)
        .expect("preserved legacy account");
        assert_eq!(token_version.value, "0");
        let new_schema = diesel::sql_query(
            "SELECT COUNT(*) AS count FROM sqlite_schema
             WHERE type = 'table' AND name IN ('library_root', 'file_entry', 'playback_event')",
        )
        .get_result::<CountRow>(&mut connection)
        .expect("new baseline tables")
        .count;
        assert_eq!(new_schema, 3);
        assert!(
            !prepare_legacy_schema_for_baseline(&mut connection)
                .expect("legacy preparation is idempotent")
        );
    }

    #[test]
    fn catalog_fingerprint_changes_only_with_catalog_state() {
        let mut connection = SqliteConnection::establish(":memory:").expect("fingerprint database");
        connection
            .batch_execute(
                "CREATE TABLE file_entry (
                    id INTEGER PRIMARY KEY, path TEXT NOT NULL, size_bytes INTEGER NOT NULL,
                    modified_at_ns INTEGER NOT NULL, availability TEXT NOT NULL
                 );
                 CREATE TABLE raw_file_metadata (
                    file_id INTEGER PRIMARY KEY, title TEXT, album TEXT,
                    track_artists_json TEXT, album_artists_json TEXT, genres_json TEXT,
                    release_date TEXT, cover_url TEXT, parser_version TEXT,
                    track_number INTEGER, disc_number INTEGER, duration_seconds REAL,
                    musicbrainz_recording_id TEXT, musicbrainz_release_id TEXT,
                    musicbrainz_artist_id TEXT, musicbrainz_album_artist_id TEXT, error TEXT
                 );
                 CREATE TABLE library_scan_job (id INTEGER PRIMARY KEY, message TEXT);
                 INSERT INTO file_entry VALUES (1, '/music/song.flac', 100, 200, 'available');
                 INSERT INTO raw_file_metadata VALUES
                    (1, 'Song', 'Album', '[\"Artist\"]', '[\"Artist\"]', '[\"Rock\"]',
                     '2026', '/covers/album.jpg', '11', 1, 1, 180.0, '', '', '', '', NULL);",
            )
            .expect("fingerprint schema");

        let initial = catalog_fingerprint(&mut connection).expect("initial fingerprint");
        diesel::sql_query("INSERT INTO library_scan_job (message) VALUES ('completed')")
            .execute(&mut connection)
            .expect("scan bookkeeping");
        assert_eq!(
            catalog_fingerprint(&mut connection).expect("bookkeeping fingerprint"),
            initial
        );

        diesel::sql_query("UPDATE raw_file_metadata SET title = 'Changed' WHERE file_id = 1")
            .execute(&mut connection)
            .expect("catalog change");
        assert_ne!(
            catalog_fingerprint(&mut connection).expect("changed fingerprint"),
            initial
        );
    }

    #[test]
    fn migration_baseline_reverts_and_reapplies_cleanly() {
        let mut connection = SqliteConnection::establish(":memory:").expect("migration database");
        connection
            .run_pending_migrations(MIGRATIONS)
            .expect("apply baseline");
        connection
            .revert_all_migrations(MIGRATIONS)
            .expect("revert baseline");

        let remaining = diesel::sql_query(
            "SELECT COUNT(*) AS count FROM sqlite_schema
             WHERE name NOT LIKE 'sqlite_%' AND name <> '__diesel_schema_migrations'",
        )
        .get_result::<CountRow>(&mut connection)
        .expect("count remaining schema objects")
        .count;
        assert_eq!(remaining, 0);

        connection
            .run_pending_migrations(MIGRATIONS)
            .expect("reapply baseline");
    }

    #[test]
    fn fresh_migrations_install_and_maintain_storage_bounds() {
        #[derive(QueryableByName)]
        struct PlaylistStatsRow {
            #[diesel(sql_type = diesel::sql_types::BigInt)]
            song_count: i64,
            #[diesel(sql_type = diesel::sql_types::Double)]
            total_duration: f64,
        }

        let mut connection = SqliteConnection::establish(":memory:").expect("migration database");
        connection
            .run_pending_migrations(MIGRATIONS)
            .expect("fresh migration set");
        connection
            .batch_execute(
                "INSERT INTO user(username, password) VALUES ('scale-user', 'hash');
                 INSERT INTO playlist(id, name) VALUES (1, 'Scale playlist');
                 INSERT INTO song(id) VALUES ('scale-song');
                 INSERT INTO track_entity(id, title, normalized_title, duration_seconds)
                   VALUES ('scale-song', 'Scale song', 'scale song', 123.5);
                 INSERT INTO _playlist_to_song(a, b) VALUES (1, 'scale-song');",
            )
            .expect("trigger fixture");
        let duplicate = connection
            .batch_execute("INSERT INTO _playlist_to_song(a, b) VALUES (1, 'scale-song');");
        assert!(duplicate.is_err(), "playlist tracks must remain unique");
        let stats = diesel::sql_query(
            "SELECT CAST(song_count AS BIGINT) AS song_count, total_duration
             FROM playlist_stats WHERE playlist_id = 1",
        )
        .get_result::<PlaylistStatsRow>(&mut connection)
        .expect("write-time playlist stats");
        assert_eq!(stats.song_count, 1);
        assert_eq!(stats.total_duration, 123.5);

        let position = diesel::sql_query(
            "SELECT CAST(position AS TEXT) AS value FROM _playlist_to_song WHERE a = 1",
        )
        .get_result::<TextRow>(&mut connection)
        .expect("explicit playlist position");
        assert!(!position.value.is_empty());

        connection
            .batch_execute(
                "WITH RECURSIVE sequence(value) AS (
                   SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 105
                 )
                 INSERT INTO library_scan_job(status, finished_at)
                 SELECT 'completed', CURRENT_TIMESTAMP FROM sequence;",
            )
            .expect("scan retention fixture");
        let scan_count = diesel::sql_query("SELECT COUNT(*) AS count FROM library_scan_job")
            .get_result::<CountRow>(&mut connection)
            .expect("retained scan count")
            .count;
        assert_eq!(scan_count, 100);
    }

    #[test]
    fn snapshots_are_verified_and_rotated_without_replacing_in_place() {
        let directory = std::env::temp_dir().join(format!(
            "music-database-snapshot-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).expect("test directory");
        let database = directory.join("music.db");
        let mut connection = SqliteConnection::establish(database.to_str().expect("database path"))
            .expect("database connection");
        connection
            .batch_execute(
                "CREATE TABLE marker (value INTEGER NOT NULL); INSERT INTO marker VALUES (1);",
            )
            .expect("database fixture");

        let first =
            create_verified_snapshot(&mut connection, &database, 2).expect("first snapshot");
        connection
            .batch_execute("INSERT INTO marker VALUES (2);")
            .expect("second fixture");
        let second =
            create_verified_snapshot(&mut connection, &database, 2).expect("second snapshot");
        connection
            .batch_execute("INSERT INTO marker VALUES (3);")
            .expect("third fixture");
        let third =
            create_verified_snapshot(&mut connection, &database, 2).expect("third snapshot");

        assert_ne!(first, second);
        assert_ne!(second, third);
        assert!(!first.exists());
        assert!(second.exists());
        assert!(third.exists());
        assert_eq!(
            snapshot_files(&database).expect("snapshot listing").len(),
            2
        );
        let mut latest = SqliteConnection::establish(third.to_str().expect("snapshot path"))
            .expect("snapshot connection");
        let count = diesel::sql_query("SELECT COUNT(*) AS count FROM marker")
            .load::<CountRow>(&mut latest)
            .expect("snapshot query")[0]
            .count;
        assert_eq!(count, 3);
        drop(latest);
        drop(connection);
        std::fs::remove_dir_all(directory).expect("test cleanup");
    }

    #[test]
    fn interrupted_scan_jobs_are_reconciled_without_touching_completed_jobs() {
        let mut connection =
            SqliteConnection::establish(":memory:").expect("in-memory sqlite connection");
        connection
            .batch_execute(
                "CREATE TABLE library_scan_job (
                    id INTEGER PRIMARY KEY,
                    status TEXT NOT NULL,
                    finished_at DATETIME,
                    message TEXT
                );
                INSERT INTO library_scan_job (id, status) VALUES (1, 'running'), (2, 'completed');
                CREATE TEMP TABLE file_metadata_stage (path TEXT);
                INSERT INTO file_metadata_stage VALUES ('partial.mp3');",
            )
            .expect("scan job fixture");
        assert_eq!(
            recover_interrupted_scan_jobs(&mut connection).expect("scan recovery"),
            1
        );
        let statuses =
            diesel::sql_query("SELECT status AS value FROM library_scan_job ORDER BY id")
                .load::<TextRow>(&mut connection)
                .expect("scan statuses")
                .into_iter()
                .map(|row| row.value)
                .collect::<Vec<_>>();
        assert_eq!(statuses, ["failed", "completed"]);
        let staging_tables = diesel::sql_query(
            "SELECT COUNT(*) AS count FROM sqlite_temp_master WHERE name = 'file_metadata_stage'",
        )
        .load::<CountRow>(&mut connection)
        .expect("staging cleanup")[0]
            .count;
        assert_eq!(staging_tables, 0);
    }

    #[test]
    #[ignore = "one-million-row storage access benchmark"]
    fn million_row_user_data_reads_are_index_seeks_and_page_bounded() {
        use std::time::Instant;

        #[derive(QueryableByName)]
        struct PlanRow {
            #[diesel(sql_type = diesel::sql_types::Integer, column_name = id)]
            _id: i32,
            #[diesel(sql_type = diesel::sql_types::Integer, column_name = parent)]
            _parent: i32,
            #[diesel(sql_type = diesel::sql_types::Integer, column_name = notused)]
            _not_used: i32,
            #[diesel(sql_type = diesel::sql_types::Text)]
            detail: String,
        }

        let mut connection = SqliteConnection::establish(":memory:").expect("benchmark database");
        connection
            .batch_execute(
                "PRAGMA journal_mode = MEMORY;
                 PRAGMA synchronous = OFF;
                 CREATE TABLE listen_history_item (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   user_id INTEGER NOT NULL,
                   song_id TEXT NOT NULL,
                   listened_at DATETIME NOT NULL
                 );
                 CREATE INDEX idx_listen_history_user_id_desc
                   ON listen_history_item(user_id, id DESC);
                 CREATE TABLE favorite_song (
                   user_id INTEGER NOT NULL,
                   song_id TEXT NOT NULL,
                   added_at DATETIME NOT NULL,
                   PRIMARY KEY(user_id, song_id)
                 );
                 CREATE INDEX idx_favorite_song_user_added_song
                   ON favorite_song(user_id, added_at DESC, song_id ASC);
                 WITH RECURSIVE sequence(value) AS (
                   SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 1000000
                 )
                 INSERT INTO listen_history_item(user_id, song_id, listened_at)
                 SELECT 1, printf('song-%07d', value), datetime('2020-01-01', '+' || value || ' seconds')
                 FROM sequence;
                 INSERT INTO favorite_song(user_id, song_id, added_at)
                 SELECT user_id, song_id, listened_at FROM listen_history_item;",
            )
            .expect("million-row fixture");

        let history_plan = diesel::sql_query(
            "EXPLAIN QUERY PLAN SELECT song_id FROM listen_history_item
             WHERE user_id = 1 AND id < 500000 ORDER BY id DESC LIMIT 100",
        )
        .load::<PlanRow>(&mut connection)
        .expect("history plan");
        assert!(history_plan.iter().any(|row| {
            row.detail.contains("idx_listen_history_user_id_desc") && row.detail.contains("SEARCH")
        }));

        let favorite_plan = diesel::sql_query(
            "EXPLAIN QUERY PLAN SELECT song_id FROM favorite_song
             WHERE user_id = 1 AND added_at < datetime('2020-01-01', '+500000 seconds')
             ORDER BY added_at DESC, song_id ASC LIMIT 100",
        )
        .load::<PlanRow>(&mut connection)
        .expect("favorite plan");
        assert!(favorite_plan.iter().any(|row| {
            row.detail.contains("idx_favorite_song_user_added_song")
                && row.detail.contains("SEARCH")
        }));

        let started = Instant::now();
        let history = diesel::sql_query(
            "SELECT song_id AS value FROM listen_history_item
             WHERE user_id = 1 AND id < 500000 ORDER BY id DESC LIMIT 100",
        )
        .load::<TextRow>(&mut connection)
        .expect("deep history cursor page");
        let history_elapsed = started.elapsed();
        let started = Instant::now();
        let favorites = diesel::sql_query(
            "SELECT song_id AS value FROM favorite_song
             WHERE user_id = 1 AND added_at < datetime('2020-01-01', '+500000 seconds')
             ORDER BY added_at DESC, song_id ASC LIMIT 100",
        )
        .load::<TextRow>(&mut connection)
        .expect("deep favorites cursor page");
        let favorites_elapsed = started.elapsed();

        assert_eq!(history.len(), 100);
        assert_eq!(favorites.len(), 100);
        eprintln!(
            "million-row cursor pages: history={history_elapsed:?}, favorites={favorites_elapsed:?}"
        );
    }

    #[derive(QueryableByName)]
    struct CountRow {
        #[diesel(sql_type = diesel::sql_types::BigInt)]
        count: i64,
    }

    #[derive(QueryableByName)]
    struct TextRow {
        #[diesel(sql_type = diesel::sql_types::Text)]
        value: String,
    }
}
