-- Drop Indexes
DROP INDEX IF EXISTS "user_username_key";
DROP INDEX IF EXISTS "idx_listen_history_user";
DROP INDEX IF EXISTS "follow_follower_id_following_id_key";
DROP INDEX IF EXISTS "_playlist_to_user_a_b_unique";
DROP INDEX IF EXISTS "_playlist_to_user_b_index";
DROP INDEX IF EXISTS "_playlist_to_song_a_b_unique";
DROP INDEX IF EXISTS "_playlist_to_song_b_index";

-- Drop Tables
DROP TABLE IF EXISTS "server_info";
DROP TABLE IF EXISTS "session";
DROP TABLE IF EXISTS "account";
DROP TABLE IF EXISTS "_playlist_to_song";
DROP TABLE IF EXISTS "_playlist_to_user";
DROP TABLE IF EXISTS "listen_history_item";
DROP TABLE IF EXISTS "search_item";
DROP TABLE IF EXISTS "follow";
DROP TABLE IF EXISTS "playlist";
DROP TABLE IF EXISTS "song";
DROP TABLE IF EXISTS "user";