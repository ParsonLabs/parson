-- CreateTable
CREATE TABLE IF NOT EXISTS "search_item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "search" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "search_item_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "listen_history_item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "song_id" TEXT NOT NULL,
    "listened_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "listen_history_item_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "follow" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "follower_id" INTEGER NOT NULL,
    "following_id" INTEGER NOT NULL,
    CONSTRAINT "follow_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "follow_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "playlist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "song" (
    "id" TEXT NOT NULL PRIMARY KEY
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "_playlist_to_user" (
    "a" INTEGER NOT NULL,
    "b" INTEGER NOT NULL,
    CONSTRAINT "_playlist_to_user_a_fkey" FOREIGN KEY ("a") REFERENCES "playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_playlist_to_user_b_fkey" FOREIGN KEY ("b") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "_playlist_to_song" (
    "a" INTEGER NOT NULL,
    "b" TEXT NOT NULL,
    "date_added" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "_playlist_to_song_a_fkey" FOREIGN KEY ("a") REFERENCES "playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_playlist_to_song_b_fkey" FOREIGN KEY ("b") REFERENCES "song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);


-- User Table
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

-- Server Info Table
CREATE TABLE IF NOT EXISTS "server_info" (
    "local_address" TEXT NOT NULL,
    "server_name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "startup_wizard_completed" BOOLEAN NOT NULL DEFAULT FALSE,
    "login_disclaimer" TEXT,
    CONSTRAINT unique_server_info UNIQUE ("server_name", "local_address")
);

CREATE UNIQUE INDEX "user_username_key" ON "user"("username");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

-- CreateIndex
CREATE INDEX "idx_listen_history_user" ON "listen_history_item"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "follow_follower_id_following_id_key" ON "follow"("follower_id", "following_id");

-- CreateIndex
CREATE UNIQUE INDEX "_playlist_to_user_a_b_unique" ON "_playlist_to_user"("a", "b");

-- CreateIndex
CREATE INDEX "_playlist_to_user_b_index" ON "_playlist_to_user"("b");

-- CreateIndex
CREATE UNIQUE INDEX "_playlist_to_song_a_b_unique" ON "_playlist_to_song"("a", "b");

-- CreateIndex
CREATE INDEX "_playlist_to_song_b_index" ON "_playlist_to_song"("b");