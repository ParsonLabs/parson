// @generated automatically by Diesel CLI.

diesel::table! {
    _playlist_to_song (rowid) {
        rowid -> Integer,
        a -> Integer,
        b -> Text,
        date_added -> Timestamp,
    }
}

diesel::table! {
    _playlist_to_user (rowid) {
        rowid -> Integer,
        a -> Integer,
        b -> Integer,
    }
}

diesel::table! {
    follow (id) {
        id -> Integer,
        follower_id -> Integer,
        following_id -> Integer,
    }
}

diesel::table! {
    listen_history_item (id) {
        id -> Integer,
        user_id -> Integer,
        song_id -> Text,
        listened_at -> Timestamp,
    }
}

diesel::table! {
    playlist (id) {
        id -> Integer,
        name -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    search_item (id) {
        id -> Integer,
        user_id -> Integer,
        search -> Text,
        created_at -> Timestamp,
    }
}

diesel::table! {
    server_info (rowid) {
        rowid -> Integer,
        local_address -> Text,
        server_name -> Text,
        version -> Text,
        product_name -> Text,
        startup_wizard_completed -> Bool,
        login_disclaimer -> Nullable<Text>,
    }
}

diesel::table! {
    song (id) {
        id -> Text,
    }
}

diesel::table! {
    user (id) {
        id -> Integer,
        name -> Nullable<Text>,
        username -> Text,
        password -> Text,
        image -> Nullable<Text>,
        bitrate -> Integer,
        created_at -> Timestamp,
        updated_at -> Timestamp,
        now_playing -> Nullable<Text>,
        role -> Text,
    }
}

diesel::joinable!(_playlist_to_song -> playlist (a));
diesel::joinable!(_playlist_to_song -> song (b));
diesel::joinable!(_playlist_to_user -> playlist (a));
diesel::joinable!(_playlist_to_user -> user (b));
diesel::joinable!(listen_history_item -> user (user_id));
diesel::joinable!(search_item -> user (user_id));

diesel::allow_tables_to_appear_in_same_query!(
    _playlist_to_song,
    _playlist_to_user,
    follow,
    listen_history_item,
    playlist,
    search_item,
    server_info,
    song,
    user,
);
