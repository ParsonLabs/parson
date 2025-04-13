// @generated automatically by Diesel CLI.

diesel::table! {
    _playlist_to_song (rowid) {
        rowid -> Integer,
        a -> Integer,
        b -> Text,
        date_added -> Timestamp,
        added_by -> Nullable<Integer>,
        position -> Nullable<Integer>,
    }
}

diesel::table! {
    _playlist_to_user (rowid) {
        rowid -> Integer,
        a -> Integer,
        b -> Integer,
        role -> Text,
        joined_at -> Timestamp,
    }
}

diesel::table! {
    _song_to_genre (rowid) {
        rowid -> Integer,
        song_id -> Text,
        genre_id -> Integer,
    }
}

diesel::table! {
    favorite_song (user_id, song_id) {
        user_id -> Integer,
        song_id -> Text,
        added_at -> Timestamp,
    }
}

diesel::table! {
    follow (id) {
        id -> Integer,
        follower_id -> Integer,
        following_id -> Integer,
        created_at -> Timestamp,
    }
}

diesel::table! {
    genre (id) {
        id -> Integer,
        name -> Text,
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
    lyrics (id) {
        id -> Integer,
        song_id -> Text,
        plain_lyrics -> Nullable<Text>,
        synced_lyrics -> Nullable<Text>,
        source -> Nullable<Text>,
        created_at -> Timestamp,
        updated_at -> Timestamp,
        language -> Text,
        is_verified -> Bool,
        view_count -> Integer,
    }
}

diesel::table! {
    lyrics_contribution (id) {
        id -> Integer,
        lyrics_id -> Integer,
        user_id -> Integer,
        plain_lyrics -> Nullable<Text>,
        synced_lyrics -> Nullable<Text>,
        status -> Text,
        created_at -> Timestamp,
    }
}

diesel::table! {
    lyrics_view_history (id) {
        id -> Integer,
        user_id -> Integer,
        song_id -> Text,
        viewed_at -> Timestamp,
    }
}

diesel::table! {
    playlist (id) {
        id -> Integer,
        name -> Text,
        description -> Nullable<Text>,
        cover_image -> Nullable<Text>,
        is_public -> Bool,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    playlist_stats (playlist_id) {
        playlist_id -> Integer,
        total_duration -> Float,
        song_count -> Integer,
        most_common_genre -> Nullable<Text>,
        last_calculated -> Timestamp,
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
        added_at -> Timestamp,
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
diesel::joinable!(_playlist_to_song -> user (added_by));
diesel::joinable!(_playlist_to_user -> playlist (a));
diesel::joinable!(_playlist_to_user -> user (b));
diesel::joinable!(_song_to_genre -> genre (genre_id));
diesel::joinable!(_song_to_genre -> song (song_id));
diesel::joinable!(favorite_song -> song (song_id));
diesel::joinable!(favorite_song -> user (user_id));
diesel::joinable!(listen_history_item -> user (user_id));
diesel::joinable!(lyrics -> song (song_id));
diesel::joinable!(lyrics_contribution -> lyrics (lyrics_id));
diesel::joinable!(lyrics_contribution -> user (user_id));
diesel::joinable!(lyrics_view_history -> song (song_id));
diesel::joinable!(lyrics_view_history -> user (user_id));
diesel::joinable!(playlist_stats -> playlist (playlist_id));
diesel::joinable!(search_item -> user (user_id));

diesel::allow_tables_to_appear_in_same_query!(
    _playlist_to_song,
    _playlist_to_user,
    _song_to_genre,
    favorite_song,
    follow,
    genre,
    listen_history_item,
    lyrics,
    lyrics_contribution,
    lyrics_view_history,
    playlist,
    playlist_stats,
    search_item,
    server_info,
    song,
    user,
);
