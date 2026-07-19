use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;
#[cfg(all(not(windows), not(target_os = "linux")))]
use std::time::UNIX_EPOCH;
use std::time::{Duration, Instant};

use globset::{Glob, GlobSet, GlobSetBuilder};
use jwalk::{Parallelism, WalkDir};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tracing::warn;

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "ogg", "m4a", "opus", "wav", "aiff", "alac"];
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp"];
const DEFAULT_INITIAL_CAPACITY: usize = 4_096;
const DEFAULT_MAX_THREADS: usize = 8;
const DEFAULT_MAX_PENDING_CHANGES: usize = 4_096;
const DEFAULT_RECONCILIATION_HOURS: u64 = 24;

#[derive(Debug, Clone)]
pub(crate) struct DiscoveredFile {
    pub(crate) path: PathBuf,
    pub(crate) directory: PathBuf,
    pub(crate) database_path: String,
    pub(crate) database_directory: String,
    pub(crate) file_name: String,
    pub(crate) extension: String,
    pub(crate) size_bytes: i64,
    pub(crate) modified_at_ns: i64,
    pub(crate) stable_identity: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct DiscoveredImage {
    pub(crate) path: PathBuf,
    pub(crate) size_bytes: i64,
    pub(crate) modified_at_ns: i64,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct FilesystemInventory {
    pub(crate) audio_files: Vec<DiscoveredFile>,
    /// Images indexed by nearby ancestor directories.
    pub(crate) images_by_ancestor: HashMap<PathBuf, Vec<DiscoveredImage>>,
}

#[derive(Debug, Default)]
struct ChangeJournal {
    paths: Vec<PathBuf>,
    overflowed: bool,
    last_change: Option<Instant>,
}

struct RootCache {
    inventory: Option<FilesystemInventory>,
    _watcher: Option<RecommendedWatcher>,
    journal: Arc<Mutex<ChangeJournal>>,
    last_full_reconciliation: Instant,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct PendingChangeStats {
    pub(crate) path_events: usize,
    pub(crate) overflowed: bool,
    pub(crate) last_change: Option<Instant>,
    pub(crate) watcher_active: bool,
}

static DISCOVERY_CACHE: OnceLock<Mutex<HashMap<PathBuf, RootCache>>> = OnceLock::new();

struct DiscoveryOptions {
    skip_hidden: bool,
    skip_system: bool,
    threads: usize,
    initial_capacity: usize,
    stable_identities: bool,
    exclusions: GlobSet,
}

fn env_flag(name: &str, default: bool) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(default)
}

fn options_from_environment() -> DiscoveryOptions {
    let available = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(4);
    let threads = std::env::var("PARSON_SCAN_THREADS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or_else(|| available.min(DEFAULT_MAX_THREADS))
        .clamp(1, 32);
    let initial_capacity = std::env::var("PARSON_SCAN_INITIAL_CAPACITY")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_INITIAL_CAPACITY);
    let mut exclusions = GlobSetBuilder::new();
    if let Ok(patterns) = std::env::var("PARSON_SCAN_EXCLUDED_DIRS") {
        for value in patterns
            .split([';', ','])
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            match Glob::new(value) {
                Ok(pattern) => {
                    exclusions.add(pattern);
                }
                Err(error) => warn!(pattern = value, %error, "ignoring invalid scan exclusion"),
            }
        }
    }
    DiscoveryOptions {
        skip_hidden: env_flag("PARSON_SCAN_SKIP_HIDDEN", true),
        skip_system: env_flag("PARSON_SCAN_SKIP_SYSTEM", true),
        threads,
        initial_capacity,
        // Windows file IDs require opening each file, so keep them opt-in.
        stable_identities: env_flag("PARSON_SCAN_STABLE_IDENTITIES", !cfg!(windows)),
        exclusions: exclusions.build().expect("all scan globs were validated"),
    }
}

fn database_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn is_relevant_change_path(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    extension.as_deref().is_none_or(|value| value.is_empty())
        || extension.as_deref().is_some_and(|value| {
            AUDIO_EXTENSIONS.contains(&value) || IMAGE_EXTENSIONS.contains(&value)
        })
        || path.is_dir()
}

#[cfg(all(unix, not(target_os = "linux")))]
fn stable_file_identity(_path: &Path, metadata: &std::fs::Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    Some(format!("unix:{}:{}", metadata.dev(), metadata.ino()))
}

#[cfg(windows)]
fn windows_file_information(
    path: &Path,
) -> Option<windows_sys::Win32::Storage::FileSystem::BY_HANDLE_FILE_INFORMATION> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_READ_ATTRIBUTES,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, GetFileInformationByHandle,
        OPEN_EXISTING,
    };

    let wide_path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    // SAFETY: `wide_path` is NUL-terminated and all optional handle/security
    // arguments are null. The returned handle is closed on every success path.
    let handle = unsafe {
        CreateFileW(
            wide_path.as_ptr(),
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return None;
    }
    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: `handle` is valid and `information` points to writable storage.
    let succeeded = unsafe { GetFileInformationByHandle(handle, &mut information) } != 0;
    // SAFETY: this function owns the valid handle returned by `CreateFileW`.
    unsafe { CloseHandle(handle) };
    succeeded.then_some(information)
}

#[cfg(not(any(unix, windows)))]
fn stable_file_identity(_path: &Path, _metadata: &std::fs::Metadata) -> Option<String> {
    None
}

struct FileFacts {
    size_bytes: i64,
    modified_at_ns: i64,
    stable_identity: Option<String>,
}

#[cfg(windows)]
fn file_facts(
    entry: &jwalk::DirEntry<((), ())>,
    path: &Path,
    is_audio: bool,
    skip_hidden: bool,
    skip_system: bool,
    stable_identities: bool,
) -> Option<FileFacts> {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    const REPARSE_POINT: u32 = 0x400;
    const WINDOWS_TO_UNIX_EPOCH_100NS: u64 = 116_444_736_000_000_000;
    let metadata = entry.metadata().ok()?;
    let attributes = metadata.file_attributes();
    if attributes & REPARSE_POINT != 0
        || skip_hidden && attributes & HIDDEN != 0
        || skip_system && attributes & SYSTEM != 0
    {
        return None;
    }
    let size = metadata.file_size();
    let modified_100ns = metadata.last_write_time();
    let modified_at_ns = modified_100ns
        .saturating_sub(WINDOWS_TO_UNIX_EPOCH_100NS)
        .saturating_mul(100)
        .min(i64::MAX as u64) as i64;
    let stable_identity = (is_audio && stable_identities)
        .then(|| windows_file_information(path))
        .flatten()
        .map(|information| {
            let file_index = (u64::from(information.nFileIndexHigh) << 32)
                | u64::from(information.nFileIndexLow);
            format!("windows:{}:{file_index}", information.dwVolumeSerialNumber)
        });
    Some(FileFacts {
        size_bytes: size.min(i64::MAX as u64) as i64,
        modified_at_ns,
        stable_identity,
    })
}

#[cfg(target_os = "linux")]
fn file_facts(
    _entry: &jwalk::DirEntry<((), ())>,
    path: &Path,
    is_audio: bool,
    _skip_hidden: bool,
    _skip_system: bool,
    stable_identities: bool,
) -> Option<FileFacts> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let path = CString::new(path.as_os_str().as_bytes()).ok()?;
    // SAFETY: `facts` is writable for the duration of `statx`, and `path` is
    // NUL-terminated. The walker already rejects symlinks; AT_SYMLINK_NOFOLLOW
    // preserves that rule if the namespace changes concurrently.
    let mut facts = unsafe { std::mem::zeroed::<libc::statx>() };
    let result = unsafe {
        libc::statx(
            libc::AT_FDCWD,
            path.as_ptr(),
            libc::AT_SYMLINK_NOFOLLOW | libc::AT_STATX_SYNC_AS_STAT,
            libc::STATX_BASIC_STATS,
            &mut facts,
        )
    };
    if result != 0 {
        return None;
    }
    let modified_at_ns = facts
        .stx_mtime
        .tv_sec
        .saturating_mul(1_000_000_000)
        .saturating_add(i64::from(facts.stx_mtime.tv_nsec));
    let stable_identity = (is_audio && stable_identities).then(|| {
        let device = libc::makedev(facts.stx_dev_major, facts.stx_dev_minor);
        format!("unix:{device}:{}", facts.stx_ino)
    });
    Some(FileFacts {
        size_bytes: facts.stx_size.min(i64::MAX as u64) as i64,
        modified_at_ns,
        stable_identity,
    })
}

#[cfg(all(not(windows), not(target_os = "linux")))]
fn file_facts(
    entry: &jwalk::DirEntry<((), ())>,
    path: &Path,
    is_audio: bool,
    skip_hidden: bool,
    skip_system: bool,
    _stable_identities: bool,
) -> Option<FileFacts> {
    let metadata = entry.metadata().ok()?;
    if metadata_has_skipped_attributes(&metadata, skip_hidden, skip_system) {
        return None;
    }
    let modified_at_ns = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| {
            duration.as_secs() as i64 * 1_000_000_000 + i64::from(duration.subsec_nanos())
        })
        .unwrap_or_default();
    Some(FileFacts {
        size_bytes: metadata.len().min(i64::MAX as u64) as i64,
        modified_at_ns,
        stable_identity: is_audio
            .then(|| stable_file_identity(path, &metadata))
            .flatten(),
    })
}

#[cfg(windows)]
fn has_skipped_attributes(
    entry: &jwalk::DirEntry<((), ())>,
    skip_hidden: bool,
    skip_system: bool,
) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    const REPARSE_POINT: u32 = 0x400;
    entry.metadata().is_ok_and(|metadata| {
        let attributes = metadata.file_attributes();
        attributes & REPARSE_POINT != 0
            || skip_hidden && attributes & HIDDEN != 0
            || skip_system && attributes & SYSTEM != 0
    })
}

#[cfg(not(windows))]
fn has_skipped_attributes(
    _entry: &jwalk::DirEntry<((), ())>,
    _skip_hidden: bool,
    _skip_system: bool,
) -> bool {
    false
}

fn is_excluded_directory(
    exclusions: &GlobSet,
    relative: &Path,
    file_name: &std::ffi::OsStr,
) -> bool {
    exclusions.is_match(relative)
        || exclusions.is_match(file_name)
        // Match a synthetic descendant for patterns ending in `/**`.
        || exclusions.is_match(relative.join("__music_scan_descendant__"))
}

#[cfg(all(not(windows), not(target_os = "linux")))]
fn metadata_has_skipped_attributes(
    _metadata: &std::fs::Metadata,
    _skip_hidden: bool,
    _skip_system: bool,
) -> bool {
    false
}

fn discover_scope(
    library_root: &Path,
    scan_root: &Path,
    mut on_audio: Option<&mut dyn FnMut(&DiscoveredFile)>,
) -> FilesystemInventory {
    let options = options_from_environment();
    let exclusion_root = library_root.to_path_buf();
    let exclusions = options.exclusions;
    let skip_hidden = options.skip_hidden;
    let skip_system = options.skip_system;
    let parallelism = if scan_root.is_file() {
        Parallelism::Serial
    } else {
        Parallelism::RayonNewPool(options.threads)
    };
    let walk = WalkDir::new(scan_root)
        .follow_links(false)
        .skip_hidden(skip_hidden)
        .parallelism(parallelism)
        .process_read_dir(move |_depth, _directory, _state, children| {
            children.retain(|result| {
                let Ok(entry) = result else { return true };
                if entry.file_type().is_symlink() {
                    return false;
                }
                if !entry.file_type().is_dir() {
                    return true;
                }
                if has_skipped_attributes(entry, skip_hidden, skip_system) {
                    return false;
                }
                let entry_path = entry.path();
                let relative = entry_path
                    .strip_prefix(&exclusion_root)
                    .unwrap_or(entry_path.as_path());
                !is_excluded_directory(&exclusions, relative, entry.file_name())
            });
        });

    let mut inventory = FilesystemInventory {
        audio_files: Vec::with_capacity(if scan_root == library_root {
            options.initial_capacity
        } else {
            options.initial_capacity.min(256)
        }),
        images_by_ancestor: HashMap::new(),
    };
    for entry in walk.into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
            continue;
        };
        let extension = extension.to_ascii_lowercase();
        let is_audio = AUDIO_EXTENSIONS.contains(&extension.as_str());
        let is_image = IMAGE_EXTENSIONS.contains(&extension.as_str());
        if !is_audio && !is_image {
            continue;
        }
        let Some(facts) = file_facts(
            &entry,
            &path,
            is_audio,
            skip_hidden,
            skip_system,
            options.stable_identities,
        ) else {
            continue;
        };
        if is_image {
            let image = DiscoveredImage {
                path: path.clone(),
                size_bytes: facts.size_bytes,
                modified_at_ns: facts.modified_at_ns,
            };
            let mut ancestor = path.parent();
            for _ in 0..=3 {
                let Some(directory) = ancestor else { break };
                if !directory.starts_with(library_root) {
                    break;
                }
                inventory
                    .images_by_ancestor
                    .entry(directory.to_path_buf())
                    .or_default()
                    .push(image.clone());
                ancestor = directory.parent();
            }
            continue;
        }
        let directory = path.parent().unwrap_or(library_root).to_path_buf();
        let discovered = DiscoveredFile {
            database_path: database_path(&path),
            database_directory: database_path(&directory),
            file_name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_owned(),
            path,
            directory,
            extension,
            size_bytes: facts.size_bytes,
            modified_at_ns: facts.modified_at_ns,
            stable_identity: facts.stable_identity,
        };
        if let Some(callback) = on_audio.as_deref_mut() {
            callback(&discovered);
        }
        inventory.audio_files.push(discovered);
    }
    // Restore path locality after jwalk's parallel completion order.
    inventory
        .audio_files
        .sort_unstable_by(|left, right| left.path.cmp(&right.path));
    for images in inventory.images_by_ancestor.values_mut() {
        images.sort_unstable_by(|left, right| left.path.cmp(&right.path));
    }
    inventory
}

pub(crate) fn discover(root: &Path) -> FilesystemInventory {
    discover_scope(root, root, None)
}

fn max_pending_changes() -> usize {
    std::env::var("PARSON_SCAN_MAX_PENDING_CHANGES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_MAX_PENDING_CHANGES)
        .max(1)
}

fn reconciliation_interval() -> Duration {
    let hours = std::env::var("PARSON_SCAN_RECONCILIATION_HOURS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_RECONCILIATION_HOURS);
    Duration::from_secs(hours.saturating_mul(60 * 60))
}

fn start_watcher(root: &Path, journal: Arc<Mutex<ChangeJournal>>) -> Option<RecommendedWatcher> {
    let watched_root = root.to_path_buf();
    let limit = max_pending_changes();
    let callback_journal = Arc::clone(&journal);
    let mut watcher = match notify::recommended_watcher(
        move |result: notify::Result<notify::Event>| {
            let mut journal = callback_journal
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            match result {
                Ok(event) if !matches!(event.kind, EventKind::Access(_)) => {
                    for path in event.paths {
                        let path = if path.is_absolute() {
                            path
                        } else {
                            watched_root.join(path)
                        };
                        if !is_relevant_change_path(&path) {
                            continue;
                        }
                        journal.last_change = Some(Instant::now());
                        if journal.paths.len() >= limit {
                            journal.paths.clear();
                            journal.overflowed = true;
                            break;
                        }
                        journal.paths.push(path);
                    }
                }
                Ok(_) => {}
                Err(error) => {
                    journal.paths.clear();
                    journal.overflowed = true;
                    journal.last_change = Some(Instant::now());
                    warn!(%error, "filesystem notification journal overflowed");
                }
            }
        },
    ) {
        Ok(watcher) => watcher,
        Err(error) => {
            warn!(root = %root.display(), %error, "filesystem notifications unavailable; using full reconciliation");
            return None;
        }
    };
    if let Err(error) = watcher.watch(root, RecursiveMode::Recursive) {
        warn!(root = %root.display(), %error, "could not watch library; using full reconciliation");
        return None;
    }
    Some(watcher)
}

fn drain_journal(journal: &Mutex<ChangeJournal>) -> (Vec<PathBuf>, bool) {
    let mut journal = journal
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let paths = std::mem::take(&mut journal.paths);
    let overflowed = std::mem::take(&mut journal.overflowed);
    journal.last_change = None;
    (paths, overflowed)
}

/// Starts the native recursive watcher without walking the library.
pub(crate) fn ensure_incremental_watcher(root: &Path) -> bool {
    let root = root.to_path_buf();
    let caches = DISCOVERY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut caches = caches
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let cache = caches.entry(root.clone()).or_insert_with(|| {
        let journal = Arc::new(Mutex::new(ChangeJournal::default()));
        let watcher = start_watcher(&root, Arc::clone(&journal));
        RootCache {
            inventory: None,
            _watcher: watcher,
            journal,
            last_full_reconciliation: Instant::now(),
        }
    });
    cache._watcher.is_some()
}

pub(crate) fn pending_change_stats(root: &Path) -> Option<PendingChangeStats> {
    let caches = DISCOVERY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let caches = caches
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let cache = caches.get(root)?;
    let journal = cache
        .journal
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Some(PendingChangeStats {
        path_events: journal.paths.len(),
        overflowed: journal.overflowed,
        last_change: journal.last_change,
        watcher_active: cache._watcher.is_some(),
    })
}

pub(crate) fn youngest_pending_new_audio_age(root: &Path) -> Option<Duration> {
    let caches = DISCOVERY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let caches = caches
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let cache = caches.get(root)?;
    let journal = cache
        .journal
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let inventory = cache.inventory.as_ref();
    let now = SystemTime::now();
    journal
        .paths
        .iter()
        .filter(|path| {
            path.extension()
                .and_then(|value| value.to_str())
                .map(str::to_ascii_lowercase)
                .is_some_and(|extension| AUDIO_EXTENSIONS.contains(&extension.as_str()))
        })
        .filter(|path| {
            inventory.is_none_or(|inventory| {
                inventory
                    .audio_files
                    .binary_search_by(|file| file.path.cmp(path))
                    .is_err()
            })
        })
        .filter_map(|path| std::fs::metadata(path).ok())
        .filter_map(|metadata| metadata.modified().ok())
        .map(|modified| now.duration_since(modified).unwrap_or_default())
        .min()
}

fn affected_scopes(root: &Path, paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut scopes = paths
        .into_iter()
        .filter(|path| path.starts_with(root))
        .filter_map(|path| {
            if path.exists() {
                Some(path)
            } else {
                path.parent().map(Path::to_path_buf)
            }
        })
        .filter(|path| path.starts_with(root))
        .collect::<Vec<_>>();
    scopes.sort_by_key(|path| path.components().count());
    let mut minimal = Vec::<PathBuf>::with_capacity(scopes.len());
    for scope in scopes {
        if !minimal.iter().any(|parent| scope.starts_with(parent)) {
            minimal.push(scope);
        }
    }
    minimal
}

fn update_scopes(inventory: &mut FilesystemInventory, root: &Path, scopes: &[PathBuf]) {
    if scopes.is_empty() {
        return;
    }
    let is_affected = |path: &Path| scopes.iter().any(|scope| path.starts_with(scope));
    inventory
        .audio_files
        .retain(|file| !is_affected(&file.path));
    inventory.images_by_ancestor.retain(|_, images| {
        images.retain(|image| !is_affected(&image.path));
        !images.is_empty()
    });

    for scope in scopes.iter().filter(|scope| scope.exists()) {
        let partial = discover_scope(root, scope, None);
        inventory.audio_files.extend(partial.audio_files);
        for (ancestor, images) in partial.images_by_ancestor {
            inventory
                .images_by_ancestor
                .entry(ancestor)
                .or_default()
                .extend(images);
        }
    }
    inventory
        .audio_files
        .sort_unstable_by(|left, right| left.path.cmp(&right.path));
    inventory
        .audio_files
        .dedup_by(|left, right| left.path == right.path);
    for images in inventory.images_by_ancestor.values_mut() {
        images.sort_unstable_by(|left, right| left.path.cmp(&right.path));
        images.dedup_by(|left, right| left.path == right.path);
    }
}

/// Returns the cached inventory, reconciling it when required.
fn discover_incremental_inner(
    root: &Path,
    on_initial_audio: Option<&mut dyn FnMut(&DiscoveredFile)>,
) -> (FilesystemInventory, bool) {
    let root = root.to_path_buf();
    let caches = DISCOVERY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut caches = caches
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    if !caches.contains_key(&root) {
        let journal = Arc::new(Mutex::new(ChangeJournal::default()));
        let watcher = start_watcher(&root, Arc::clone(&journal));
        let cache = RootCache {
            inventory: None,
            _watcher: watcher,
            journal,
            last_full_reconciliation: Instant::now(),
        };
        caches.insert(root.clone(), cache);
    }

    let cache = caches
        .get_mut(&root)
        .expect("cache existence established above");
    if cache.inventory.is_none() {
        cache.inventory = Some(discover_scope(&root, &root, on_initial_audio));
        // Reconcile, but do not stream, changes reported during the initial walk.
        let (paths, _) = drain_journal(&cache.journal);
        let scopes = affected_scopes(&root, paths);
        let inventory = cache
            .inventory
            .as_mut()
            .expect("initial inventory populated");
        update_scopes(inventory, &root, &scopes);
        return (inventory.clone(), true);
    }

    let (paths, overflowed) = drain_journal(&cache.journal);
    let reconciliation_due = cache.last_full_reconciliation.elapsed() >= reconciliation_interval();
    if overflowed || reconciliation_due || cache._watcher.is_none() {
        cache.inventory = Some(discover(&root));
        cache.last_full_reconciliation = Instant::now();
    } else {
        let scopes = affected_scopes(&root, paths);
        update_scopes(
            cache
                .inventory
                .as_mut()
                .expect("non-initial cache has an inventory"),
            &root,
            &scopes,
        );
    }
    (
        cache
            .inventory
            .as_ref()
            .expect("incremental inventory populated")
            .clone(),
        false,
    )
}

pub(crate) fn discover_incremental(root: &Path) -> FilesystemInventory {
    discover_incremental_inner(root, None).0
}

/// Streams audio files while constructing an initial inventory.
pub(crate) fn discover_incremental_streaming(
    root: &Path,
    on_initial_audio: &mut dyn FnMut(&DiscoveredFile),
) -> (FilesystemInventory, bool) {
    discover_incremental_inner(root, Some(on_initial_audio))
}

/// Forces filesystem reconciliation and refreshes the notification cache.
pub(crate) fn reconcile(root: &Path) -> FilesystemInventory {
    let root = root.to_path_buf();
    let caches = DISCOVERY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut caches = caches
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(cache) = caches.get_mut(&root) {
        let _ = drain_journal(&cache.journal);
        cache.inventory = Some(discover(&root));
        cache.last_full_reconciliation = Instant::now();
        return cache
            .inventory
            .as_ref()
            .expect("reconciled inventory populated")
            .clone();
    }

    let journal = Arc::new(Mutex::new(ChangeJournal::default()));
    let watcher = start_watcher(&root, Arc::clone(&journal));
    let inventory = discover(&root);
    caches.insert(
        root,
        RootCache {
            inventory: Some(inventory.clone()),
            _watcher: watcher,
            journal,
            last_full_reconciliation: Instant::now(),
        },
    );
    inventory
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_paths_are_normalized_once() {
        assert_eq!(
            database_path(Path::new(r"C:\Music\Album\song.flac")),
            "C:/Music/Album/song.flac"
        );
    }

    #[test]
    fn excluded_directory_globs_prune_the_directory_itself() {
        let mut builder = GlobSetBuilder::new();
        builder.add(Glob::new("**/.cache/**").expect("valid exclusion"));
        builder.add(Glob::new("System Volume Information").expect("valid exclusion"));
        let exclusions = builder.build().expect("exclusion set");

        assert!(is_excluded_directory(
            &exclusions,
            Path::new("Artist/.cache"),
            std::ffi::OsStr::new(".cache")
        ));
        assert!(is_excluded_directory(
            &exclusions,
            Path::new("System Volume Information"),
            std::ffi::OsStr::new("System Volume Information")
        ));
        assert!(!is_excluded_directory(
            &exclusions,
            Path::new("Artist/Album"),
            std::ffi::OsStr::new("Album")
        ));
    }

    #[test]
    fn one_walk_collects_audio_and_nearby_images_as_native_paths() {
        let root = std::env::temp_dir().join(format!("music-discovery-{}", uuid::Uuid::new_v4()));
        let album = root.join("Artist").join("Album");
        let artwork = album.join("artwork");
        std::fs::create_dir_all(&artwork).expect("create discovery fixture");
        let audio = album.join("track.flac");
        let cover = artwork.join("front.jpg");
        std::fs::write(&audio, []).expect("write audio fixture");
        std::fs::write(&cover, []).expect("write image fixture");

        let inventory = discover(&root);
        assert_eq!(inventory.audio_files.len(), 1);
        assert_eq!(inventory.audio_files[0].path, audio);
        assert_eq!(inventory.audio_files[0].directory, album);
        assert!(
            inventory.images_by_ancestor[&album]
                .iter()
                .any(|image| image.path == cover)
        );

        std::fs::remove_dir_all(root).expect("remove discovery fixture");
    }

    #[test]
    fn hidden_files_and_symlinks_are_not_discovered_by_default() {
        let root = std::env::temp_dir().join(format!("music-discovery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create discovery fixture");
        std::fs::write(root.join("visible.flac"), []).expect("write visible fixture");
        std::fs::write(root.join(".hidden.flac"), []).expect("write hidden fixture");
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("visible.flac"), root.join("linked.flac"))
            .expect("create symlink fixture");

        let inventory = discover(&root);
        assert_eq!(inventory.audio_files.len(), 1);
        assert_eq!(inventory.audio_files[0].file_name, "visible.flac");

        std::fs::remove_dir_all(root).expect("remove discovery fixture");
    }

    #[test]
    fn changed_scope_updates_cached_inventory_without_a_full_walk() {
        let root = std::env::temp_dir().join(format!("music-discovery-{}", uuid::Uuid::new_v4()));
        let album = root.join("Artist").join("Album");
        std::fs::create_dir_all(&album).expect("create discovery fixture");
        std::fs::write(album.join("one.flac"), []).expect("write first fixture");
        let mut inventory = discover(&root);
        std::fs::write(album.join("two.flac"), []).expect("write second fixture");

        update_scopes(&mut inventory, &root, std::slice::from_ref(&album));
        assert_eq!(inventory.audio_files.len(), 2);

        std::fs::remove_dir_all(root).expect("remove discovery fixture");
    }

    #[test]
    fn watcher_starts_without_walking_and_first_change_seeds_incremental_inventory() {
        let root = std::env::temp_dir().join(format!("music-discovery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create discovery fixture");
        let watcher_active = ensure_incremental_watcher(&root);
        let caches = DISCOVERY_CACHE.get().expect("discovery cache");
        assert!(
            caches
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .get(&root)
                .expect("watched root")
                .inventory
                .is_none()
        );

        std::fs::write(root.join("new.flac"), []).expect("write changed audio fixture");
        if watcher_active {
            for _ in 0..40 {
                if pending_change_stats(&root).is_some_and(|stats| stats.last_change.is_some()) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            let pending = pending_change_stats(&root).expect("pending watcher stats");
            assert!(pending.path_events > 0);
            assert!(pending.last_change.is_some());
            assert!(youngest_pending_new_audio_age(&root).is_some());
        }

        let inventory = discover_incremental(&root);
        assert_eq!(inventory.audio_files.len(), 1);
        assert!(
            pending_change_stats(&root)
                .expect("drained watcher stats")
                .last_change
                .is_none()
        );
        assert!(youngest_pending_new_audio_age(&root).is_none());
        caches
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&root);
        std::fs::remove_dir_all(root).expect("remove discovery fixture");
    }

    #[test]
    fn watcher_ignores_unrelated_sidecars_but_keeps_catalog_and_art_changes() {
        assert!(!is_relevant_change_path(Path::new("Album/copy.part")));
        assert!(!is_relevant_change_path(Path::new("Album/notes.txt")));
        assert!(is_relevant_change_path(Path::new("Album/song.FLAC")));
        assert!(is_relevant_change_path(Path::new("Album/cover.JpG")));
        assert!(is_relevant_change_path(Path::new("Album")));
    }

    #[test]
    fn streaming_callback_runs_once_only_for_the_initial_walk() {
        let root = std::env::temp_dir().join(format!("music-discovery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create discovery fixture");
        std::fs::write(root.join("one.flac"), []).expect("write first fixture");
        std::fs::write(root.join("two.mp3"), []).expect("write second fixture");

        let mut first_paths = Vec::new();
        let (initial, was_initial) = discover_incremental_streaming(&root, &mut |file| {
            first_paths.push(file.path.clone());
        });
        assert!(was_initial);
        assert_eq!(initial.audio_files.len(), 2);
        first_paths.sort_unstable();
        let mut inventory_paths = initial
            .audio_files
            .iter()
            .map(|file| file.path.clone())
            .collect::<Vec<_>>();
        inventory_paths.sort_unstable();
        assert_eq!(first_paths, inventory_paths);

        let mut cached_callbacks = 0;
        let (cached, was_initial) = discover_incremental_streaming(&root, &mut |_| {
            cached_callbacks += 1;
        });
        assert!(!was_initial);
        assert_eq!(cached_callbacks, 0);
        assert_eq!(cached.audio_files.len(), 2);

        DISCOVERY_CACHE
            .get()
            .expect("discovery cache")
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&root);
        std::fs::remove_dir_all(root).expect("remove discovery fixture");
    }

    #[test]
    fn journal_overflow_forces_full_reconciliation() {
        let root = std::env::temp_dir().join(format!("music-discovery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create discovery fixture");
        std::fs::write(root.join("one.flac"), []).expect("write discovery fixture");
        let _ = discover_incremental(&root);
        let caches = DISCOVERY_CACHE.get().expect("discovery cache");
        {
            let mut caches = caches.lock().unwrap_or_else(|error| error.into_inner());
            let cache = caches.get_mut(&root).expect("root cache");
            cache.last_full_reconciliation = Instant::now() - Duration::from_secs(60);
            cache
                .journal
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .overflowed = true;
        }
        let previous = caches
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(&root)
            .expect("root cache")
            .last_full_reconciliation;

        let _ = discover_incremental(&root);
        let reconciled = caches
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(&root)
            .expect("root cache")
            .last_full_reconciliation;
        assert!(reconciled > previous);

        caches
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&root);
        std::fs::remove_dir_all(root).expect("remove discovery fixture");
    }

    #[test]
    fn filesystem_notification_updates_the_cached_scope() {
        if reconciliation_interval().is_zero() {
            return;
        }
        let root = std::env::temp_dir().join(format!("music-discovery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create discovery fixture");
        std::fs::write(root.join("one.flac"), []).expect("write first fixture");
        let initial = discover_incremental(&root);
        assert_eq!(initial.audio_files.len(), 1);

        let caches = DISCOVERY_CACHE.get().expect("discovery cache");
        let (watcher_active, previous_reconciliation) = {
            let caches = caches.lock().unwrap_or_else(|error| error.into_inner());
            let cache = caches.get(&root).expect("root cache");
            (cache._watcher.is_some(), cache.last_full_reconciliation)
        };
        if !watcher_active {
            caches
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .remove(&root);
            std::fs::remove_dir_all(root).expect("remove discovery fixture");
            return;
        }

        std::fs::write(root.join("two.flac"), []).expect("write second fixture");
        let mut updated = initial;
        for _ in 0..40 {
            std::thread::sleep(Duration::from_millis(25));
            updated = discover_incremental(&root);
            if updated.audio_files.len() == 2 {
                break;
            }
        }
        assert_eq!(updated.audio_files.len(), 2);
        let current_reconciliation = caches
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(&root)
            .expect("root cache")
            .last_full_reconciliation;
        assert_eq!(current_reconciliation, previous_reconciliation);

        caches
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&root);
        std::fs::remove_dir_all(root).expect("remove discovery fixture");
    }
}
