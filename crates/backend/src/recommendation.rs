use std::collections::{HashMap, HashSet};

use diesel::deserialize::QueryableByName;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Double, Nullable, Text};
use serde::{Deserialize, Serialize};

use crate::library::state::LibraryCache;
use crate::persistence::connection::DbPool;

const MAX_PROFILE_TRACKS: i64 = 250;
const MAX_PROFILE_ARTISTS: i64 = 24;
const MAX_TRANSITIONS: i64 = 80;
const RECENT_EXCLUSION_COUNT: i64 = 40;
const MAX_PLAYBACK_EVENTS_PER_USER: i64 = 20_000;
const MAX_LISTEN_HISTORY_PER_USER: i64 = 20_000;
/// Maximum events accepted before ordered retention runs.
const RETENTION_BATCH_SIZE: i32 = 256;
const MAX_EVENT_REFERENCE_CHARACTERS: usize = 160;
const MAX_EVENT_SOURCE_CHARACTERS: usize = 64;

#[derive(Clone, Debug, Deserialize)]
pub struct PlaybackEventRequest {
    pub event_key: String,
    pub song_id: String,
    pub event_type: String,
    pub session_id: Option<String>,
    pub queue_id: Option<String>,
    pub source: Option<String>,
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct PlaybackEventResult {
    pub accepted: bool,
    pub qualified: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct RankedCandidate {
    pub song_id: String,
    pub score: f64,
    pub reason: String,
}

#[derive(QueryableByName)]
struct TrackPreferenceRow {
    #[diesel(sql_type = Text)]
    song_id: String,
    #[diesel(sql_type = Double)]
    preference_score: f64,
}

#[derive(QueryableByName)]
struct ArtistPreferenceRow {
    #[diesel(sql_type = Text)]
    artist_id: String,
    #[diesel(sql_type = Double)]
    score: f64,
}

#[derive(QueryableByName)]
struct GenrePreferenceRow {
    #[diesel(sql_type = Text)]
    genre: String,
    #[diesel(sql_type = Double)]
    score: f64,
}

#[derive(QueryableByName)]
struct AlbumPreferenceRow {
    #[diesel(sql_type = Text)]
    album_id: String,
    #[diesel(sql_type = Double)]
    score: f64,
}

#[derive(QueryableByName)]
struct TransitionRow {
    #[diesel(sql_type = Text)]
    song_id: String,
    #[diesel(sql_type = Double)]
    score: f64,
}

#[derive(QueryableByName)]
struct SongIdRow {
    #[diesel(sql_type = Text)]
    song_id: String,
}

#[derive(QueryableByName)]
struct PreviousSongRow {
    #[diesel(sql_type = Text)]
    song_id: String,
}

#[derive(QueryableByName)]
struct CountRow {
    #[diesel(sql_type = BigInt)]
    count: i64,
}

#[derive(QueryableByName)]
struct RetentionCounterRow {
    #[diesel(sql_type = diesel::sql_types::Integer)]
    playback_events_since_prune: i32,
    #[diesel(sql_type = diesel::sql_types::Integer)]
    history_events_since_prune: i32,
}

fn valid_event_type(value: &str) -> bool {
    matches!(
        value,
        "play_started"
            | "manual_selection"
            | "qualified_play"
            | "completed"
            | "early_skip"
            | "manual_queue_add"
            | "playlist_add"
            | "recommendation_impression"
            | "recommendation_selected"
            | "disliked"
    )
}

fn event_weight(event_type: &str) -> f64 {
    match event_type {
        "qualified_play" => 3.0,
        "completed" => 4.0,
        "manual_queue_add" => 6.0,
        "playlist_add" => 8.0,
        "recommendation_selected" => 2.0,
        "manual_selection" => 2.0,
        "early_skip" => -5.0,
        "disliked" => -20.0,
        _ => 0.0,
    }
}

fn is_positive(event_type: &str) -> bool {
    matches!(
        event_type,
        "qualified_play" | "completed" | "manual_queue_add" | "playlist_add"
    )
}

pub fn record_playback_event(
    user_id: i32,
    event: &PlaybackEventRequest,
    cache: &LibraryCache,
    pool: &DbPool,
) -> Result<PlaybackEventResult, Box<dyn std::error::Error>> {
    validate_playback_event(event, cache)?;
    let mut connection = pool.get()?;
    connection.transaction::<PlaybackEventResult, Box<dyn std::error::Error>, _>(|connection| {
        persist_playback_event(connection, user_id, event, cache)
    })
}

fn validate_playback_event(
    event: &PlaybackEventRequest,
    cache: &LibraryCache,
) -> Result<(), Box<dyn std::error::Error>> {
    if event.event_key.trim().is_empty() || event.event_key.len() > 160 {
        return Err("event_key must contain between 1 and 160 characters".into());
    }
    if !valid_event_type(&event.event_type) {
        return Err("unsupported playback event type".into());
    }
    if event.song_id.is_empty()
        || event.song_id.chars().count() > MAX_EVENT_REFERENCE_CHARACTERS
        || event.session_id.as_deref().is_some_and(|value| {
            value.is_empty() || value.chars().count() > MAX_EVENT_REFERENCE_CHARACTERS
        })
        || event
            .queue_id
            .as_deref()
            .is_some_and(|value| uuid::Uuid::parse_str(value).is_err())
        || event.source.as_deref().is_some_and(|value| {
            value.trim().is_empty() || value.chars().count() > MAX_EVENT_SOURCE_CHARACTERS
        })
        || event
            .position_seconds
            .is_some_and(|value| !value.is_finite() || value < 0.0)
        || event
            .duration_seconds
            .is_some_and(|value| !value.is_finite() || value < 0.0)
    {
        return Err("playback event contains an invalid or oversized field".into());
    }
    if cache.song(&event.song_id).is_none() {
        return Err("song is not present in the indexed library".into());
    }

    Ok(())
}

fn persist_playback_event(
    connection: &mut SqliteConnection,
    user_id: i32,
    event: &PlaybackEventRequest,
    cache: &LibraryCache,
) -> Result<PlaybackEventResult, Box<dyn std::error::Error>> {
    let previous = if is_positive(&event.event_type) || event.event_type == "early_skip" {
        event.session_id.as_ref().and_then(|session_id| {
            diesel::sql_query(
                "SELECT song_id FROM playback_event
                 WHERE user_id = ? AND session_id = ?
                   AND event_type IN ('qualified_play', 'completed') AND song_id <> ?
                 ORDER BY created_at DESC, id DESC LIMIT 1",
            )
            .bind::<diesel::sql_types::Integer, _>(user_id)
            .bind::<Text, _>(session_id)
            .bind::<Text, _>(&event.song_id)
            .get_result::<PreviousSongRow>(connection)
            .optional()
            .ok()
            .flatten()
            .map(|row| row.song_id)
        })
    } else {
        None
    };

    let inserted = diesel::sql_query(
        "INSERT OR IGNORE INTO playback_event
         (event_key, user_id, song_id, event_type, session_id, queue_id, source,
          position_seconds, duration_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind::<Text, _>(event.event_key.trim())
    .bind::<diesel::sql_types::Integer, _>(user_id)
    .bind::<Text, _>(&event.song_id)
    .bind::<Text, _>(&event.event_type)
    .bind::<Nullable<Text>, _>(event.session_id.as_deref())
    .bind::<Nullable<Text>, _>(event.queue_id.as_deref())
    .bind::<Text, _>(event.source.as_deref().unwrap_or("unknown"))
    .bind::<Double, _>(event.position_seconds.unwrap_or(0.0).max(0.0))
    .bind::<Double, _>(event.duration_seconds.unwrap_or(0.0).max(0.0))
    .execute(connection)?;

    if inserted == 0 {
        return Ok(PlaybackEventResult {
            accepted: false,
            qualified: is_positive(&event.event_type),
        });
    }

    if matches!(
        event.event_type.as_str(),
        "play_started" | "manual_selection"
    ) {
        diesel::sql_query("UPDATE user SET now_playing = ? WHERE id = ?")
            .bind::<Text, _>(&event.song_id)
            .bind::<diesel::sql_types::Integer, _>(user_id)
            .execute(connection)?;

        if let Some(queue_id) = event.queue_id.as_deref() {
            diesel::sql_query(
                "UPDATE playback_queue
                 SET current_position = COALESCE((
                       SELECT position FROM playback_queue_item
                       WHERE queue_id = ? AND song_id = ? LIMIT 1
                     ), current_position),
                     revision = revision + 1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND user_id = ?",
            )
            .bind::<Text, _>(queue_id)
            .bind::<Text, _>(&event.song_id)
            .bind::<Text, _>(queue_id)
            .bind::<diesel::sql_types::Integer, _>(user_id)
            .execute(connection)?;
        }
    }

    if event.event_type == "qualified_play" {
        diesel::sql_query(
            "INSERT INTO listen_history_item (user_id, song_id, listened_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)",
        )
        .bind::<diesel::sql_types::Integer, _>(user_id)
        .bind::<Text, _>(&event.song_id)
        .execute(connection)?;
    }

    let weight = event_weight(&event.event_type);
    if weight != 0.0 {
        let qualified = i32::from(event.event_type == "qualified_play");
        let completed = i32::from(event.event_type == "completed");
        let skipped = i32::from(matches!(
            event.event_type.as_str(),
            "early_skip" | "disliked"
        ));
        let queued = i32::from(event.event_type == "manual_queue_add");
        let playlist = i32::from(event.event_type == "playlist_add");
        diesel::sql_query(
            "INSERT INTO user_track_preference
             (user_id, song_id, qualified_plays, completions, early_skips,
              manual_queue_adds, playlist_adds, preference_score, last_positive_at, last_played_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?,
                     CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE NULL END,
                     CASE WHEN ? IN ('manual_selection', 'qualified_play', 'completed', 'early_skip') THEN CURRENT_TIMESTAMP ELSE NULL END)
             ON CONFLICT(user_id, song_id) DO UPDATE SET
               qualified_plays = qualified_plays + excluded.qualified_plays,
               completions = completions + excluded.completions,
               early_skips = early_skips + excluded.early_skips,
               manual_queue_adds = manual_queue_adds + excluded.manual_queue_adds,
               playlist_adds = playlist_adds + excluded.playlist_adds,
               preference_score = preference_score + excluded.preference_score,
               last_positive_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE last_positive_at END,
               last_played_at = CASE WHEN ? IN ('manual_selection', 'qualified_play', 'completed', 'early_skip')
                                     THEN CURRENT_TIMESTAMP ELSE last_played_at END",
        )
        .bind::<diesel::sql_types::Integer, _>(user_id)
        .bind::<Text, _>(&event.song_id)
        .bind::<diesel::sql_types::Integer, _>(qualified)
        .bind::<diesel::sql_types::Integer, _>(completed)
        .bind::<diesel::sql_types::Integer, _>(skipped)
        .bind::<diesel::sql_types::Integer, _>(queued)
        .bind::<diesel::sql_types::Integer, _>(playlist)
        .bind::<Double, _>(weight)
        .bind::<Double, _>(weight)
        .bind::<Text, _>(&event.event_type)
        .bind::<Double, _>(weight)
        .bind::<Text, _>(&event.event_type)
        .execute(connection)?;

        if let Some((artist_id, album_id)) = cache.song_map.get(&event.song_id) {
            let positive = weight.max(0.0);
            let negative = (-weight).max(0.0);
            upsert_entity_preference(
                connection,
                "user_artist_preference",
                "artist_id",
                user_id,
                artist_id,
                positive,
                negative,
            )?;
            upsert_entity_preference(
                connection,
                "user_album_preference",
                "album_id",
                user_id,
                album_id,
                positive,
                negative,
            )?;
            for genre in cache.album_genres.get(album_id).into_iter().flatten() {
                upsert_entity_preference(
                    connection,
                    "user_genre_preference",
                    "genre",
                    user_id,
                    genre,
                    positive,
                    negative,
                )?;
            }
        }
    }

    if let Some(from_song) = previous.filter(|song| song != &event.song_id) {
        let (positive, skipped) = if event.event_type == "early_skip" {
            (0, 1)
        } else {
            (1, 0)
        };
        diesel::sql_query(
            "INSERT INTO track_transition
             (user_id, from_song_id, to_song_id, positive_count, skip_count, last_observed_at)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, from_song_id, to_song_id) DO UPDATE SET
               positive_count = positive_count + excluded.positive_count,
               skip_count = skip_count + excluded.skip_count,
               last_observed_at = CURRENT_TIMESTAMP",
        )
        .bind::<diesel::sql_types::Integer, _>(user_id)
        .bind::<Text, _>(&from_song)
        .bind::<Text, _>(&event.song_id)
        .bind::<diesel::sql_types::Integer, _>(positive)
        .bind::<diesel::sql_types::Integer, _>(skipped)
        .execute(connection)?;
        diesel::sql_query(
            "DELETE FROM track_transition
             WHERE user_id = ? AND from_song_id = ? AND to_song_id IN (
               SELECT to_song_id FROM track_transition
               WHERE user_id = ? AND from_song_id = ?
               ORDER BY (positive_count * 2 - skip_count) DESC, last_observed_at DESC
               LIMIT -1 OFFSET 50
             )",
        )
        .bind::<diesel::sql_types::Integer, _>(user_id)
        .bind::<Text, _>(&from_song)
        .bind::<diesel::sql_types::Integer, _>(user_id)
        .bind::<Text, _>(&from_song)
        .execute(connection)?;
    }

    schedule_playback_retention(connection, user_id, event.event_type == "qualified_play")?;

    Ok(PlaybackEventResult {
        accepted: true,
        qualified: is_positive(&event.event_type),
    })
}

fn schedule_playback_retention(
    connection: &mut SqliteConnection,
    user_id: i32,
    include_listen_history: bool,
) -> QueryResult<()> {
    let counters = diesel::sql_query(
        "INSERT INTO user_data_retention
           (user_id, playback_events_since_prune, history_events_since_prune)
         VALUES (?, 1, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           playback_events_since_prune = playback_events_since_prune + 1,
           history_events_since_prune = history_events_since_prune + excluded.history_events_since_prune
         RETURNING playback_events_since_prune, history_events_since_prune",
    )
    .bind::<diesel::sql_types::Integer, _>(user_id)
    .bind::<diesel::sql_types::Integer, _>(i32::from(include_listen_history))
    .get_result::<RetentionCounterRow>(connection)?;

    let prune_playback = counters.playback_events_since_prune >= RETENTION_BATCH_SIZE;
    let prune_history = counters.history_events_since_prune >= RETENTION_BATCH_SIZE;
    if prune_playback || prune_history {
        prune_playback_history(connection, user_id, prune_history, prune_playback)?;
        diesel::sql_query(
            "UPDATE user_data_retention SET
               playback_events_since_prune = CASE WHEN ? THEN 0 ELSE playback_events_since_prune END,
               history_events_since_prune = CASE WHEN ? THEN 0 ELSE history_events_since_prune END
             WHERE user_id = ?",
        )
        .bind::<diesel::sql_types::Bool, _>(prune_playback)
        .bind::<diesel::sql_types::Bool, _>(prune_history)
        .bind::<diesel::sql_types::Integer, _>(user_id)
        .execute(connection)?;
    }
    Ok(())
}

pub(crate) fn schedule_listen_history_retention(
    connection: &mut SqliteConnection,
    user_id: i32,
) -> QueryResult<()> {
    let counters = diesel::sql_query(
        "INSERT INTO user_data_retention
           (user_id, playback_events_since_prune, history_events_since_prune)
         VALUES (?, 0, 1)
         ON CONFLICT(user_id) DO UPDATE SET
           history_events_since_prune = history_events_since_prune + 1
         RETURNING playback_events_since_prune, history_events_since_prune",
    )
    .bind::<diesel::sql_types::Integer, _>(user_id)
    .get_result::<RetentionCounterRow>(connection)?;
    if counters.history_events_since_prune >= RETENTION_BATCH_SIZE {
        prune_listen_history(connection, user_id)?;
        diesel::sql_query(
            "UPDATE user_data_retention SET history_events_since_prune = 0 WHERE user_id = ?",
        )
        .bind::<diesel::sql_types::Integer, _>(user_id)
        .execute(connection)?;
    }
    Ok(())
}

fn prune_playback_history(
    connection: &mut SqliteConnection,
    user_id: i32,
    include_listen_history: bool,
    include_playback_events: bool,
) -> QueryResult<()> {
    if include_playback_events {
        diesel::sql_query(
            "DELETE FROM playback_event WHERE user_id = ? AND id IN (
               SELECT id FROM playback_event WHERE user_id = ?
               ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?
             )",
        )
        .bind::<diesel::sql_types::Integer, _>(user_id)
        .bind::<diesel::sql_types::Integer, _>(user_id)
        .bind::<BigInt, _>(MAX_PLAYBACK_EVENTS_PER_USER)
        .execute(connection)?;
    }
    if include_listen_history {
        prune_listen_history(connection, user_id)?;
    }
    Ok(())
}

pub(crate) fn prune_listen_history(
    connection: &mut SqliteConnection,
    user_id: i32,
) -> QueryResult<usize> {
    diesel::sql_query(
        "DELETE FROM listen_history_item WHERE user_id = ? AND id IN (
           SELECT id FROM listen_history_item WHERE user_id = ?
           ORDER BY listened_at DESC, id DESC LIMIT -1 OFFSET ?
         )",
    )
    .bind::<diesel::sql_types::Integer, _>(user_id)
    .bind::<diesel::sql_types::Integer, _>(user_id)
    .bind::<BigInt, _>(MAX_LISTEN_HISTORY_PER_USER)
    .execute(connection)
}

fn upsert_entity_preference(
    connection: &mut SqliteConnection,
    table: &str,
    key_column: &str,
    user_id: i32,
    key: &str,
    positive: f64,
    negative: f64,
) -> QueryResult<usize> {
    let statement = format!(
        "INSERT INTO {table} (user_id, {key_column}, positive_weight, negative_weight, last_positive_at)
         VALUES (?, ?, ?, ?, CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE NULL END)
         ON CONFLICT(user_id, {key_column}) DO UPDATE SET
           positive_weight = positive_weight + excluded.positive_weight,
           negative_weight = negative_weight + excluded.negative_weight,
           last_positive_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE last_positive_at END"
    );
    diesel::sql_query(statement)
        .bind::<diesel::sql_types::Integer, _>(user_id)
        .bind::<Text, _>(key)
        .bind::<Double, _>(positive)
        .bind::<Double, _>(negative)
        .bind::<Double, _>(positive)
        .bind::<Double, _>(positive)
        .execute(connection)
}

#[derive(Default)]
struct CandidateScore {
    score: f64,
    sources: HashSet<&'static str>,
}

fn add_candidate(
    candidates: &mut HashMap<String, CandidateScore>,
    song_id: &str,
    score: f64,
    source: &'static str,
) {
    let candidate = candidates.entry(song_id.to_owned()).or_default();
    candidate.score += score;
    candidate.sources.insert(source);
}

fn normalized_recording_key(value: &str) -> String {
    const VERSION_MARKERS: &[&str] = &[
        "remaster",
        "remastered",
        "deluxe",
        "expanded",
        "anniversary",
        "version",
    ];
    value
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.is_empty() && !VERSION_MARKERS.contains(token))
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn recommend(
    user_id: i32,
    seed_song_id: Option<&str>,
    cache: &LibraryCache,
    pool: &DbPool,
    limit: usize,
) -> Result<Vec<RankedCandidate>, Box<dyn std::error::Error>> {
    let mut connection = pool.get()?;
    let mut candidates = HashMap::<String, CandidateScore>::new();

    if let Some(seed_id) = seed_song_id {
        if let Some((artist_id, album_id)) = cache.song_map.get(seed_id) {
            if let Some(indices) = cache.songs_by_artist.get(artist_id) {
                for index in indices.iter().take(300) {
                    if let Some(song_id) = cache.flat_song_id(*index)
                        && song_id != seed_id
                    {
                        add_candidate(&mut candidates, song_id, 16.0, "seed_artist");
                    }
                }
            }
            for genre in cache.album_genres.get(album_id).into_iter().flatten() {
                if let Some(indices) = cache.songs_by_genre.get(genre) {
                    for index in indices.iter().take(300) {
                        if let Some(song_id) = cache.flat_song_id(*index)
                            && song_id != seed_id
                        {
                            add_candidate(&mut candidates, song_id, 10.0, "seed_genre");
                        }
                    }
                }
            }
        }

        let transitions = diesel::sql_query(
            "SELECT to_song_id AS song_id,
                    (positive_count * 30.0) - (skip_count * 12.0) AS score
             FROM track_transition
             WHERE user_id = ? AND from_song_id = ? AND positive_count > skip_count
             ORDER BY score DESC, to_song_id ASC LIMIT ?",
        )
        .bind::<diesel::sql_types::Integer, _>(user_id)
        .bind::<Text, _>(seed_id)
        .bind::<BigInt, _>(MAX_TRANSITIONS)
        .load::<TransitionRow>(&mut connection)?;
        for row in transitions {
            add_candidate(&mut candidates, &row.song_id, row.score, "transition");
        }
    }

    let track_preferences = diesel::sql_query(
        "SELECT song_id,
                preference_score / (1.0 + MAX(0.0, julianday('now') - julianday(last_positive_at)) / 90.0)
                  AS preference_score
         FROM user_track_preference
         WHERE user_id = ? AND preference_score > 0
         ORDER BY preference_score DESC, last_positive_at DESC, song_id ASC LIMIT ?",
    )
    .bind::<diesel::sql_types::Integer, _>(user_id)
    .bind::<BigInt, _>(MAX_PROFILE_TRACKS)
    .load::<TrackPreferenceRow>(&mut connection)?;
    for (preference_index, row) in track_preferences.into_iter().enumerate() {
        add_candidate(
            &mut candidates,
            &row.song_id,
            row.preference_score.min(25.0),
            "track_affinity",
        );
        if preference_index < 10 {
            let neighbours = diesel::sql_query(
                "SELECT DISTINCT neighbour.b AS song_id
                 FROM _playlist_to_song seed
                 JOIN _playlist_to_song neighbour ON neighbour.a = seed.a AND neighbour.b <> seed.b
                 JOIN _playlist_to_user membership ON membership.a = seed.a
                 WHERE seed.b = ? AND membership.b = ?
                 ORDER BY ABS(COALESCE(neighbour.position, 0) - COALESCE(seed.position, 0)), neighbour.b
                 LIMIT 30",
            )
            .bind::<Text, _>(&row.song_id)
            .bind::<diesel::sql_types::Integer, _>(user_id)
            .load::<SongIdRow>(&mut connection)?;
            for neighbour in neighbours {
                add_candidate(
                    &mut candidates,
                    &neighbour.song_id,
                    20.0,
                    "playlist_cooccurrence",
                );
            }
        }
    }

    let artist_preferences = diesel::sql_query(
        "SELECT artist_id,
                (positive_weight - negative_weight * 1.5)
                / (1.0 + MAX(0.0, julianday('now') - julianday(last_positive_at)) / 90.0) AS score
         FROM user_artist_preference WHERE user_id = ? AND positive_weight > negative_weight
         ORDER BY score DESC, artist_id ASC LIMIT ?",
    )
    .bind::<diesel::sql_types::Integer, _>(user_id)
    .bind::<BigInt, _>(MAX_PROFILE_ARTISTS)
    .load::<ArtistPreferenceRow>(&mut connection)?;
    for artist in artist_preferences {
        if let Some(indices) = cache.songs_by_artist.get(&artist.artist_id) {
            for index in indices.iter().take(300) {
                if let Some(song_id) = cache.flat_song_id(*index) {
                    add_candidate(
                        &mut candidates,
                        song_id,
                        artist.score.clamp(1.0, 18.0),
                        "artist_affinity",
                    );
                }
            }
        }
    }

    let genre_preferences = diesel::sql_query(
        "SELECT genre,
                (positive_weight - negative_weight * 1.5)
                / (1.0 + MAX(0.0, julianday('now') - julianday(last_positive_at)) / 90.0) AS score
         FROM user_genre_preference WHERE user_id = ? AND positive_weight > negative_weight
         ORDER BY score DESC, genre ASC LIMIT 12",
    )
    .bind::<diesel::sql_types::Integer, _>(user_id)
    .load::<GenrePreferenceRow>(&mut connection)?;
    for genre in genre_preferences {
        if let Some(indices) = cache.songs_by_genre.get(&genre.genre) {
            for index in indices.iter().take(300) {
                if let Some(song_id) = cache.flat_song_id(*index) {
                    add_candidate(
                        &mut candidates,
                        song_id,
                        genre.score.clamp(1.0, 12.0),
                        "genre_affinity",
                    );
                }
            }
        }
    }

    let album_preferences = diesel::sql_query(
        "SELECT album_id,
                (positive_weight - negative_weight * 1.5)
                / (1.0 + MAX(0.0, julianday('now') - julianday(last_positive_at)) / 90.0) AS score
         FROM user_album_preference WHERE user_id = ? AND positive_weight > negative_weight
         ORDER BY score DESC, album_id ASC LIMIT 20",
    )
    .bind::<diesel::sql_types::Integer, _>(user_id)
    .load::<AlbumPreferenceRow>(&mut connection)?;
    for album in album_preferences {
        if let Some(library_album) = cache.album(&album.album_id) {
            for song in library_album.songs.iter().take(100) {
                add_candidate(
                    &mut candidates,
                    &song.id,
                    album.score.clamp(1.0, 10.0),
                    "album_affinity",
                );
            }
        }
    }

    let recent = diesel::sql_query(
        "SELECT song_id FROM user_track_preference
         WHERE user_id = ? AND last_played_at IS NOT NULL
         ORDER BY last_played_at DESC LIMIT ?",
    )
    .bind::<diesel::sql_types::Integer, _>(user_id)
    .bind::<BigInt, _>(RECENT_EXCLUSION_COUNT)
    .load::<SongIdRow>(&mut connection)?
    .into_iter()
    .map(|row| row.song_id)
    .collect::<HashSet<_>>();

    let event_count = diesel::sql_query(
        "SELECT COUNT(*) AS count FROM playback_event
         WHERE user_id = ? AND event_type IN
           ('manual_selection', 'qualified_play', 'completed', 'manual_queue_add', 'playlist_add')",
    )
    .bind::<diesel::sql_types::Integer, _>(user_id)
    .get_result::<CountRow>(&mut connection)?
    .count;

    if seed_song_id.is_none() && event_count < 1 {
        return Ok(Vec::new());
    }

    let ranked = rank_candidates(candidates, seed_song_id, recent, cache);
    Ok(select_candidates(ranked, cache, limit))
}

fn rank_candidates(
    candidates: HashMap<String, CandidateScore>,
    seed_song_id: Option<&str>,
    recent: HashSet<String>,
    cache: &LibraryCache,
) -> Vec<RankedCandidate> {
    let seed_key = seed_song_id
        .and_then(|id| cache.song(id))
        .map(|song| normalized_recording_key(&song.name));
    let mut ranked = candidates
        .into_iter()
        .filter(|(song_id, candidate)| {
            candidate.score >= 10.0
                && seed_song_id != Some(song_id.as_str())
                && !recent.contains(song_id)
                && cache.song(song_id).is_some()
        })
        .map(|(song_id, mut candidate)| {
            if candidate.sources.len() > 1 {
                candidate.score += ((candidate.sources.len() - 1) as f64) * 5.0;
            }
            let reason = if candidate.sources.contains("transition") {
                "follows your listening"
            } else if candidate.sources.contains("playlist_cooccurrence") {
                "fits your playlists"
            } else if candidate.sources.contains("seed_artist") {
                "from this artist"
            } else if candidate.sources.contains("seed_genre") {
                "fits this session"
            } else if candidate.sources.contains("artist_affinity") {
                "from an artist you play"
            } else {
                "played before"
            };
            RankedCandidate {
                song_id,
                score: candidate.score,
                reason: reason.to_owned(),
            }
        })
        .filter(|candidate| {
            seed_key.as_ref().is_none_or(|seed| {
                cache
                    .song(&candidate.song_id)
                    .map(|song| normalized_recording_key(&song.name) != *seed)
                    .unwrap_or(false)
            })
        })
        .collect::<Vec<_>>();

    ranked.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.song_id.cmp(&right.song_id))
    });

    ranked
}

fn select_candidates(
    ranked: Vec<RankedCandidate>,
    cache: &LibraryCache,
    limit: usize,
) -> Vec<RankedCandidate> {
    let mut selected = Vec::with_capacity(limit);
    let mut selected_ids = HashSet::new();
    let mut recent_artists = Vec::<String>::new();
    let mut album_counts = HashMap::<String, usize>::new();
    for candidate in ranked.iter().cloned() {
        let Some((artist_id, album_id)) = cache.song_map.get(&candidate.song_id) else {
            continue;
        };
        if recent_artists
            .iter()
            .rev()
            .take(3)
            .any(|id| id == artist_id)
        {
            continue;
        }
        if album_counts.get(album_id).copied().unwrap_or(0) >= 2 {
            continue;
        }
        recent_artists.push(artist_id.clone());
        *album_counts.entry(album_id.clone()).or_default() += 1;
        selected_ids.insert(candidate.song_id.clone());
        selected.push(candidate);
        if selected.len() >= limit {
            break;
        }
    }
    // Relax spacing deterministically for small libraries.
    if selected.len() < limit {
        for candidate in ranked {
            if selected_ids.contains(&candidate.song_id) {
                continue;
            }
            let Some((_, album_id)) = cache.song_map.get(&candidate.song_id) else {
                continue;
            };
            if album_counts.get(album_id).copied().unwrap_or(0) >= 3 {
                continue;
            }
            *album_counts.entry(album_id.clone()).or_default() += 1;
            selected_ids.insert(candidate.song_id.clone());
            selected.push(candidate);
            if selected.len() >= limit {
                break;
            }
        }
    }
    selected
}

pub fn recent_playback_ids(
    user_id: i32,
    pool: &DbPool,
    limit: i64,
) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let mut connection = pool.get()?;
    let rows = diesel::sql_query(
        "SELECT song_id FROM playback_event
         WHERE id IN (
           SELECT MAX(id) FROM playback_event
           WHERE user_id = ? AND event_type IN
             ('manual_selection', 'qualified_play', 'completed')
           GROUP BY song_id
         )
         ORDER BY created_at DESC, id DESC LIMIT ?",
    )
    .bind::<diesel::sql_types::Integer, _>(user_id)
    .bind::<BigInt, _>(limit.clamp(1, 200))
    .load::<SongIdRow>(&mut connection)?;
    Ok(rows.into_iter().map(|row| row.song_id).collect())
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};
    use std::sync::Arc;

    use super::{
        CountRow, MAX_LISTEN_HISTORY_PER_USER, MAX_PLAYBACK_EVENTS_PER_USER, PlaybackEventRequest,
        normalized_recording_key, prune_playback_history, record_playback_event,
    };
    use crate::domain::{Album, Artist, Song};
    use crate::library::search::SearchIndex;
    use crate::library::state::LibraryCache;
    use diesel::connection::SimpleConnection;
    use diesel::{Connection, RunQueryDsl};

    fn one_song_cache() -> LibraryCache {
        let song = Song {
            id: "song-1".into(),
            name: "Song".into(),
            ..Song::default()
        };
        let album = Album {
            id: "album-1".into(),
            name: "Album".into(),
            songs: vec![song],
            ..Album::default()
        };
        let artist = Artist {
            id: "artist-1".into(),
            name: "Artist".into(),
            albums: vec![album],
            ..Artist::default()
        };
        let artists = Arc::new(vec![artist]);
        LibraryCache {
            search_index: SearchIndex::build(&artists).expect("test search index"),
            artists,
            song_map: HashMap::from([("song-1".into(), ("artist-1".into(), "album-1".into()))]),
            album_genres: HashMap::new(),
            artist_positions: HashMap::from([("artist-1".into(), 0)]),
            album_positions: HashMap::from([("album-1".into(), (0, 0))]),
            song_positions: HashMap::from([("song-1".into(), (0, 0, 0))]),
            songs_flat: vec!["song-1".into()],
            songs_by_artist: HashMap::new(),
            songs_by_genre: HashMap::new(),
            image_paths: HashSet::new(),
        }
    }

    #[test]
    fn normalizes_common_release_version_markers() {
        assert_eq!(
            normalized_recording_key("A Song (2011 Remastered Version)"),
            "a song 2011"
        );
        assert_eq!(normalized_recording_key("A Song - Deluxe"), "a song");
    }

    #[test]
    fn recent_playback_uses_manual_events_and_deduplicates_tracks() {
        use diesel::r2d2::{ConnectionManager, Pool};
        use std::sync::Arc;

        let manager = ConnectionManager::<diesel::sqlite::SqliteConnection>::new(":memory:");
        let pool = Arc::new(Pool::builder().max_size(1).build(manager).unwrap());
        {
            let mut connection = pool.get().unwrap();
            connection
                .batch_execute(
                    "CREATE TABLE playback_event (
                         id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                         event_key TEXT NOT NULL UNIQUE,
                         user_id INTEGER NOT NULL,
                         song_id TEXT NOT NULL,
                         event_type TEXT NOT NULL,
                         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                     );
                     INSERT INTO playback_event
                       (event_key, user_id, song_id, event_type, created_at)
                     VALUES
                       ('a', 1, 'track-a', 'manual_selection', '2026-01-01 10:00:00'),
                       ('b', 1, 'track-b', 'qualified_play', '2026-01-01 10:01:00'),
                       ('c', 1, 'track-a', 'completed', '2026-01-01 10:02:00'),
                       ('d', 1, 'ignored', 'early_skip', '2026-01-01 10:03:00');",
                )
                .unwrap();
        }

        assert_eq!(
            super::recent_playback_ids(1, &pool, 10).unwrap(),
            vec!["track-a".to_string(), "track-b".to_string()]
        );
    }

    #[test]
    fn playback_event_failures_roll_back_the_idempotency_key() {
        use diesel::r2d2::{ConnectionManager, Pool};

        let manager = ConnectionManager::<diesel::sqlite::SqliteConnection>::new(":memory:");
        let pool = Arc::new(
            Pool::builder()
                .max_size(1)
                .build(manager)
                .expect("event pool"),
        );
        {
            let mut connection = pool.get().expect("event connection");
            connection
                .batch_execute(
                    "CREATE TABLE playback_event (
                       id INTEGER PRIMARY KEY AUTOINCREMENT,
                       event_key TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL,
                       song_id TEXT NOT NULL, event_type TEXT NOT NULL,
                       session_id TEXT, queue_id TEXT, source TEXT NOT NULL DEFAULT 'unknown',
                       position_seconds REAL NOT NULL DEFAULT 0,
                       duration_seconds REAL NOT NULL DEFAULT 0,
                       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                     );",
                )
                .expect("event fixture");
        }
        let event = PlaybackEventRequest {
            event_key: "event-1".into(),
            song_id: "song-1".into(),
            event_type: "manual_selection".into(),
            session_id: None,
            queue_id: None,
            source: Some("manual".into()),
            position_seconds: Some(0.0),
            duration_seconds: Some(180.0),
        };
        assert!(record_playback_event(1, &event, &one_song_cache(), &pool).is_err());
        let mut connection = pool.get().expect("event count connection");
        let count = diesel::sql_query("SELECT COUNT(*) AS count FROM playback_event")
            .get_result::<CountRow>(&mut connection)
            .expect("event count")
            .count;
        assert_eq!(count, 0);
    }

    #[test]
    fn playback_start_updates_now_playing_and_queue_position_in_one_event() {
        use diesel::r2d2::{ConnectionManager, Pool};

        #[derive(diesel::QueryableByName)]
        struct PlaybackState {
            #[diesel(sql_type = diesel::sql_types::Text)]
            now_playing: String,
            #[diesel(sql_type = diesel::sql_types::Integer)]
            current_position: i32,
            #[diesel(sql_type = diesel::sql_types::Integer)]
            revision: i32,
        }

        let manager = ConnectionManager::<diesel::sqlite::SqliteConnection>::new(":memory:");
        let pool = Arc::new(
            Pool::builder()
                .max_size(1)
                .build(manager)
                .expect("event pool"),
        );
        let queue_id = "11111111-1111-4111-8111-111111111111";
        {
            let mut connection = pool.get().expect("event connection");
            connection
                .batch_execute(&format!(
                    "CREATE TABLE user (
                       id INTEGER PRIMARY KEY, now_playing TEXT
                     );
                     CREATE TABLE playback_event (
                       id INTEGER PRIMARY KEY AUTOINCREMENT,
                       event_key TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL,
                       song_id TEXT NOT NULL, event_type TEXT NOT NULL,
                       session_id TEXT, queue_id TEXT, source TEXT NOT NULL DEFAULT 'unknown',
                       position_seconds REAL NOT NULL DEFAULT 0,
                       duration_seconds REAL NOT NULL DEFAULT 0,
                       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                     );
                     CREATE TABLE listen_history_item (
                       id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
                       song_id TEXT, listened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                     );
                     CREATE TABLE user_data_retention (
                       user_id INTEGER PRIMARY KEY,
                       playback_events_since_prune INTEGER NOT NULL DEFAULT 0,
                       history_events_since_prune INTEGER NOT NULL DEFAULT 0
                     );
                     CREATE TABLE playback_queue (
                       id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
                       current_position INTEGER NOT NULL DEFAULT 0,
                       revision INTEGER NOT NULL DEFAULT 1,
                       updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                     );
                     CREATE TABLE playback_queue_item (
                       queue_id TEXT NOT NULL, position INTEGER NOT NULL, song_id TEXT NOT NULL
                     );
                     INSERT INTO user (id) VALUES (1);
                     INSERT INTO playback_queue (id, user_id) VALUES ('{queue_id}', 1);
                     INSERT INTO playback_queue_item (queue_id, position, song_id)
                     VALUES ('{queue_id}', 0, 'other-song'), ('{queue_id}', 1, 'song-1');"
                ))
                .expect("playback state fixture");
        }
        let event = PlaybackEventRequest {
            event_key: "event-start".into(),
            song_id: "song-1".into(),
            event_type: "play_started".into(),
            session_id: Some("session-1".into()),
            queue_id: Some(queue_id.into()),
            source: Some("generated".into()),
            position_seconds: Some(0.0),
            duration_seconds: Some(180.0),
        };
        let result = record_playback_event(1, &event, &one_song_cache(), &pool)
            .expect("playback start event");
        assert!(result.accepted);

        let mut connection = pool.get().expect("state connection");
        let state = diesel::sql_query(
            "SELECT user.now_playing, playback_queue.current_position, playback_queue.revision
             FROM user JOIN playback_queue ON playback_queue.user_id = user.id
             WHERE user.id = 1",
        )
        .get_result::<PlaybackState>(&mut connection)
        .expect("playback state");
        assert_eq!(state.now_playing, "song-1");
        assert_eq!(state.current_position, 1);
        assert_eq!(state.revision, 2);
    }

    #[test]
    fn playback_history_retention_is_exact_and_user_scoped() {
        let mut connection = diesel::sqlite::SqliteConnection::establish(":memory:")
            .expect("history retention connection");
        connection
            .batch_execute(&format!(
                "CREATE TABLE playback_event (
                   id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
                   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE TABLE listen_history_item (
                   id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
                   listened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 WITH RECURSIVE sequence(value) AS (
                   SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value <= {}
                 )
                 INSERT INTO playback_event (user_id) SELECT 1 FROM sequence;
                 INSERT INTO listen_history_item (user_id)
                 SELECT 1 FROM playback_event;
                 INSERT INTO playback_event (user_id) VALUES (2);
                 INSERT INTO listen_history_item (user_id) VALUES (2);",
                MAX_PLAYBACK_EVENTS_PER_USER
            ))
            .expect("history retention fixture");
        prune_playback_history(&mut connection, 1, true, true).expect("history pruning");

        let event_count =
            diesel::sql_query("SELECT COUNT(*) AS count FROM playback_event WHERE user_id = 1")
                .get_result::<CountRow>(&mut connection)
                .expect("event retention count")
                .count;
        let history_count = diesel::sql_query(
            "SELECT COUNT(*) AS count FROM listen_history_item WHERE user_id = 1",
        )
        .get_result::<CountRow>(&mut connection)
        .expect("listen retention count")
        .count;
        assert_eq!(event_count, MAX_PLAYBACK_EVENTS_PER_USER);
        assert_eq!(history_count, MAX_LISTEN_HISTORY_PER_USER);
        let other_user =
            diesel::sql_query("SELECT COUNT(*) AS count FROM playback_event WHERE user_id = 2")
                .get_result::<CountRow>(&mut connection)
                .expect("other user event count")
                .count;
        assert_eq!(other_user, 1);
    }
}
