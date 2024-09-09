use chrono::NaiveDateTime;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use super::schema::{
    follow, listen_history_item, playlist, search_item, server_info, song,
    user, _playlist_to_song, _playlist_to_user,
};

#[derive(Insertable, Queryable, Selectable, Debug, Serialize, Deserialize)]
#[diesel(table_name = user)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct User {
    pub id: i32,
    pub name: Option<String>,
    pub username: String,
    pub password: String,
    pub image: Option<String>,
    pub bitrate: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub now_playing: Option<String>,
    pub role: String
}

#[derive(Insertable)]
#[diesel(table_name = user)]
pub struct NewUser {
    pub username: String,
    pub password: String,
    pub role: String,
}

#[derive(Insertable, Queryable, Associations, Identifiable, Debug)]
#[diesel(table_name = search_item)]
#[diesel(belongs_to(User, foreign_key = user_id))]
pub struct SearchItem {
    pub id: i32,
    pub user_id: i32,
    pub search: String,
    pub created_at: NaiveDateTime,
}

#[derive(Insertable)]
#[diesel(table_name = search_item)]
pub struct NewSearchItem {
    pub user_id: i32,
    pub search: String,
}

#[derive(Insertable, Queryable, Associations, Identifiable, Debug, Serialize)]
#[diesel(table_name = listen_history_item)]
#[diesel(belongs_to(User, foreign_key = user_id))]
#[diesel(belongs_to(Song, foreign_key = song_id))]
pub struct ListenHistoryItem {
    pub id: i32,
    pub user_id: i32,
    pub song_id: String,
    pub listened_at: NaiveDateTime,
}

#[derive(Insertable)]
#[diesel(table_name = listen_history_item)]
pub struct NewListenHistoryItem {
    pub user_id: i32,
    pub song_id: String,
}

#[derive(Insertable, Queryable, Identifiable, Debug)]
#[diesel(table_name = follow)]
pub struct Follow {
    pub id: i32,
    pub follower_id: i32,
    pub following_id: i32,
}

#[derive(Insertable)]
#[diesel(table_name = follow)]
pub struct NewFollow {
    pub follower_id: i32,
    pub following_id: i32,
}

#[derive(Insertable, Queryable, Identifiable, Debug, Serialize)]
#[diesel(table_name = playlist)]
pub struct Playlist {
    pub id: i32,
    pub name: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Insertable)]
#[diesel(table_name = playlist)]
pub struct NewPlaylist {
    pub name: String,
}

#[derive(Insertable, Queryable, Identifiable, Debug)]
#[diesel(table_name = song)]
pub struct Song {
    pub id: String,
}

#[derive(Insertable, Queryable, Associations, Debug)]
#[diesel(table_name = _playlist_to_user)]
#[diesel(belongs_to(Playlist, foreign_key = a))]
#[diesel(belongs_to(User, foreign_key = b))]
pub struct PlaylistToUser {
    pub a: i32,
    pub b: i32,
}

#[derive(Insertable, Queryable, Associations, Selectable, Debug)]
#[diesel(table_name = _playlist_to_song)]
#[diesel(belongs_to(Playlist, foreign_key = a))]
#[diesel(belongs_to(Song, foreign_key = b))]
pub struct PlaylistToSong {
    pub a: i32,
    pub b: String,
    pub date_added: NaiveDateTime,
}

#[derive(Queryable, Selectable, Serialize, Deserialize, Insertable, AsChangeset)]
#[diesel(table_name = server_info)]
pub struct ServerInfo {
    pub local_address: String,
    pub server_name: String,
    pub version: String,
    pub product_name: String,
    pub startup_wizard_completed: bool,
    pub login_disclaimer: Option<String>,
}