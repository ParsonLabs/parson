PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS "user" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT,
    "username" TEXT NOT NULL UNIQUE,
    "password" TEXT NOT NULL,
    "image" TEXT,
    "bitrate" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "now_playing" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS "search_item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "search" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "search_item_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "listen_history_item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "song_id" TEXT NOT NULL,
    "listened_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "listen_history_item_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "follow" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "follower_id" INTEGER NOT NULL,
    "following_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "follow_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "follow_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "playlist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cover_image" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "song" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "_playlist_to_user" (
    "a" INTEGER NOT NULL,
    "b" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'collaborator',
    "joined_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "_playlist_to_user_a_fkey" FOREIGN KEY ("a") REFERENCES "playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_playlist_to_user_b_fkey" FOREIGN KEY ("b") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "_playlist_to_song" (
    "a" INTEGER NOT NULL,
    "b" TEXT NOT NULL,
    "date_added" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "added_by" INTEGER,
    "position" INTEGER,
    CONSTRAINT "_playlist_to_song_a_fkey" FOREIGN KEY ("a") REFERENCES "playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_playlist_to_song_b_fkey" FOREIGN KEY ("b") REFERENCES "song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_playlist_to_song_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "server_info" (
    "local_address" TEXT NOT NULL,
    "server_name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "startup_wizard_completed" BOOLEAN NOT NULL DEFAULT FALSE,
    "login_disclaimer" TEXT,
    CONSTRAINT unique_server_info UNIQUE ("server_name", "local_address")
);

CREATE TABLE IF NOT EXISTS "genre" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS "_song_to_genre" (
    "song_id" TEXT NOT NULL,
    "genre_id" INTEGER NOT NULL,
    CONSTRAINT "_song_to_genre_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_song_to_genre_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "genre" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "favorite_song" (
    "user_id" INTEGER NOT NULL,
    "song_id" TEXT NOT NULL,
    "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("user_id", "song_id"),
    CONSTRAINT "favorite_song_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "favorite_song_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "playlist_stats" (
    "playlist_id" INTEGER NOT NULL PRIMARY KEY,
    "total_duration" REAL NOT NULL DEFAULT 0,
    "song_count" INTEGER NOT NULL DEFAULT 0,
    "most_common_genre" TEXT,
    "last_calculated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "playlist_stats_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "lyrics" (
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
    CONSTRAINT "lyrics_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "lyrics_contribution" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "lyrics_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "plain_lyrics" TEXT,
    "synced_lyrics" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lyrics_contribution_lyrics_id_fkey" FOREIGN KEY ("lyrics_id") REFERENCES "lyrics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lyrics_contribution_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "lyrics_view_history" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "song_id" TEXT NOT NULL,
    "viewed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lyrics_view_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lyrics_view_history_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_username_key" ON "user"("username");
CREATE INDEX "idx_listen_history_user" ON "listen_history_item"("user_id");
CREATE INDEX "idx_listen_history_song" ON "listen_history_item"("song_id");
CREATE UNIQUE INDEX "follow_follower_id_following_id_key" ON "follow"("follower_id", "following_id");
CREATE INDEX "idx_playlist_public" ON "playlist"("is_public");
CREATE UNIQUE INDEX "_playlist_to_user_a_b_unique" ON "_playlist_to_user"("a", "b");
CREATE INDEX "_playlist_to_user_b_index" ON "_playlist_to_user"("b");
CREATE INDEX "_playlist_to_user_role_index" ON "_playlist_to_user"("role");
CREATE UNIQUE INDEX "_playlist_to_song_a_b_unique" ON "_playlist_to_song"("a", "b");
CREATE INDEX "_playlist_to_song_b_index" ON "_playlist_to_song"("b");
CREATE INDEX "_playlist_to_song_position_index" ON "_playlist_to_song"("position");
CREATE UNIQUE INDEX "_song_to_genre_song_genre_unique" ON "_song_to_genre"("song_id", "genre_id");
CREATE INDEX "idx_favorite_song_user" ON "favorite_song"("user_id");
CREATE INDEX "idx_lyrics_song_id" ON "lyrics"("song_id");
CREATE INDEX "idx_lyrics_language" ON "lyrics"("language");
CREATE INDEX "idx_lyrics_view_count" ON "lyrics"("view_count" DESC);
CREATE INDEX "idx_lyrics_contribution_lyrics_id" ON "lyrics_contribution"("lyrics_id");
CREATE INDEX "idx_lyrics_contribution_user_id" ON "lyrics_contribution"("user_id");
CREATE INDEX "idx_lyrics_contribution_status" ON "lyrics_contribution"("status");
CREATE INDEX "idx_lyrics_view_history_user_id" ON "lyrics_view_history"("user_id");
CREATE INDEX "idx_lyrics_view_history_song_id" ON "lyrics_view_history"("song_id");

PRAGMA foreign_key_check;