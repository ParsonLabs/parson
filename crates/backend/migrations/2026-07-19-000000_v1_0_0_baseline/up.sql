-- Parson Music v1.0.0 database baseline.
-- Future schema changes must be added as new migrations.

CREATE TABLE IF NOT EXISTS "user"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT,
  "username" TEXT NOT NULL UNIQUE,
  "password" TEXT NOT NULL,
  "image" TEXT,
  "bitrate" INTEGER NOT NULL DEFAULT 0,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "now_playing" TEXT,
  "role" TEXT NOT NULL DEFAULT 'user',
  token_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS "search_item"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "user_id" INTEGER NOT NULL,
  "search" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "search_item_user_id_fkey" FOREIGN KEY("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "listen_history_item"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "user_id" INTEGER NOT NULL,
  "song_id" TEXT NOT NULL,
  "listened_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "listen_history_item_user_id_fkey" FOREIGN KEY("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "follow"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "follower_id" INTEGER NOT NULL,
  "following_id" INTEGER NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "follow_follower_id_fkey" FOREIGN KEY("follower_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "follow_following_id_fkey" FOREIGN KEY("following_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "playlist"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "cover_image" TEXT,
  "is_public" BOOLEAN NOT NULL DEFAULT false,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "song"(
  "id" TEXT NOT NULL PRIMARY KEY,
  "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "_playlist_to_user"(
  "a" INTEGER NOT NULL,
  "b" INTEGER NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'collaborator',
  "joined_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "_playlist_to_user_a_fkey" FOREIGN KEY("a") REFERENCES "playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_playlist_to_user_b_fkey" FOREIGN KEY("b") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "_playlist_to_song"(
  "a" INTEGER NOT NULL,
  "b" TEXT NOT NULL,
  "date_added" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "added_by" INTEGER,
  "position" INTEGER,
  CONSTRAINT "_playlist_to_song_a_fkey" FOREIGN KEY("a") REFERENCES "playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_playlist_to_song_b_fkey" FOREIGN KEY("b") REFERENCES "song"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_playlist_to_song_added_by_fkey" FOREIGN KEY("added_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "genre"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS "_song_to_genre"(
  "song_id" TEXT NOT NULL,
  "genre_id" INTEGER NOT NULL,
  CONSTRAINT "_song_to_genre_song_id_fkey" FOREIGN KEY("song_id") REFERENCES "song"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "_song_to_genre_genre_id_fkey" FOREIGN KEY("genre_id") REFERENCES "genre"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "favorite_song"(
  "user_id" INTEGER NOT NULL,
  "song_id" TEXT NOT NULL,
  "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY("user_id", "song_id"),
  CONSTRAINT "favorite_song_user_id_fkey" FOREIGN KEY("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "favorite_song_song_id_fkey" FOREIGN KEY("song_id") REFERENCES "song"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "playlist_stats"(
  "playlist_id" INTEGER NOT NULL PRIMARY KEY,
  "total_duration" REAL NOT NULL DEFAULT 0,
  "song_count" INTEGER NOT NULL DEFAULT 0,
  "most_common_genre" TEXT,
  "last_calculated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "playlist_stats_playlist_id_fkey" FOREIGN KEY("playlist_id") REFERENCES "playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "lyrics"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "song_id" TEXT NOT NULL,
  "plain_lyrics" TEXT,
  "synced_lyrics" TEXT,
  "source" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "language" TEXT NOT NULL DEFAULT 'en',
  "is_verified" BOOLEAN NOT NULL DEFAULT false,
  "view_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "lyrics_song_id_fkey" FOREIGN KEY("song_id") REFERENCES "song"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "lyrics_contribution"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "lyrics_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "plain_lyrics" TEXT,
  "synced_lyrics" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lyrics_contribution_lyrics_id_fkey" FOREIGN KEY("lyrics_id") REFERENCES "lyrics"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lyrics_contribution_user_id_fkey" FOREIGN KEY("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "lyrics_view_history"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "user_id" INTEGER NOT NULL,
  "song_id" TEXT NOT NULL,
  "viewed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lyrics_view_history_user_id_fkey" FOREIGN KEY("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lyrics_view_history_song_id_fkey" FOREIGN KEY("song_id") REFERENCES "song"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_username_key" ON "user"("username");
CREATE INDEX IF NOT EXISTS "idx_listen_history_user" ON "listen_history_item"("user_id");
CREATE INDEX IF NOT EXISTS "idx_listen_history_song" ON "listen_history_item"("song_id");
CREATE UNIQUE INDEX IF NOT EXISTS "follow_follower_id_following_id_key" ON "follow"(
  "follower_id",
  "following_id"
);
CREATE INDEX IF NOT EXISTS "idx_playlist_public" ON "playlist"("is_public");
CREATE UNIQUE INDEX IF NOT EXISTS "_playlist_to_user_a_b_unique" ON "_playlist_to_user"(
  "a",
  "b"
);
CREATE INDEX IF NOT EXISTS "_playlist_to_user_b_index" ON "_playlist_to_user"("b");
CREATE INDEX IF NOT EXISTS "_playlist_to_user_role_index" ON "_playlist_to_user"("role");
CREATE UNIQUE INDEX IF NOT EXISTS "_playlist_to_song_a_b_unique" ON "_playlist_to_song"(
  "a",
  "b"
);
CREATE INDEX IF NOT EXISTS "_playlist_to_song_b_index" ON "_playlist_to_song"("b");
CREATE INDEX IF NOT EXISTS "_playlist_to_song_position_index" ON "_playlist_to_song"(
  "position"
);
CREATE UNIQUE INDEX IF NOT EXISTS "_song_to_genre_song_genre_unique" ON "_song_to_genre"(
  "song_id",
  "genre_id"
);
CREATE INDEX IF NOT EXISTS "idx_favorite_song_user" ON "favorite_song"("user_id");
CREATE INDEX IF NOT EXISTS "idx_lyrics_song_id" ON "lyrics"("song_id");
CREATE INDEX IF NOT EXISTS "idx_lyrics_language" ON "lyrics"("language");
CREATE INDEX IF NOT EXISTS "idx_lyrics_view_count" ON "lyrics"("view_count" DESC);
CREATE INDEX IF NOT EXISTS "idx_lyrics_contribution_lyrics_id" ON "lyrics_contribution"(
  "lyrics_id"
);
CREATE INDEX IF NOT EXISTS "idx_lyrics_contribution_user_id" ON "lyrics_contribution"(
  "user_id"
);
CREATE INDEX IF NOT EXISTS "idx_lyrics_contribution_status" ON "lyrics_contribution"(
  "status"
);
CREATE INDEX IF NOT EXISTS "idx_lyrics_view_history_user_id" ON "lyrics_view_history"(
  "user_id"
);
CREATE INDEX IF NOT EXISTS "idx_lyrics_view_history_song_id" ON "lyrics_view_history"(
  "song_id"
);
CREATE TABLE "library_root"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "path" TEXT NOT NULL UNIQUE,
  "display_name" TEXT,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_scanned_at" DATETIME
);
CREATE TABLE "library_scan_job"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "root_id" INTEGER,
  "status" TEXT NOT NULL,
  "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" DATETIME,
  "discovered_files" INTEGER NOT NULL DEFAULT 0,
  "parsed_files" INTEGER NOT NULL DEFAULT 0,
  "reused_files" INTEGER NOT NULL DEFAULT 0,
  "indexed_tracks" INTEGER NOT NULL DEFAULT 0,
  "warnings_count" INTEGER NOT NULL DEFAULT 0,
  "message" TEXT,
  CONSTRAINT "library_scan_job_root_id_fkey" FOREIGN KEY("root_id") REFERENCES "library_root"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "library_scan_event"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "scan_job_id" INTEGER NOT NULL,
  "level" TEXT NOT NULL,
  "path" TEXT,
  "message" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "library_scan_event_scan_job_id_fkey" FOREIGN KEY("scan_job_id") REFERENCES "library_scan_job"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "file_entry"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "root_id" INTEGER NOT NULL,
  "path" TEXT NOT NULL UNIQUE,
  "directory" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "extension" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "modified_at_ns" INTEGER NOT NULL,
  "content_hash" TEXT,
  "availability" TEXT NOT NULL DEFAULT 'available',
  "scan_status" TEXT NOT NULL DEFAULT 'pending',
  "last_seen_scan_id" INTEGER,
  "last_parsed_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stable_identity TEXT,
  tag_fingerprint TEXT,
  CONSTRAINT "file_entry_root_id_fkey" FOREIGN KEY("root_id") REFERENCES "library_root"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "file_entry_last_seen_scan_id_fkey" FOREIGN KEY("last_seen_scan_id") REFERENCES "library_scan_job"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "raw_file_metadata"(
  "file_id" INTEGER NOT NULL PRIMARY KEY,
  "title" TEXT,
  "album" TEXT,
  "track_artists_json" TEXT NOT NULL DEFAULT '[]',
  "album_artists_json" TEXT NOT NULL DEFAULT '[]',
  "genres_json" TEXT NOT NULL DEFAULT '[]',
  "track_number" INTEGER,
  "disc_number" INTEGER,
  "duration_seconds" REAL NOT NULL DEFAULT 0,
  "bitrate" INTEGER,
  "sample_rate" INTEGER,
  "channels" INTEGER,
  "codec" TEXT,
  "container" TEXT,
  "musicbrainz_recording_id" TEXT,
  "musicbrainz_release_id" TEXT,
  "musicbrainz_artist_id" TEXT,
  "musicbrainz_album_artist_id" TEXT,
  "cover_url" TEXT,
  "parsed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "parser" TEXT NOT NULL DEFAULT 'audiotags+lofty',
  "parser_version" TEXT,
  "error" TEXT,
  release_date TEXT,
  cover_resolver_version TEXT,
  classification_version TEXT,
  duration_source TEXT NOT NULL DEFAULT 'unavailable'
  CHECK(duration_source IN('exact', 'header_derived', 'estimated', 'unavailable')),
  embedded_artwork_offset INTEGER,
  embedded_artwork_length INTEGER,
  CONSTRAINT "raw_file_metadata_file_id_fkey" FOREIGN KEY("file_id") REFERENCES "file_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "artwork"(
  "id" TEXT NOT NULL PRIMARY KEY,
  "source" TEXT NOT NULL,
  "uri" TEXT NOT NULL,
  "mime_type" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "hash" TEXT,
  "dominant_color" TEXT,
  "blurhash" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "artwork_uri_source_key" UNIQUE("uri", "source")
);
CREATE TABLE "artist_entity"(
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "sort_name" TEXT,
  "normalized_name" TEXT NOT NULL,
  "description" TEXT,
  "followers" INTEGER NOT NULL DEFAULT 0,
  "artwork_id" TEXT,
  "tadb_music_videos" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "artist_entity_artwork_id_fkey" FOREIGN KEY("artwork_id") REFERENCES "artwork"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "artist_alias"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "artist_id" TEXT NOT NULL,
  "alias" TEXT NOT NULL,
  "normalized_alias" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'indexer',
  CONSTRAINT "artist_alias_artist_id_fkey" FOREIGN KEY("artist_id") REFERENCES "artist_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "artist_alias_artist_alias_key" UNIQUE("artist_id", "normalized_alias")
);
CREATE TABLE "album_entity"(
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "sort_title" TEXT,
  "normalized_title" TEXT NOT NULL,
  "primary_type" TEXT,
  "description" TEXT,
  "first_release_date" TEXT,
  "musicbrainz_id" TEXT,
  "wikidata_id" TEXT,
  "artwork_id" TEXT,
  "release_album_json" TEXT,
  "release_group_album_json" TEXT,
  "release_group_id" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "album_entity_artwork_id_fkey" FOREIGN KEY("artwork_id") REFERENCES "artwork"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "track_entity"(
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "sort_title" TEXT,
  "normalized_title" TEXT NOT NULL,
  "album_id" TEXT,
  "track_number" INTEGER NOT NULL DEFAULT 0,
  "disc_number" INTEGER NOT NULL DEFAULT 0,
  "duration_seconds" REAL NOT NULL DEFAULT 0,
  "music_video_json" TEXT,
  "musicbrainz_recording_id" TEXT,
  "recording_id" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "track_entity_album_id_fkey" FOREIGN KEY("album_id") REFERENCES "album_entity"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "track_file"(
  "track_id" TEXT NOT NULL,
  "file_id" INTEGER NOT NULL,
  "quality_rank" INTEGER NOT NULL DEFAULT 0,
  "is_primary" BOOLEAN NOT NULL DEFAULT true,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY("track_id", "file_id"),
  CONSTRAINT "track_file_track_id_fkey" FOREIGN KEY("track_id") REFERENCES "track_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "track_file_file_id_fkey" FOREIGN KEY("file_id") REFERENCES "file_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "album_artist"(
  "album_id" TEXT NOT NULL,
  "artist_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "role" TEXT NOT NULL DEFAULT 'primary',
  "join_phrase" TEXT,
  PRIMARY KEY("album_id", "artist_id", "role"),
  CONSTRAINT "album_artist_album_id_fkey" FOREIGN KEY("album_id") REFERENCES "album_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "album_artist_artist_id_fkey" FOREIGN KEY("artist_id") REFERENCES "artist_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "track_artist"(
  "track_id" TEXT NOT NULL,
  "artist_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "role" TEXT NOT NULL DEFAULT 'primary',
  "join_phrase" TEXT,
  PRIMARY KEY("track_id", "artist_id", "role"),
  CONSTRAINT "track_artist_track_id_fkey" FOREIGN KEY("track_id") REFERENCES "track_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "track_artist_artist_id_fkey" FOREIGN KEY("artist_id") REFERENCES "artist_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "genre_entity"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL UNIQUE,
  "normalized_name" TEXT NOT NULL UNIQUE
);
CREATE TABLE "track_genre"(
  "track_id" TEXT NOT NULL,
  "genre_id" INTEGER NOT NULL,
  PRIMARY KEY("track_id", "genre_id"),
  CONSTRAINT "track_genre_track_id_fkey" FOREIGN KEY("track_id") REFERENCES "track_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "track_genre_genre_id_fkey" FOREIGN KEY("genre_id") REFERENCES "genre_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "album_genre"(
  "album_id" TEXT NOT NULL,
  "genre_id" INTEGER NOT NULL,
  PRIMARY KEY("album_id", "genre_id"),
  CONSTRAINT "album_genre_album_id_fkey" FOREIGN KEY("album_id") REFERENCES "album_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "album_genre_genre_id_fkey" FOREIGN KEY("genre_id") REFERENCES "genre_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "external_id"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "url" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_id_entity_provider_key" UNIQUE("entity_type", "entity_id", "provider", "external_id")
);
CREATE TABLE "metadata_override"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "field_name" TEXT NOT NULL,
  "value_json" TEXT NOT NULL,
  "user_id" INTEGER,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "metadata_override_user_id_fkey" FOREIGN KEY("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "metadata_override_entity_field_key" UNIQUE("entity_type", "entity_id", "field_name")
);
CREATE TABLE "library_search_document"(
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "subtitle" TEXT,
  "artwork_uri" TEXT,
  "normalized_text" TEXT NOT NULL,
  "keywords" TEXT,
  "popularity_score" REAL NOT NULL DEFAULT 0,
  "recency_score" REAL NOT NULL DEFAULT 0,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY("entity_type", "entity_id")
);
CREATE TABLE "recording_entity"(
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "normalized_title" TEXT NOT NULL,
  "musicbrainz_recording_id" TEXT,
  "duration_seconds" REAL NOT NULL DEFAULT 0,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "release_group_entity"(
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "normalized_title" TEXT NOT NULL,
  "primary_type" TEXT,
  "first_release_date" TEXT,
  "musicbrainz_id" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "metadata_source"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "payload_json" TEXT NOT NULL,
  "confidence" REAL NOT NULL DEFAULT 0,
  "fetched_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "metadata_source_entity_provider_key" UNIQUE("provider", "entity_type", "entity_id")
);
CREATE TABLE "metadata_task"(
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "not_before" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "metadata_task_entity_provider_key" UNIQUE("provider", "entity_type", "entity_id")
);
CREATE TABLE "playlist_track"(
  "playlist_id" INTEGER NOT NULL,
  "track_id" TEXT NOT NULL,
  "date_added" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "added_by" INTEGER,
  "position" INTEGER,
  PRIMARY KEY("playlist_id", "track_id"),
  CONSTRAINT "playlist_track_playlist_id_fkey" FOREIGN KEY("playlist_id") REFERENCES "playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "playlist_track_track_id_fkey" FOREIGN KEY("track_id") REFERENCES "track_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "playlist_track_added_by_fkey" FOREIGN KEY("added_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE VIEW "library_track_view" AS
SELECT
    t.id AS id,
    t.title AS name,
    COALESCE(primary_track_artist.name, 'Unknown Artist') AS artist,
    t.track_number AS track_number,
    t.duration_seconds AS duration,
    fe.path AS path,
    a.id AS album_id,
    a.title AS album_name,
    album_art.uri AS album_cover_url,
    primary_album_artist.id AS artist_id,
    primary_album_artist.name AS album_artist_name,
    t.music_video_json AS music_video_json
FROM track_entity t
LEFT JOIN album_entity a ON a.id = t.album_id
LEFT JOIN artwork album_art ON album_art.id = a.artwork_id
LEFT JOIN track_file tf ON tf.track_id = t.id AND tf.is_primary = true
LEFT JOIN file_entry fe ON fe.id = tf.file_id
LEFT JOIN track_artist ta_primary ON ta_primary.track_id = t.id AND ta_primary.role = 'primary'
LEFT JOIN artist_entity primary_track_artist ON primary_track_artist.id = ta_primary.artist_id
LEFT JOIN album_artist aa_primary ON aa_primary.album_id = a.id AND aa_primary.role = 'primary'
LEFT JOIN artist_entity primary_album_artist ON primary_album_artist.id = aa_primary.artist_id;
CREATE VIEW "library_album_view" AS
SELECT
    a.id AS id,
    a.title AS name,
    art.uri AS cover_url,
    a.primary_type AS primary_type,
    a.description AS description,
    a.first_release_date AS first_release_date,
    a.musicbrainz_id AS musicbrainz_id,
    a.wikidata_id AS wikidata_id,
    aa.artist_id AS artist_id,
    ar.name AS artist_name,
    COUNT(t.id) AS song_count,
    COALESCE(SUM(t.duration_seconds), 0) AS total_duration
FROM album_entity a
LEFT JOIN artwork art ON art.id = a.artwork_id
LEFT JOIN album_artist aa ON aa.album_id = a.id AND aa.role = 'primary'
LEFT JOIN artist_entity ar ON ar.id = aa.artist_id
LEFT JOIN track_entity t ON t.album_id = a.id
GROUP BY a.id;
CREATE VIEW "library_artist_view" AS
SELECT
    ar.id AS id,
    ar.name AS name,
    art.uri AS icon_url,
    ar.followers AS followers,
    ar.description AS description,
    ar.tadb_music_videos AS tadb_music_videos,
    COUNT(DISTINCT aa.album_id) AS album_count,
    COUNT(DISTINCT ta.track_id) AS track_count
FROM artist_entity ar
LEFT JOIN artwork art ON art.id = ar.artwork_id
LEFT JOIN album_artist aa ON aa.artist_id = ar.id
LEFT JOIN track_artist ta ON ta.artist_id = ar.id
GROUP BY ar.id;
CREATE INDEX "idx_library_root_path" ON "library_root"("path");
CREATE INDEX "idx_scan_job_root_status" ON "library_scan_job"(
  "root_id",
  "status"
);
CREATE INDEX "idx_scan_event_job" ON "library_scan_event"("scan_job_id");
CREATE INDEX "idx_file_entry_root" ON "file_entry"("root_id");
CREATE INDEX "idx_file_entry_fingerprint" ON "file_entry"(
  "path",
  "size_bytes",
  "modified_at_ns"
);
CREATE INDEX "idx_file_entry_last_seen" ON "file_entry"("last_seen_scan_id");
CREATE INDEX "idx_raw_file_metadata_file" ON "raw_file_metadata"("file_id");
CREATE INDEX "idx_artist_entity_normalized" ON "artist_entity"(
  "normalized_name"
);
CREATE INDEX "idx_album_entity_normalized" ON "album_entity"(
  "normalized_title"
);
CREATE INDEX "idx_track_entity_album" ON "track_entity"(
  "album_id",
  "disc_number",
  "track_number"
);
CREATE INDEX "idx_track_entity_normalized" ON "track_entity"(
  "normalized_title"
);
CREATE INDEX "idx_track_file_primary" ON "track_file"(
  "track_id",
  "is_primary"
);
CREATE INDEX "idx_album_artist_artist" ON "album_artist"("artist_id");
CREATE INDEX "idx_track_artist_artist" ON "track_artist"("artist_id");
CREATE INDEX "idx_library_search_text" ON "library_search_document"(
  "normalized_text"
);
CREATE INDEX "idx_recording_normalized" ON "recording_entity"(
  "normalized_title"
);
CREATE INDEX "idx_release_group_normalized" ON "release_group_entity"(
  "normalized_title"
);
CREATE INDEX "idx_metadata_task_status" ON "metadata_task"(
  "status",
  "not_before"
);
CREATE INDEX "idx_metadata_source_entity" ON "metadata_source"(
  "entity_type",
  "entity_id"
);
CREATE INDEX "idx_playlist_track_track" ON "playlist_track"("track_id");
CREATE INDEX "idx_album_entity_release_group" ON "album_entity"(
  "release_group_id"
);
CREATE INDEX "idx_track_entity_recording" ON "track_entity"("recording_id");
CREATE INDEX "idx_listen_history_user_listened_at_id" ON "listen_history_item"(
  "user_id",
  "listened_at" DESC,
  "id" DESC
);
CREATE INDEX "idx_listen_history_song_listened_at" ON "listen_history_item"(
  "song_id",
  "listened_at" DESC
);
CREATE TABLE playback_event(
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  song_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  session_id TEXT,
  queue_id TEXT,
  source TEXT NOT NULL DEFAULT 'unknown',
  position_seconds REAL NOT NULL DEFAULT 0,
  duration_seconds REAL NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT playback_event_user_fkey FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX idx_playback_event_user_time ON playback_event(
  user_id,
  created_at DESC
);
CREATE INDEX idx_playback_event_user_song ON playback_event(user_id, song_id);
CREATE INDEX idx_playback_event_session ON playback_event(
  user_id,
  session_id,
  created_at
);
CREATE TABLE user_track_preference(
  user_id INTEGER NOT NULL,
  song_id TEXT NOT NULL,
  qualified_plays INTEGER NOT NULL DEFAULT 0,
  completions INTEGER NOT NULL DEFAULT 0,
  early_skips INTEGER NOT NULL DEFAULT 0,
  manual_queue_adds INTEGER NOT NULL DEFAULT 0,
  playlist_adds INTEGER NOT NULL DEFAULT 0,
  preference_score REAL NOT NULL DEFAULT 0,
  last_positive_at DATETIME,
  last_played_at DATETIME,
  PRIMARY KEY(user_id, song_id),
  CONSTRAINT user_track_preference_user_fkey FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX idx_user_track_preference_score
ON user_track_preference(
  user_id,
  preference_score DESC
);
CREATE INDEX idx_user_track_preference_recent
ON user_track_preference(
  user_id,
  last_played_at DESC
);
CREATE TABLE user_artist_preference(
  user_id INTEGER NOT NULL,
  artist_id TEXT NOT NULL,
  positive_weight REAL NOT NULL DEFAULT 0,
  negative_weight REAL NOT NULL DEFAULT 0,
  last_positive_at DATETIME,
  PRIMARY KEY(user_id, artist_id),
  CONSTRAINT user_artist_preference_user_fkey FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX idx_user_artist_preference_score
ON user_artist_preference(
  user_id,
  positive_weight DESC,
  negative_weight ASC
);
CREATE TABLE user_album_preference(
  user_id INTEGER NOT NULL,
  album_id TEXT NOT NULL,
  positive_weight REAL NOT NULL DEFAULT 0,
  negative_weight REAL NOT NULL DEFAULT 0,
  last_positive_at DATETIME,
  PRIMARY KEY(user_id, album_id),
  CONSTRAINT user_album_preference_user_fkey FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE TABLE user_genre_preference(
  user_id INTEGER NOT NULL,
  genre TEXT NOT NULL,
  positive_weight REAL NOT NULL DEFAULT 0,
  negative_weight REAL NOT NULL DEFAULT 0,
  last_positive_at DATETIME,
  PRIMARY KEY(user_id, genre),
  CONSTRAINT user_genre_preference_user_fkey FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE TABLE track_transition(
  user_id INTEGER NOT NULL,
  from_song_id TEXT NOT NULL,
  to_song_id TEXT NOT NULL,
  positive_count INTEGER NOT NULL DEFAULT 0,
  skip_count INTEGER NOT NULL DEFAULT 0,
  last_observed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, from_song_id, to_song_id),
  CONSTRAINT track_transition_user_fkey FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX idx_track_transition_rank
ON track_transition(
  user_id,
  from_song_id,
  positive_count DESC,
  skip_count ASC
);
CREATE TABLE playback_queue(
  id TEXT NOT NULL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  seed_song_id TEXT,
  source TEXT NOT NULL DEFAULT 'radio',
  current_position INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT playback_queue_user_fkey FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX idx_playback_queue_user_updated ON playback_queue(
  user_id,
  updated_at DESC
);
CREATE TABLE playback_queue_item(
  queue_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  song_id TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'generated',
  score REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  played_at DATETIME,
  PRIMARY KEY(queue_id, position),
  CONSTRAINT playback_queue_item_queue_fkey FOREIGN KEY(queue_id) REFERENCES playback_queue(id) ON DELETE CASCADE
);
CREATE INDEX idx_playback_queue_item_song ON playback_queue_item(
  queue_id,
  song_id
);
CREATE INDEX idx_listen_history_user_id_desc
ON listen_history_item(
  user_id,
  id DESC
);
CREATE INDEX idx_favorite_song_user_added_song
ON favorite_song(
  user_id,
  added_at DESC,
  song_id ASC
);
CREATE INDEX idx_playback_event_user_session_type_time
ON playback_event(
  user_id,
  session_id,
  event_type,
  created_at DESC,
  id DESC
);
CREATE TABLE user_data_retention(
  user_id INTEGER NOT NULL PRIMARY KEY,
  playback_events_since_prune INTEGER NOT NULL DEFAULT 0,
  history_events_since_prune INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT user_data_retention_user_fkey
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX idx_scan_job_status_id
ON library_scan_job(status, id DESC);
CREATE TRIGGER prune_completed_scan_jobs
AFTER INSERT ON library_scan_job
BEGIN
    DELETE FROM library_scan_job
    WHERE id IN (
        SELECT id FROM library_scan_job
        WHERE status <> 'running'
        ORDER BY id DESC
        LIMIT -1 OFFSET 100
    );
END;
CREATE INDEX idx_playlist_song_position
ON _playlist_to_song(a, position);
CREATE TRIGGER playlist_song_assign_position
AFTER INSERT ON _playlist_to_song
WHEN NEW.position IS NULL
BEGIN
    UPDATE _playlist_to_song SET position = NEW.rowid WHERE rowid = NEW.rowid;
END;
CREATE TRIGGER playlist_stats_track_insert
AFTER INSERT ON _playlist_to_song
BEGIN
    INSERT INTO playlist_stats(playlist_id, total_duration, song_count, last_calculated)
    VALUES(
        NEW.a,
        COALESCE((SELECT duration_seconds FROM track_entity WHERE id = NEW.b), 0),
        1,
        CURRENT_TIMESTAMP
    )
    ON CONFLICT(playlist_id) DO UPDATE SET
        total_duration = total_duration + excluded.total_duration,
        song_count = song_count + 1,
        last_calculated = CURRENT_TIMESTAMP;
END;
CREATE TRIGGER playlist_stats_track_delete
AFTER DELETE ON _playlist_to_song
BEGIN
    UPDATE playlist_stats SET
        total_duration = MAX(0, total_duration - COALESCE(
            (SELECT duration_seconds FROM track_entity WHERE id = OLD.b), 0
        )),
        song_count = MAX(0, song_count - 1),
        last_calculated = CURRENT_TIMESTAMP
    WHERE playlist_id = OLD.a;
END;
CREATE TRIGGER playlist_stats_duration_update
AFTER UPDATE OF duration_seconds ON track_entity
WHEN NEW.duration_seconds <> OLD.duration_seconds
BEGIN
    UPDATE playlist_stats SET
        total_duration = MAX(0, total_duration + NEW.duration_seconds - OLD.duration_seconds),
        last_calculated = CURRENT_TIMESTAMP
    WHERE playlist_id IN (SELECT a FROM _playlist_to_song WHERE b = NEW.id);
END;
CREATE TABLE cast_session(
  id TEXT NOT NULL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  receiver_id TEXT NOT NULL,
  receiver_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connecting',
  current_position INTEGER NOT NULL DEFAULT 0,
  position_ms INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  playing INTEGER NOT NULL DEFAULT 0,
  volume REAL NOT NULL DEFAULT 1,
  muted INTEGER NOT NULL DEFAULT 0,
  repeat_mode TEXT NOT NULL DEFAULT 'off',
  revision INTEGER NOT NULL DEFAULT 1,
  command TEXT,
  command_position_ms INTEGER,
  command_volume REAL,
  command_muted INTEGER,
  command_queue_position INTEGER,
  command_revision INTEGER NOT NULL DEFAULT 0,
  acknowledged_command_revision INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at INTEGER NOT NULL,
  CONSTRAINT cast_session_user_fkey FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE,
  CONSTRAINT cast_session_status_check CHECK(status IN('connecting', 'playing', 'paused', 'stopped', 'ended', 'failed')),
  CONSTRAINT cast_session_repeat_check CHECK(repeat_mode IN('off', 'one', 'all')),
  CONSTRAINT cast_session_position_check CHECK(current_position >= 0 AND position_ms >= 0 AND duration_ms >= 0),
  CONSTRAINT cast_session_volume_check CHECK(volume >= 0 AND volume <= 1),
  CONSTRAINT cast_session_command_revision_check CHECK(command_revision >= acknowledged_command_revision)
);
CREATE INDEX idx_cast_session_user_updated
ON cast_session(
  user_id,
  updated_at DESC
);
CREATE INDEX idx_cast_session_expiry
ON cast_session(expires_at);
CREATE TABLE cast_session_item(
  session_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  song_id TEXT NOT NULL,
  PRIMARY KEY(session_id, position),
  CONSTRAINT cast_session_item_session_fkey FOREIGN KEY(session_id) REFERENCES cast_session(id) ON DELETE CASCADE
);
CREATE INDEX idx_cast_session_item_song
ON cast_session_item(
  session_id,
  song_id
);
CREATE INDEX idx_file_entry_stable_identity
ON file_entry(
  root_id,
  stable_identity
);
CREATE TABLE directory_scan_state(
  root_id INTEGER NOT NULL,
  directory TEXT NOT NULL,
  audio_file_count INTEGER NOT NULL,
  total_size_bytes INTEGER NOT NULL,
  max_modified_at_ns INTEGER NOT NULL,
  inventory_signature TEXT NOT NULL,
  last_seen_scan_id INTEGER,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(root_id, directory),
  CONSTRAINT directory_scan_state_root_id_fkey
  FOREIGN KEY(root_id) REFERENCES library_root(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT directory_scan_state_last_seen_scan_id_fkey
  FOREIGN KEY(last_seen_scan_id) REFERENCES library_scan_job(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX idx_directory_scan_state_last_seen
ON directory_scan_state(
  root_id,
  last_seen_scan_id
);
CREATE TABLE directory_cover_cache(
  directory TEXT NOT NULL PRIMARY KEY,
  inventory_signature TEXT NOT NULL,
  cover_path TEXT NOT NULL DEFAULT '',
  content_hash TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE artwork_derivative_job(
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  content_hash TEXT NOT NULL,
  source_path TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT artwork_derivative_format_check CHECK(format IN('webp', 'avif')),
  CONSTRAINT artwork_derivative_status_check CHECK(status IN('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT artwork_derivative_unique UNIQUE(content_hash, format)
);
CREATE INDEX idx_artwork_derivative_pending
ON artwork_derivative_job(
  status,
  id
);
CREATE TABLE artist_alias_decision(
  normalized_alias TEXT PRIMARY KEY NOT NULL,
  alias_name TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  canonical_normalized TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;
CREATE TABLE album_inference_cache(
  album_id TEXT PRIMARY KEY NOT NULL,
  evidence_json TEXT NOT NULL,
  presentation_json TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;
CREATE INDEX idx_file_entry_parse_cache
ON file_entry(
  root_id,
  stable_identity,
  size_bytes,
  modified_at_ns
)
WHERE stable_identity IS NOT NULL;
CREATE TABLE duration_repair_queue(
  file_id INTEGER NOT NULL PRIMARY KEY,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
  CHECK(status IN('pending', 'running', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME,
  error TEXT,
  FOREIGN KEY(file_id) REFERENCES file_entry(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_duration_repair_queue_pending
ON duration_repair_queue(
  status,
  requested_at
);
CREATE TABLE music_file_reference(
  core_file_id TEXT NOT NULL PRIMARY KEY,
  core_library_id TEXT NOT NULL,
  path TEXT NOT NULL,
  last_seen_scan_id INTEGER NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(core_library_id, path),
  CONSTRAINT music_file_reference_scan_fkey
  FOREIGN KEY(last_seen_scan_id) REFERENCES library_scan_job(id) ON DELETE CASCADE
);
CREATE INDEX idx_music_file_reference_library
ON music_file_reference(
  core_library_id
);
CREATE INDEX idx_music_file_reference_scan
ON music_file_reference(
  last_seen_scan_id
);
CREATE INDEX idx_file_entry_root_availability
ON file_entry(
  root_id,
  availability,
  path
);
CREATE INDEX idx_album_entity_artwork
ON album_entity(
  artwork_id
) WHERE artwork_id IS NOT NULL;
CREATE INDEX idx_artist_entity_artwork
ON artist_entity(
  artwork_id
) WHERE artwork_id IS NOT NULL;
