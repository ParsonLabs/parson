use std::cell::RefCell;
use std::ffi::{CStr, CString, c_char};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::ptr;

use parson_music::app::LocalApp;

thread_local! {
    static LAST_ERROR: RefCell<String> = const { RefCell::new(String::new()) };
}

/// Opaque process-local state owned by the native Windows application.
pub struct ParsonMusicAppHandle {
    runtime: tokio::runtime::Runtime,
    app: LocalApp,
}

fn set_last_error(message: impl Into<String>) {
    LAST_ERROR.with(|last| *last.borrow_mut() = message.into());
}

fn clear_last_error() {
    LAST_ERROR.with(|last| last.borrow_mut().clear());
}

fn owned_c_string(value: impl Into<String>) -> *mut c_char {
    let value = value.into().replace('\0', "\u{FFFD}");
    CString::new(value)
        .expect("interior null bytes were replaced")
        .into_raw()
}

fn ffi_result<T>(operation: impl FnOnce() -> Result<T, String>) -> Option<T> {
    match catch_unwind(AssertUnwindSafe(operation)) {
        Ok(Ok(value)) => {
            clear_last_error();
            Some(value)
        }
        Ok(Err(error)) => {
            set_last_error(error);
            None
        }
        Err(_) => {
            set_last_error("The local Parson engine encountered an unexpected error.");
            None
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn parson_music_app_open() -> *mut ParsonMusicAppHandle {
    ffi_result(|| {
        let runtime = tokio::runtime::Runtime::new()
            .map_err(|error| format!("Could not create the local runtime: {error}"))?;
        let app = runtime
            .block_on(LocalApp::open())
            .map_err(|error| format!("Could not open the local music library: {error}"))?;
        Ok(Box::into_raw(Box::new(ParsonMusicAppHandle {
            runtime,
            app,
        })))
    })
    .unwrap_or(ptr::null_mut())
}

#[unsafe(no_mangle)]
/// Returns an owned UTF-8 JSON snapshot of the local application state.
///
/// # Safety
///
/// `app` must be null or a live pointer returned by [`parson_music_app_open`]. A
/// non-null handle must not be concurrently closed, and the returned string
/// must be released exactly once with [`parson_music_string_free`].
pub unsafe extern "C" fn parson_music_app_status_json(
    app: *const ParsonMusicAppHandle,
) -> *mut c_char {
    unsafe {
        ffi_result(|| {
            let handle = app
                .as_ref()
                .ok_or_else(|| "The Parson application handle is null.".to_string())?;
            let readiness = handle.runtime.block_on(handle.app.library.readiness());
            serde_json::to_string(&serde_json::json!({
                "version": env!("CARGO_PKG_VERSION"),
                "dataDirectory": parson_music::settings::data_path(&[]),
                "library": readiness,
            }))
            .map(owned_c_string)
            .map_err(|error| format!("Could not encode local application state: {error}"))
        })
        .unwrap_or(ptr::null_mut())
    }
}

#[unsafe(no_mangle)]
/// Indexes a local library folder and returns an owned UTF-8 JSON report.
///
/// # Safety
///
/// `app` must be a live pointer returned by [`parson_music_app_open`] and must not be
/// closed for the duration of this call. `path` must point to a readable,
/// NUL-terminated UTF-8 string that remains valid for the call. The returned
/// string must be released exactly once with [`parson_music_string_free`].
pub unsafe extern "C" fn parson_music_app_index_library(
    app: *mut ParsonMusicAppHandle,
    path: *const c_char,
) -> *mut c_char {
    unsafe {
        ffi_result(|| {
            let handle = app
                .as_ref()
                .ok_or_else(|| "The Parson application handle is null.".to_string())?;
            let path = path
                .as_ref()
                .ok_or_else(|| "The library path is null.".to_string())?;
            let path = CStr::from_ptr(path)
                .to_str()
                .map_err(|_| "The library path is not valid UTF-8.".to_string())?;
            let result = handle
                .runtime
                .block_on(handle.app.index_library(Path::new(path)))
                .map_err(|error| error.to_string())?;
            serde_json::to_string(&result)
                .map(owned_c_string)
                .map_err(|error| format!("Could not encode the local index report: {error}"))
        })
        .unwrap_or(ptr::null_mut())
    }
}

#[unsafe(no_mangle)]
/// Returns an owned UTF-8 JSON page from the local catalog.
///
/// # Safety
///
/// `app` must be a live pointer returned by [`parson_music_app_open`] and must not be
/// closed for the duration of this call. The returned string must be released
/// exactly once with [`parson_music_string_free`].
pub unsafe extern "C" fn parson_music_app_catalog_json(
    app: *const ParsonMusicAppHandle,
    offset: usize,
    limit: usize,
) -> *mut c_char {
    unsafe {
        ffi_result(|| {
            let handle = app
                .as_ref()
                .ok_or_else(|| "The Parson application handle is null.".to_string())?;
            let catalog = handle
                .runtime
                .block_on(handle.app.catalog(offset, limit))
                .map_err(|error| error.to_string())?;
            serde_json::to_string(&catalog)
                .map(owned_c_string)
                .map_err(|error| format!("Could not encode the local catalog: {error}"))
        })
        .unwrap_or(ptr::null_mut())
    }
}

macro_rules! catalog_section_export {
    ($name:ident, $method:ident) => {
        #[doc = "Returns one section of the bounded local catalog as owned UTF-8 JSON."]
        #[doc = ""]
        #[doc = "# Safety"]
        #[doc = "`app` must be a live pointer returned by `parson_music_app_open`, and the returned"]
        #[doc = "string must be released exactly once with `parson_music_string_free`."]
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn $name(
            app: *const ParsonMusicAppHandle,
            offset: usize,
            limit: usize,
        ) -> *mut c_char {
            unsafe {
                ffi_result(|| {
                    let handle = app
                        .as_ref()
                        .ok_or_else(|| "The Parson application handle is null.".to_string())?;
                    let catalog = handle
                        .runtime
                        .block_on(handle.app.$method(offset, limit))
                        .map_err(|error| error.to_string())?;
                    serde_json::to_string(&catalog)
                        .map(owned_c_string)
                        .map_err(|error| format!("Could not encode the local catalog: {error}"))
                })
                .unwrap_or(ptr::null_mut())
            }
        }
    };
}

catalog_section_export!(parson_music_app_catalog_albums_json, catalog_albums);
catalog_section_export!(parson_music_app_catalog_songs_json, catalog_songs);

#[unsafe(no_mangle)]
/// Returns a bounded page of local artists as owned UTF-8 JSON.
///
/// # Safety
///
/// `app` must be a live pointer returned by [`parson_music_app_open`] and must not be
/// closed for the duration of this call. The returned string must be released
/// exactly once with [`parson_music_string_free`].
pub unsafe extern "C" fn parson_music_app_artists_json(
    app: *const ParsonMusicAppHandle,
    offset: usize,
    limit: usize,
) -> *mut c_char {
    unsafe {
        ffi_result(|| {
            let handle = app
                .as_ref()
                .ok_or_else(|| "The Parson application handle is null.".to_string())?;
            let artists = handle
                .runtime
                .block_on(handle.app.artists(offset, limit))
                .map_err(|error| error.to_string())?;
            serde_json::to_string(&artists)
                .map(owned_c_string)
                .map_err(|error| format!("Could not encode local artists: {error}"))
        })
        .unwrap_or(ptr::null_mut())
    }
}

#[unsafe(no_mangle)]
/// Returns one local artist as owned UTF-8 JSON.
///
/// # Safety
///
/// `app` must be a live pointer returned by [`parson_music_app_open`] and must not be
/// closed for the duration of this call. `artist_id` must point to a readable,
/// NUL-terminated UTF-8 string that remains valid for the call. The returned
/// string must be released exactly once with [`parson_music_string_free`].
pub unsafe extern "C" fn parson_music_app_artist_json(
    app: *const ParsonMusicAppHandle,
    artist_id: *const c_char,
) -> *mut c_char {
    unsafe {
        ffi_result(|| {
            let handle = app
                .as_ref()
                .ok_or_else(|| "The Parson application handle is null.".to_string())?;
            let artist_id = artist_id
                .as_ref()
                .ok_or_else(|| "The artist identifier is null.".to_string())?;
            let artist_id = CStr::from_ptr(artist_id)
                .to_str()
                .map_err(|_| "The artist identifier is not valid UTF-8.".to_string())?;
            let artist = handle
                .runtime
                .block_on(handle.app.artist_detail(artist_id))
                .map_err(|error| error.to_string())?;
            serde_json::to_string(&artist)
                .map(owned_c_string)
                .map_err(|error| format!("Could not encode the local artist: {error}"))
        })
        .unwrap_or(ptr::null_mut())
    }
}

#[unsafe(no_mangle)]
/// Returns local recommendations, optionally seeded by the current song.
/// A null seed pointer requests a diverse library fallback.
///
/// # Safety
///
/// `app` must be a live pointer returned by [`parson_music_app_open`] and must not be
/// closed for the duration of this call. When non-null, `seed_song_id` must
/// point to a readable, NUL-terminated UTF-8 string that remains valid for the
/// call. The returned string must be released exactly once with
/// [`parson_music_string_free`].
pub unsafe extern "C" fn parson_music_app_recommendations_json(
    app: *const ParsonMusicAppHandle,
    seed_song_id: *const c_char,
    limit: usize,
) -> *mut c_char {
    unsafe {
        ffi_result(|| {
            let handle = app
                .as_ref()
                .ok_or_else(|| "The Parson application handle is null.".to_string())?;
            let seed = if seed_song_id.is_null() {
                None
            } else {
                Some(
                    CStr::from_ptr(seed_song_id)
                        .to_str()
                        .map_err(|_| "The seed song identifier is not valid UTF-8.".to_string())?,
                )
            };
            let songs = handle
                .runtime
                .block_on(handle.app.recommendations(seed, limit))
                .map_err(|error| error.to_string())?;
            serde_json::to_string(&songs)
                .map(owned_c_string)
                .map_err(|error| format!("Could not encode recommendations: {error}"))
        })
        .unwrap_or(ptr::null_mut())
    }
}

#[unsafe(no_mangle)]
/// Searches the local catalog and returns owned UTF-8 JSON results.
///
/// # Safety
///
/// `app` must be a live pointer returned by [`parson_music_app_open`] and must not be
/// closed for the duration of this call. `query` must point to a readable,
/// NUL-terminated UTF-8 string that remains valid for the call. The returned
/// string must be released exactly once with [`parson_music_string_free`].
pub unsafe extern "C" fn parson_music_app_search_json(
    app: *const ParsonMusicAppHandle,
    query: *const c_char,
    limit: usize,
) -> *mut c_char {
    unsafe {
        ffi_result(|| {
            let handle = app
                .as_ref()
                .ok_or_else(|| "The Parson application handle is null.".to_string())?;
            let query = query
                .as_ref()
                .ok_or_else(|| "The search query is null.".to_string())?;
            let query = CStr::from_ptr(query)
                .to_str()
                .map_err(|_| "The search query is not valid UTF-8.".to_string())?;
            let results = handle
                .runtime
                .block_on(handle.app.search(query, limit))
                .map_err(|error| error.to_string())?;
            serde_json::to_string(&results)
                .map(owned_c_string)
                .map_err(|error| format!("Could not encode local search results: {error}"))
        })
        .unwrap_or(ptr::null_mut())
    }
}

#[unsafe(no_mangle)]
/// Returns a complete local album as owned UTF-8 JSON.
///
/// # Safety
///
/// `app` must be a live pointer returned by [`parson_music_app_open`]. `album_id`
/// must be a readable, NUL-terminated UTF-8 string. Release the result with
/// [`parson_music_string_free`].
pub unsafe extern "C" fn parson_music_app_album_json(
    app: *const ParsonMusicAppHandle,
    album_id: *const c_char,
) -> *mut c_char {
    unsafe {
        ffi_result(|| {
            let handle = app
                .as_ref()
                .ok_or_else(|| "The Parson application handle is null.".to_string())?;
            let album_id = album_id
                .as_ref()
                .ok_or_else(|| "The album identifier is null.".to_string())?;
            let album_id = CStr::from_ptr(album_id)
                .to_str()
                .map_err(|_| "The album identifier is not valid UTF-8.".to_string())?;
            let album = handle
                .runtime
                .block_on(handle.app.album_detail(album_id))
                .map_err(|error| error.to_string())?;
            serde_json::to_string(&album)
                .map(owned_c_string)
                .map_err(|error| format!("Could not encode the local album: {error}"))
        })
        .unwrap_or(ptr::null_mut())
    }
}

#[unsafe(no_mangle)]
/// Returns all local playlist summaries as owned UTF-8 JSON.
///
/// # Safety
///
/// `app` must be a live pointer returned by [`parson_music_app_open`] and must not be
/// closed for the duration of this call. The returned string must be released
/// exactly once with [`parson_music_string_free`].
pub unsafe extern "C" fn parson_music_app_playlists_json(
    app: *const ParsonMusicAppHandle,
) -> *mut c_char {
    unsafe {
        ffi_result(|| {
            let handle = app
                .as_ref()
                .ok_or_else(|| "The Parson application handle is null.".to_string())?;
            let playlists = handle
                .runtime
                .block_on(handle.app.playlists())
                .map_err(|error| error.to_string())?;
            serde_json::to_string(&playlists)
                .map(owned_c_string)
                .map_err(|error| format!("Could not encode local playlists: {error}"))
        })
        .unwrap_or(ptr::null_mut())
    }
}

#[unsafe(no_mangle)]
/// Creates a local playlist and returns it as owned UTF-8 JSON.
///
/// # Safety
///
/// `app` must be a live pointer returned by [`parson_music_app_open`] and must not be
/// closed for the duration of this call. `name` must point to a readable,
/// NUL-terminated UTF-8 string that remains valid for the call. The returned
/// string must be released exactly once with [`parson_music_string_free`].
pub unsafe extern "C" fn parson_music_app_create_playlist_json(
    app: *mut ParsonMusicAppHandle,
    name: *const c_char,
) -> *mut c_char {
    unsafe {
        ffi_result(|| {
            let handle = app
                .as_ref()
                .ok_or_else(|| "The Parson application handle is null.".to_string())?;
            let name = name
                .as_ref()
                .ok_or_else(|| "The playlist name is null.".to_string())?;
            let name = CStr::from_ptr(name)
                .to_str()
                .map_err(|_| "The playlist name is not valid UTF-8.".to_string())?;
            let playlist = handle
                .runtime
                .block_on(handle.app.create_playlist(name))
                .map_err(|error| error.to_string())?;
            serde_json::to_string(&playlist)
                .map(owned_c_string)
                .map_err(|error| format!("Could not encode the local playlist: {error}"))
        })
        .unwrap_or(ptr::null_mut())
    }
}

#[unsafe(no_mangle)]
/// Returns one local playlist as owned UTF-8 JSON.
///
/// # Safety
///
/// `app` must be a live pointer returned by [`parson_music_app_open`] and must not be
/// closed for the duration of this call. The returned string must be released
/// exactly once with [`parson_music_string_free`].
pub unsafe extern "C" fn parson_music_app_playlist_json(
    app: *const ParsonMusicAppHandle,
    playlist_id: i32,
) -> *mut c_char {
    unsafe {
        ffi_result(|| {
            let handle = app
                .as_ref()
                .ok_or_else(|| "The Parson application handle is null.".to_string())?;
            let playlist = handle
                .runtime
                .block_on(handle.app.playlist_detail(playlist_id))
                .map_err(|error| error.to_string())?;
            serde_json::to_string(&playlist)
                .map(owned_c_string)
                .map_err(|error| format!("Could not encode the local playlist: {error}"))
        })
        .unwrap_or(ptr::null_mut())
    }
}

#[unsafe(no_mangle)]
/// Adds a song to a local playlist, returning `1` on success and `0` on error.
///
/// # Safety
///
/// `app` must be a live pointer returned by [`parson_music_app_open`] and must not be
/// closed for the duration of this call. `song_id` must point to a readable,
/// NUL-terminated UTF-8 string that remains valid for the call.
pub unsafe extern "C" fn parson_music_app_add_playlist_song(
    app: *mut ParsonMusicAppHandle,
    playlist_id: i32,
    song_id: *const c_char,
) -> i32 {
    unsafe {
        ffi_result(|| {
            let handle = app
                .as_ref()
                .ok_or_else(|| "The Parson application handle is null.".to_string())?;
            let song_id = song_id
                .as_ref()
                .ok_or_else(|| "The song identifier is null.".to_string())?;
            let song_id = CStr::from_ptr(song_id)
                .to_str()
                .map_err(|_| "The song identifier is not valid UTF-8.".to_string())?;
            handle
                .runtime
                .block_on(handle.app.add_playlist_song(playlist_id, song_id))
                .map_err(|error| error.to_string())?;
            Ok(1)
        })
        .unwrap_or(0)
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn parson_music_last_error_message() -> *mut c_char {
    LAST_ERROR.with(|last| owned_c_string(last.borrow().clone()))
}

#[unsafe(no_mangle)]
/// Releases a string allocated by this bridge.
///
/// # Safety
///
/// `value` must be null or a pointer returned by a bridge function such as
/// [`parson_music_app_status_json`] or [`parson_music_last_error_message`]. It must be passed
/// to this function at most once and must not be used afterward.
pub unsafe extern "C" fn parson_music_string_free(value: *mut c_char) {
    unsafe {
        if !value.is_null() {
            drop(CString::from_raw(value));
        }
    }
}

#[unsafe(no_mangle)]
/// Closes and releases a local application handle.
///
/// # Safety
///
/// `app` must be null or a pointer returned by [`parson_music_app_open`]. The pointer
/// must be closed at most once, and no other thread may access it concurrently
/// or after this call begins.
pub unsafe extern "C" fn parson_music_app_close(app: *mut ParsonMusicAppHandle) {
    unsafe {
        if !app.is_null() {
            drop(Box::from_raw(app));
            parson_music::persistence::connection::mark_clean_shutdown();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::CStr;

    use super::{
        parson_music_app_status_json, parson_music_last_error_message, parson_music_string_free,
    };

    #[test]
    fn null_handles_return_a_owned_diagnostic() {
        let status = unsafe { parson_music_app_status_json(std::ptr::null()) };
        assert!(status.is_null());

        let error = parson_music_last_error_message();
        let message = unsafe { CStr::from_ptr(error) }
            .to_str()
            .expect("UTF-8 diagnostic");
        assert!(message.contains("handle is null"));
        unsafe { parson_music_string_free(error) };
    }
}
