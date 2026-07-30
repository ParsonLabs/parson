CREATE TABLE refresh_session (
  id TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT refresh_session_user_fkey
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX refresh_session_user_expiry_idx
  ON refresh_session(user_id, expires_at);

CREATE TABLE user_data_change_state (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO user_data_change_state(singleton) VALUES (1);

CREATE TRIGGER user_data_changed_user_insert AFTER INSERT ON user BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_user_update AFTER UPDATE ON user BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_user_delete AFTER DELETE ON user BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;

CREATE TRIGGER user_data_changed_playlist_insert AFTER INSERT ON playlist BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_playlist_update AFTER UPDATE ON playlist BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_playlist_delete AFTER DELETE ON playlist BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;

CREATE TRIGGER user_data_changed_playlist_user_insert AFTER INSERT ON _playlist_to_user BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_playlist_user_update AFTER UPDATE ON _playlist_to_user BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_playlist_user_delete AFTER DELETE ON _playlist_to_user BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;

CREATE TRIGGER user_data_changed_playlist_song_insert AFTER INSERT ON _playlist_to_song BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_playlist_song_update AFTER UPDATE ON _playlist_to_song BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_playlist_song_delete AFTER DELETE ON _playlist_to_song BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;

CREATE TRIGGER user_data_changed_favorite_insert AFTER INSERT ON favorite_song BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_favorite_delete AFTER DELETE ON favorite_song BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;

CREATE TRIGGER user_data_changed_listen_insert AFTER INSERT ON listen_history_item BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_listen_delete AFTER DELETE ON listen_history_item BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;

CREATE TRIGGER user_data_changed_search_insert AFTER INSERT ON search_item BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_search_delete AFTER DELETE ON search_item BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;

CREATE TRIGGER user_data_changed_follow_insert AFTER INSERT ON follow BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_follow_delete AFTER DELETE ON follow BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;

CREATE TRIGGER user_data_changed_lyrics_contribution_insert AFTER INSERT ON lyrics_contribution BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_lyrics_contribution_update AFTER UPDATE ON lyrics_contribution BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_lyrics_contribution_delete AFTER DELETE ON lyrics_contribution BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;

CREATE TRIGGER user_data_changed_metadata_override_insert AFTER INSERT ON metadata_override BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_metadata_override_update AFTER UPDATE ON metadata_override BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
CREATE TRIGGER user_data_changed_metadata_override_delete AFTER DELETE ON metadata_override BEGIN
  UPDATE user_data_change_state SET revision = revision + 1, changed_at = CURRENT_TIMESTAMP WHERE singleton = 1;
END;
