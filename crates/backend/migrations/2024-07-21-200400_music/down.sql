-- Drop Indexes
DROP INDEX IF EXISTS "user_username_key";
DROP INDEX IF EXISTS "idx_listen_history_user";
DROP INDEX IF EXISTS "idx_listen_history_song";
DROP INDEX IF EXISTS "follow_follower_id_following_id_key";
DROP INDEX IF EXISTS "idx_playlist_public";
DROP INDEX IF EXISTS "_playlist_to_user_a_b_unique";
DROP INDEX IF EXISTS "_playlist_to_user_b_index";
DROP INDEX IF EXISTS "_playlist_to_user_role_index";
DROP INDEX IF EXISTS "_playlist_to_song_a_b_unique";
DROP INDEX IF EXISTS "_playlist_to_song_b_index";
DROP INDEX IF EXISTS "_playlist_to_song_position_index";
DROP INDEX IF EXISTS "_song_to_genre_song_genre_unique";
DROP INDEX IF EXISTS "idx_favorite_song_user";
DROP INDEX IF EXISTS "idx_lyrics_song_id";
DROP INDEX IF EXISTS "idx_lyrics_language";
DROP INDEX IF EXISTS "idx_lyrics_view_count";
DROP INDEX IF EXISTS "idx_lyrics_contribution_lyrics_id";
DROP INDEX IF EXISTS "idx_lyrics_contribution_user_id";
DROP INDEX IF EXISTS "idx_lyrics_contribution_status";
DROP INDEX IF EXISTS "idx_lyrics_view_history_user_id";
DROP INDEX IF EXISTS "idx_lyrics_view_history_song_id";

DROP TRIGGER IF EXISTS lyrics_ai;
DROP TRIGGER IF EXISTS lyrics_au;
DROP TRIGGER IF EXISTS lyrics_ad;

DROP TABLE IF EXISTS "lyrics_fts";

DROP TABLE IF EXISTS "lyrics_view_history";
DROP TABLE IF EXISTS "lyrics_contribution";
DROP TABLE IF EXISTS "lyrics";
DROP TABLE IF EXISTS "playlist_stats";
DROP TABLE IF EXISTS "favorite_song";
DROP TABLE IF EXISTS "_song_to_genre";
DROP TABLE IF EXISTS "genre";
DROP TABLE IF EXISTS "server_info";
DROP TABLE IF EXISTS "_playlist_to_song";
DROP TABLE IF EXISTS "_playlist_to_user";
DROP TABLE IF EXISTS "playlist";
DROP TABLE IF EXISTS "song";
DROP TABLE IF EXISTS "follow";
DROP TABLE IF EXISTS "listen_history_item";
DROP TABLE IF EXISTS "search_item";
DROP TABLE IF EXISTS "user";