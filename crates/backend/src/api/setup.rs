use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use actix_web::{HttpRequest, HttpResponse, web};
use diesel::{QueryDsl, RunQueryDsl};
use serde::Serialize;

use crate::api::auth::{current_session_claims, request_has_current_admin};
use crate::api::error::{forbidden, internal_server_error, service_unavailable};
use crate::api::{filesystem, library};
use crate::library::state::{LibraryLifecycle, LibraryReadinessState};
use crate::persistence::connection::DbPool;

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "ogg", "m4a", "opus", "wav", "aiff", "alac"];
const MAX_SUGGESTION_CANDIDATES: usize = 24;
#[cfg(unix)]
const MAX_MOUNT_ENTRIES: usize = 64;
const MAX_PROBE_ENTRIES: usize = 20_000;
const MAX_PROBE_TRACKS: usize = 100_000;
const MAX_PROBE_TIME: Duration = Duration::from_millis(250);
const MAX_DISCOVERY_TIME: Duration = Duration::from_millis(1_500);

#[derive(Debug, Serialize, PartialEq, Eq)]
struct LibrarySuggestion {
    label: String,
    path: String,
    track_count: usize,
    count_is_limited: bool,
}

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            AUDIO_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
        })
}

fn shallow_audio_count(root: &Path, discovery_deadline: Instant) -> (usize, bool) {
    let probe_deadline = (Instant::now() + MAX_PROBE_TIME).min(discovery_deadline);
    let mut stack = vec![(root.to_path_buf(), 0_u8)];
    let mut inspected = 0_usize;
    let mut tracks = 0_usize;

    while let Some((directory, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            inspected += 1;
            if inspected >= MAX_PROBE_ENTRIES
                || tracks >= MAX_PROBE_TRACKS
                || Instant::now() >= probe_deadline
            {
                return (tracks, true);
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_file() && is_audio_file(&entry.path()) {
                tracks += 1;
            } else if file_type.is_dir() && depth < 2 {
                stack.push((entry.path(), depth + 1));
            }
        }
    }
    (tracks, false)
}

fn push_candidate(candidates: &mut Vec<(String, PathBuf)>, label: String, path: PathBuf) {
    if candidates.len() < MAX_SUGGESTION_CANDIDATES && path.is_dir() {
        candidates.push((label, path));
    }
}

fn add_mounted_media_candidates(candidates: &mut Vec<(String, PathBuf)>) {
    #[cfg(unix)]
    {
        let mut mount_roots = vec![PathBuf::from("/mnt")];
        if let Some(home) = dirs::home_dir()
            && let Some(user) = home.file_name()
        {
            mount_roots.push(PathBuf::from("/media").join(user));
            mount_roots.push(PathBuf::from("/run/media").join(user));
        }
        for mount_root in mount_roots {
            let Ok(entries) = std::fs::read_dir(mount_root) else {
                continue;
            };
            for mount in entries.flatten().take(MAX_MOUNT_ENTRIES) {
                let Ok(file_type) = mount.file_type() else {
                    continue;
                };
                if !file_type.is_dir() {
                    continue;
                }
                let mount_path = mount.path();
                let mount_name = mount.file_name().to_string_lossy().to_string();
                if ["music", "audio", "media"].contains(&mount_name.to_ascii_lowercase().as_str()) {
                    push_candidate(
                        candidates,
                        mount_path.display().to_string(),
                        mount_path.clone(),
                    );
                }
                for folder in ["Music", "Audio", "Media"] {
                    let path = mount_path.join(folder);
                    push_candidate(candidates, path.display().to_string(), path);
                }
            }
        }
    }

    #[cfg(windows)]
    {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetLogicalDrives() -> u32;
            fn GetDriveTypeW(root_path_name: *const u16) -> u32;
        }

        const DRIVE_REMOVABLE: u32 = 2;
        const DRIVE_FIXED: u32 = 3;
        // Read the drive bitmask without touching network drives.
        let drive_mask = unsafe { GetLogicalDrives() };
        for index in 0_u8..26 {
            if drive_mask & (1_u32 << index) == 0 {
                continue;
            }
            let letter = char::from(b'A' + index);
            let root = format!("{letter}:\\");
            let wide_root = root
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect::<Vec<_>>();
            // SAFETY: the pointer is valid and NUL-terminated for this call.
            let drive_type = unsafe { GetDriveTypeW(wide_root.as_ptr()) };
            if !matches!(drive_type, DRIVE_REMOVABLE | DRIVE_FIXED) {
                continue;
            }
            for folder in ["Music", "Audio", "Media"] {
                let path = PathBuf::from(format!("{root}{folder}"));
                push_candidate(candidates, path.display().to_string(), path);
            }
        }
    }
}

fn likely_library_candidates() -> Vec<(String, PathBuf)> {
    let mut candidates = Vec::new();
    if crate::settings::is_container() {
        push_candidate(
            &mut candidates,
            "Music".to_string(),
            PathBuf::from("/music"),
        );
        return candidates;
    }
    if let Some(path) = dirs::audio_dir() {
        push_candidate(&mut candidates, "Music".to_string(), path);
    }
    if let Some(path) = dirs::download_dir() {
        push_candidate(&mut candidates, "Downloads".to_string(), path);
    }
    if let Some(one_drive) = std::env::var_os("OneDrive") {
        push_candidate(
            &mut candidates,
            "OneDrive Music".to_string(),
            PathBuf::from(one_drive).join("Music"),
        );
    }
    add_mounted_media_candidates(&mut candidates);
    if let Some(home) = dirs::home_dir() {
        for (label, relative) in [
            ("iTunes Music", "Music/iTunes/iTunes Media/Music"),
            ("Apple Music", "Music/Music/Media.localized"),
        ] {
            push_candidate(&mut candidates, label.to_string(), home.join(relative));
        }
    }

    let mut seen = HashSet::new();
    candidates.retain(|(_, path)| {
        let key = path.to_string_lossy().to_ascii_lowercase();
        seen.insert(key)
    });
    candidates
}

fn discover_library_suggestions() -> Vec<LibrarySuggestion> {
    let deadline = Instant::now() + MAX_DISCOVERY_TIME;
    likely_library_candidates()
        .into_iter()
        .take_while(|_| Instant::now() < deadline)
        .filter_map(|(label, path)| {
            let (track_count, count_is_limited) = shallow_audio_count(&path, deadline);
            (track_count > 0).then(|| LibrarySuggestion {
                label,
                path: path.to_string_lossy().to_string(),
                track_count,
                count_is_limited,
            })
        })
        .collect()
}

fn setup_required(user_count: i64, state: &LibraryReadinessState) -> bool {
    user_count == 0 || setup_state_allowed(state)
}

fn setup_state_allowed(state: &LibraryReadinessState) -> bool {
    matches!(
        state,
        LibraryReadinessState::NoLibraryIndexed | LibraryReadinessState::Failed
    )
}

async fn setup_is_available(
    request: &HttpRequest,
    lifecycle: &LibraryLifecycle,
    pool: DbPool,
) -> Result<bool, String> {
    let state = lifecycle.readiness().await.state;
    // libraries.json can outlive a deleted catalog; readiness is authoritative.
    let needs_setup = setup_state_allowed(&state);
    if !needs_setup {
        return Ok(false);
    }
    request_has_current_admin(request, pool).await
}

async fn setup_status(
    request: HttpRequest,
    lifecycle: web::Data<LibraryLifecycle>,
    pool: web::Data<DbPool>,
) -> HttpResponse {
    let readiness = lifecycle.readiness().await;

    let lookup_pool = pool.get_ref().clone();
    let user_count = match web::block(move || -> Result<i64, String> {
        use crate::persistence::schema::user::dsl::user;
        let mut connection = lookup_pool.get().map_err(|error| error.to_string())?;
        user.count()
            .get_result(&mut connection)
            .map_err(|error| error.to_string())
    })
    .await
    {
        Ok(Ok(count)) => count,
        Ok(Err(error)) => {
            tracing::error!(%error, "setup status lookup failed");
            return service_unavailable(
                "Setup status is temporarily unavailable.",
                "setup_status_unavailable",
            );
        }
        Err(error) => {
            tracing::error!(%error, "setup status worker failed");
            return service_unavailable(
                "Setup status is temporarily unavailable.",
                "setup_status_unavailable",
            );
        }
    };
    let session = if user_count == 0 {
        None
    } else {
        match current_session_claims(&request, pool.get_ref().clone()).await {
            Ok(value) => value,
            Err(error) => {
                tracing::error!(%error, "setup session lookup failed");
                return service_unavailable(
                    "Setup is temporarily unavailable.",
                    "setup_session_unavailable",
                );
            }
        }
    };
    let authenticated_admin = session
        .as_ref()
        .is_some_and(|claims| claims.role == "admin");
    let needs_library = setup_state_allowed(&readiness.state);
    let setup_code_required = user_count == 0 && !crate::http::request_is_local_loopback(&request);
    if setup_code_required {
        tracing::warn!(
            setup_code = %crate::settings::initial_setup_code(),
            "remote first-account setup requires this one-time code"
        );
    }

    HttpResponse::Ok().json(serde_json::json!({
        "server_ready": true,
        "setup_required": setup_required(user_count, &readiness.state),
        "account_setup_required": user_count == 0,
        "setup_code_required": setup_code_required,
        "library_setup_required": needs_library,
        "library_state": readiness.state,
        "message": readiness.message,
        "authenticated_admin": authenticated_admin,
        "authenticated": session.is_some(),
        "session": session,
        "suggested_library_path": crate::settings::suggested_library_path().to_string_lossy(),
    }))
}

async fn setup_filesystem(
    request: HttpRequest,
    query: web::Query<filesystem::ListQuery>,
    lifecycle: web::Data<LibraryLifecycle>,
    pool: web::Data<DbPool>,
) -> HttpResponse {
    match setup_is_available(&request, lifecycle.get_ref(), pool.get_ref().clone()).await {
        Ok(true) => {}
        Ok(false) => {
            return forbidden(
                "Sign in with the first account to choose a music folder.",
                "setup_unavailable",
            );
        }
        Err(error) => {
            tracing::error!(%error, "setup authorization lookup failed");
            return service_unavailable(
                "Setup authorization is temporarily unavailable.",
                "setup_authorization_unavailable",
            );
        }
    }

    match filesystem::list_path(&query.path).await {
        Ok(directories) => HttpResponse::Ok().json(directories),
        Err(_) => internal_server_error("Failed to list directory.", "list_directory_failed"),
    }
}

async fn setup_suggestions(
    request: HttpRequest,
    _lifecycle: web::Data<LibraryLifecycle>,
    pool: web::Data<DbPool>,
) -> HttpResponse {
    match request_has_current_admin(&request, pool.get_ref().clone()).await {
        Ok(true) => {}
        Ok(false) => {
            return forbidden(
                "Sign in as an administrator to find likely music folders.",
                "admin_required",
            );
        }
        Err(error) => {
            tracing::error!(%error, "setup authorization lookup failed");
            return service_unavailable(
                "Setup authorization is temporarily unavailable.",
                "setup_authorization_unavailable",
            );
        }
    }

    match web::block(discover_library_suggestions).await {
        Ok(suggestions) => HttpResponse::Ok().json(suggestions),
        Err(error) => {
            tracing::error!(%error, "music folder suggestion worker failed");
            service_unavailable(
                "Music folder suggestions are temporarily unavailable.",
                "setup_suggestions_unavailable",
            )
        }
    }
}

async fn setup_library(
    http_request: HttpRequest,
    request: web::Json<library::LibraryIndexRequest>,
    lifecycle: web::Data<LibraryLifecycle>,
    pool: web::Data<DbPool>,
) -> HttpResponse {
    match setup_is_available(&http_request, lifecycle.get_ref(), pool.get_ref().clone()).await {
        Ok(true) => {}
        Ok(false) => {
            return forbidden(
                "Sign in with the first account to add a music folder.",
                "setup_unavailable",
            );
        }
        Err(error) => {
            tracing::error!(%error, "setup authorization lookup failed");
            return service_unavailable(
                "Setup authorization is temporarily unavailable.",
                "setup_authorization_unavailable",
            );
        }
    }

    library::index_library(request, lifecycle).await
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.route("/status", web::get().to(setup_status));
    cfg.route("/suggestions", web::get().to(setup_suggestions));
    cfg.route("/filesystem", web::get().to(setup_filesystem));
    cfg.route("/library", web::post().to(setup_library));
}

#[cfg(test)]
mod tests {
    use super::{setup_required, setup_state_allowed, shallow_audio_count};
    use crate::library::state::LibraryReadinessState;
    use std::time::{Duration, Instant};

    #[test]
    fn the_first_account_is_part_of_setup_even_when_a_library_exists() {
        assert!(setup_required(0, &LibraryReadinessState::Ready));
        assert!(setup_required(1, &LibraryReadinessState::Failed));
        assert!(!setup_required(1, &LibraryReadinessState::Indexing));
        assert!(!setup_required(1, &LibraryReadinessState::Ready));
    }

    #[test]
    fn failed_setup_can_retry_but_active_or_complete_setup_cannot() {
        assert!(setup_state_allowed(
            &LibraryReadinessState::NoLibraryIndexed,
        ));
        assert!(setup_state_allowed(&LibraryReadinessState::Failed));
        assert!(!setup_state_allowed(&LibraryReadinessState::Indexing));
        assert!(!setup_state_allowed(&LibraryReadinessState::Ready));
    }

    #[test]
    fn a_missing_catalog_can_be_reconfigured_even_when_a_root_hint_survives() {
        // A surviving libraries.json must not block setup after database deletion.
        let surviving_configured_paths = [r"D:\Music"];
        assert!(!surviving_configured_paths.is_empty());
        assert!(setup_state_allowed(
            &LibraryReadinessState::NoLibraryIndexed,
        ));
    }

    #[test]
    fn suggestion_probe_counts_audio_only_two_levels_below_the_candidate() {
        let root =
            std::env::temp_dir().join(format!("music-suggestion-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("artist/album/too-deep")).unwrap();
        std::fs::write(root.join("root.mp3"), b"fixture").unwrap();
        std::fs::write(root.join("artist/track.FLAC"), b"fixture").unwrap();
        std::fs::write(root.join("artist/album/track.m4a"), b"fixture").unwrap();
        std::fs::write(root.join("artist/album/cover.jpg"), b"fixture").unwrap();
        std::fs::write(root.join("artist/album/too-deep/ignored.ogg"), b"fixture").unwrap();

        let result = shallow_audio_count(&root, Instant::now() + Duration::from_secs(1));
        assert_eq!(result, (3, false));
        std::fs::remove_dir_all(root).unwrap();
    }
}
