use crate::library::state::{LibraryCache, LibraryLifecycle, library_unavailable_response};
use actix_web::{HttpResponse, get, post, web};
use rand::seq::IndexedRandom;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashMap;

use crate::api::error::{internal_server_error, not_found};
use crate::domain::{Album, Artist, Song};

const MAX_COLLECTION_RESPONSE_SIZE: usize = 100;
const MAX_BATCH_LOOKUP_IDS: usize = 500;

#[derive(Serialize, Deserialize, Clone)]
pub struct ResponseSong {
    pub id: String,
    pub name: String,
    pub artist: String,
    pub contributing_artists: Vec<String>,
    pub contributing_artist_ids: Vec<String>,
    pub track_number: u16,
    pub path: String,
    pub duration: f64,
    pub album_object: Album,
    pub artist_object: Artist,
}

pub(crate) fn response_song(song: &Song, album: &Album, artist: &Artist) -> ResponseSong {
    ResponseSong {
        id: song.id.clone(),
        name: song.name.clone(),
        artist: song.artist.clone(),
        contributing_artists: song.contributing_artists.clone(),
        contributing_artist_ids: song.contributing_artist_ids.clone(),
        track_number: song.track_number,
        path: song.path.clone(),
        duration: song.duration,
        album_object: crate::api::album_reference(album),
        artist_object: crate::api::artist_reference(artist),
    }
}

pub async fn fetch_random_songs(
    amount: usize,
    genre: Option<String>,
    cache: &LibraryCache,
) -> Result<Vec<ResponseSong>, ()> {
    let amount = amount.min(MAX_COLLECTION_RESPONSE_SIZE);
    let mut response_songs = Vec::with_capacity(amount);
    let mut rng = rand::rng();

    let candidates = genre.as_deref().and_then(|genre| {
        cache
            .songs_by_genre
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(genre))
            .map(|(_, songs)| songs)
    });

    if let Some(song_ids) = candidates {
        for song_index in song_ids.sample(&mut rng, amount) {
            let Some(song_id) = cache.flat_song_id(*song_index) else {
                continue;
            };
            let Some((artist_id, album_id)) = cache.song_map.get(song_id) else {
                continue;
            };
            let Some(song) = cache.song(song_id) else {
                continue;
            };
            let Some(artist) = cache.artist(artist_id) else {
                continue;
            };
            let Some(album) = cache.album(album_id) else {
                continue;
            };
            response_songs.push(response_song(song, album, artist));
        }
        return Ok(response_songs);
    }

    if genre.is_some() {
        return Ok(response_songs);
    }

    for song_id in cache.songs_flat.sample(&mut rng, amount) {
        let Some((artist_id, album_id)) = cache.song_map.get(song_id) else {
            continue;
        };
        let (Some(song), Some(artist), Some(album)) = (
            cache.song(song_id),
            cache.artist(artist_id),
            cache.album(album_id),
        ) else {
            continue;
        };
        response_songs.push(response_song(song, album, artist));
    }

    Ok(response_songs)
}

#[derive(Serialize)]
// Keep Full inline to avoid allocating every normal song response.
#[allow(clippy::large_enum_variant)]
pub enum SongInfo {
    Full(ResponseSong),
    Bare(Song),
}

pub fn fetch_song_info(
    song_id: &str,
    bare: Option<bool>,
    cache: &LibraryCache,
) -> Result<SongInfo, crate::api::LookupError> {
    let bare = bare.unwrap_or(false);

    let song = cache.song(song_id).ok_or(crate::api::LookupError)?;
    if bare {
        return Ok(SongInfo::Bare(song.clone()));
    }

    let (artist_id, album_id) = cache.song_map.get(song_id).ok_or(crate::api::LookupError)?;
    let artist = cache.artist(artist_id).ok_or(crate::api::LookupError)?;
    let album = cache.album(album_id).ok_or(crate::api::LookupError)?;

    Ok(SongInfo::Full(response_song(song, album, artist)))
}

pub fn fetch_song_info_from_cache(
    song_id: &str,
    cache: &LibraryCache,
    bare: Option<bool>,
) -> Result<SongInfo, crate::api::LookupError> {
    fetch_song_info(song_id, bare, cache)
}

#[derive(Deserialize)]
struct RandomSongQuery {
    genre: Option<String>,
}

#[get("/random/{amount}")]
async fn get_random_song(
    amount: web::Path<usize>,
    query: web::Query<RandomSongQuery>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };

    match fetch_random_songs(
        (*amount).min(MAX_COLLECTION_RESPONSE_SIZE),
        query.genre.clone(),
        &cache,
    )
    .await
    {
        Ok(songs) => HttpResponse::Ok().json(songs),
        Err(_) => internal_server_error("Failed to load songs.", "random_songs_failed"),
    }
}

#[derive(Deserialize)]
pub struct SongQuery {
    pub bare: Option<bool>,
}

#[get("/{id}")]
pub async fn get_song_info(
    id: web::Path<String>,
    query: web::Query<SongQuery>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let id_str = id.into_inner();
    let bare = query.bare.unwrap_or(false);
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };

    match fetch_song_info(&id_str, Some(bare), cache.as_ref()) {
        Ok(song) => HttpResponse::Ok().json(song),
        Err(_) => not_found("Song not found.", "song_not_found"),
    }
}

#[derive(Deserialize)]
pub struct BatchSongInfoForm {
    ids: Vec<String>,
    bare: Option<bool>,
}

async fn batch_song_info_response(
    form: web::Json<BatchSongInfoForm>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };

    let bare = form.bare.unwrap_or(false);
    let mut songs = HashMap::new();

    for id in form
        .ids
        .iter()
        .filter(|id| !id.is_empty())
        .take(MAX_BATCH_LOOKUP_IDS)
    {
        if songs.contains_key(id) {
            continue;
        }

        if let Ok(song) = fetch_song_info(id, Some(bare), cache.as_ref()) {
            songs.insert(id.clone(), song);
        }
    }

    HttpResponse::Ok().json(songs)
}

#[post("/batch")]
async fn get_batch_song_info(
    form: web::Json<BatchSongInfoForm>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    batch_song_info_response(form, lifecycle).await
}

#[derive(Deserialize)]
pub struct LatestQuery {
    amount: Option<usize>,
}

/// Return a fast latest-ish slice from the in-memory library order.
pub async fn fetch_latest_songs(
    amount: usize,
    cache: &LibraryCache,
) -> Result<Vec<ResponseSong>, ()> {
    let mut out = Vec::with_capacity(amount.min(cache.songs_flat.len()));

    for song_id in cache.songs_flat.iter().rev() {
        let Some((artist_id, album_id)) = cache.song_map.get(song_id) else {
            continue;
        };
        let Some(song) = cache.song(song_id) else {
            continue;
        };
        let Some(artist) = cache.artist(artist_id) else {
            continue;
        };
        let Some(album) = cache.album(album_id) else {
            continue;
        };

        out.push(response_song(song, album, artist));
        if out.len() >= amount {
            break;
        }
    }

    Ok(out)
}

#[get("/latest")]
pub async fn get_latest_songs(
    query: web::Query<LatestQuery>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let amount = query.amount.unwrap_or(20).min(MAX_COLLECTION_RESPONSE_SIZE);
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };

    match fetch_latest_songs(amount, &cache).await {
        Ok(songs) => HttpResponse::Ok().json(songs),
        Err(_) => internal_server_error("Failed to load latest songs.", "latest_songs_failed"),
    }
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/songs")
            .service(get_batch_song_info)
            .service(get_random_song)
            .service(get_latest_songs)
            .service(get_song_info),
    );
}

#[cfg(test)]
mod tests {
    use super::{SongInfo, fetch_song_info_from_cache};
    use crate::domain::{Album, Artist, Song};
    use crate::library::search::SearchIndex;
    use crate::library::state::LibraryCache;
    use std::collections::HashMap;
    use std::sync::Arc;

    fn test_cache() -> LibraryCache {
        let song = Song {
            id: "song-1".to_string(),
            name: "Fixture Song".to_string(),
            artist: "Fixture Artist".to_string(),
            contributing_artists: vec!["Guest Artist".to_string()],
            track_number: 3,
            path: "/music/fixture.mp3".to_string(),
            duration: 245.0,
            ..Song::default()
        };
        let album = Album {
            id: "album-1".to_string(),
            name: "Fixture Album".to_string(),
            songs: vec![song.clone()],
            ..Album::default()
        };
        let artist = Artist {
            id: "artist-1".to_string(),
            name: "Fixture Artist".to_string(),
            albums: vec![album.clone()],
            ..Artist::default()
        };

        LibraryCache {
            artists: Arc::new(vec![artist.clone()]),
            search_index: SearchIndex::build(std::slice::from_ref(&artist))
                .expect("test search index"),
            song_map: HashMap::from([(
                "song-1".to_string(),
                ("artist-1".to_string(), "album-1".to_string()),
            )]),
            album_genres: HashMap::new(),
            artist_positions: HashMap::from([("artist-1".to_string(), 0)]),
            album_positions: HashMap::from([("album-1".to_string(), (0, 0))]),
            song_positions: HashMap::from([("song-1".to_string(), (0, 0, 0))]),
            songs_flat: vec!["song-1".to_string()],
            songs_by_artist: HashMap::from([("artist-1".to_string(), vec![0])]),
            songs_by_genre: HashMap::new(),
            image_paths: Default::default(),
        }
    }

    #[test]
    fn fetch_song_info_from_cache_returns_full_song_context() {
        let cache = test_cache();

        let result = match fetch_song_info_from_cache("song-1", &cache, Some(false)) {
            Ok(result) => result,
            Err(_) => panic!("test setup failed: song-1 should exist in the cache"),
        };

        match result {
            SongInfo::Full(song) => {
                assert_eq!(song.id, "song-1");
                assert_eq!(song.album_object.id, "album-1");
                assert_eq!(song.artist_object.id, "artist-1");
                assert!(song.album_object.songs.is_empty());
                assert!(song.artist_object.albums.is_empty());
            }
            SongInfo::Bare(_) => panic!("expected full song info"),
        }
    }

    #[test]
    fn fetch_song_info_from_cache_returns_bare_song_when_requested() {
        let cache = test_cache();

        let result = match fetch_song_info_from_cache("song-1", &cache, Some(true)) {
            Ok(result) => result,
            Err(_) => panic!("test setup failed: song-1 should exist in the cache"),
        };

        match result {
            SongInfo::Bare(song) => {
                assert_eq!(song.id, "song-1");
                assert_eq!(song.name, "Fixture Song");
            }
            SongInfo::Full(_) => panic!("expected bare song info"),
        }
    }

    #[test]
    fn fetch_song_info_from_cache_returns_err_for_missing_song() {
        let cache = test_cache();

        assert!(fetch_song_info_from_cache("missing-song", &cache, Some(false)).is_err());
    }
}
