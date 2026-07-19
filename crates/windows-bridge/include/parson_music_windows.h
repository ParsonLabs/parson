#pragma once

#include <stdint.h>

#if defined(_WIN32)
#define PARSON_MUSIC_API __declspec(dllimport)
#else
#define PARSON_MUSIC_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ParsonMusicAppHandle ParsonMusicAppHandle;

// Opens the process-local Parson Music engine. This initializes the app-owned SQLite
// database and library cache but never starts a server or opens a socket.
PARSON_MUSIC_API ParsonMusicAppHandle* parson_music_app_open(void);

// Returns UTF-8 JSON owned by the bridge. Release it with parson_music_string_free.
// A null result indicates an error; retrieve its message with
// parson_music_last_error_message.
PARSON_MUSIC_API char* parson_music_app_status_json(const ParsonMusicAppHandle* app);

// Indexes a UTF-8 Windows folder path synchronously and returns a JSON report.
// Native UI callers should invoke this on a background thread.
PARSON_MUSIC_API char* parson_music_app_index_library(ParsonMusicAppHandle* app, const char* path);

// Returns a bounded local catalog page for native rendering.
PARSON_MUSIC_API char* parson_music_app_catalog_json(const ParsonMusicAppHandle* app, uintptr_t offset, uintptr_t limit);
PARSON_MUSIC_API char* parson_music_app_artists_json(const ParsonMusicAppHandle* app, uintptr_t offset, uintptr_t limit);
PARSON_MUSIC_API char* parson_music_app_artist_json(const ParsonMusicAppHandle* app, const char* artist_id);
PARSON_MUSIC_API char* parson_music_app_recommendations_json(const ParsonMusicAppHandle* app, const char* seed_song_id, uintptr_t limit);

// Searches only the in-memory local index. No network provider is consulted.
PARSON_MUSIC_API char* parson_music_app_search_json(const ParsonMusicAppHandle* app, const char* query, uintptr_t limit);

// Returns one album and its complete local track list.
PARSON_MUSIC_API char* parson_music_app_album_json(const ParsonMusicAppHandle* app, const char* album_id);

PARSON_MUSIC_API char* parson_music_app_playlists_json(const ParsonMusicAppHandle* app);
PARSON_MUSIC_API char* parson_music_app_create_playlist_json(ParsonMusicAppHandle* app, const char* name);
PARSON_MUSIC_API char* parson_music_app_playlist_json(const ParsonMusicAppHandle* app, int32_t playlist_id);
PARSON_MUSIC_API int32_t parson_music_app_add_playlist_song(ParsonMusicAppHandle* app, int32_t playlist_id, const char* song_id);

PARSON_MUSIC_API char* parson_music_last_error_message(void);
PARSON_MUSIC_API void parson_music_string_free(char* value);
PARSON_MUSIC_API void parson_music_app_close(ParsonMusicAppHandle* app);

#ifdef __cplusplus
}
#endif
