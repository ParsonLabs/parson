use actix_web::{HttpResponse, get, post, web};
use rand::seq::{IndexedRandom, IteratorRandom};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::api::song::{ResponseSong, response_song};
use crate::domain::{Album, Artist, ReleaseAlbum, ReleaseGroupAlbum};
use crate::library::normalize::dedupe_and_sort_album_songs;
use crate::library::state::{LibraryCache, LibraryLifecycle, library_unavailable_response};

const MAX_COLLECTION_RESPONSE_SIZE: usize = 100;
const MAX_BATCH_LOOKUP_IDS: usize = 500;

#[derive(Serialize, Deserialize, Clone)]
pub struct ResponseAlbum {
    pub id: String,
    pub name: String,
    pub cover_url: String,
    pub songs: Vec<ResponseSong>,
    pub first_release_date: String,
    pub musicbrainz_id: String,
    pub wikidata_id: Option<String>,
    pub primary_type: String,
    pub description: String,
    pub artist_object: Artist,
    pub contributing_artists: Vec<String>,
    pub contributing_artists_ids: Vec<String>,
    pub release_album: Option<ReleaseAlbum>,
    pub release_group_album: Option<ReleaseGroupAlbum>,
}

fn response_album(album: &Album, artist: &Artist) -> ResponseAlbum {
    let mut album = album.clone();
    dedupe_and_sort_album_songs(&mut album);
    let songs = album
        .songs
        .iter()
        .map(|song| response_song(song, &album, artist))
        .collect();

    ResponseAlbum {
        id: album.id,
        name: album.name,
        cover_url: album.cover_url,
        songs,
        first_release_date: album.first_release_date,
        musicbrainz_id: album.musicbrainz_id,
        wikidata_id: album.wikidata_id,
        primary_type: album.primary_type,
        description: album.description,
        artist_object: crate::api::artist_reference(artist),
        contributing_artists: album.contributing_artists,
        contributing_artists_ids: album.contributing_artists_ids,
        release_album: album.release_album,
        release_group_album: album.release_group_album,
    }
}

pub fn fetch_random_albums(amount: usize, cache: &LibraryCache) -> Vec<ResponseAlbum> {
    let mut random_albums_with_artists = Vec::new();
    let mut rng = rand::rng();

    for _ in 0..amount {
        let mut valid_artist = None;
        let mut valid_album = None;

        for _ in 0..10 {
            if let Some(artist) = cache.artists.iter().choose(&mut rng)
                && !artist.albums.is_empty()
            {
                valid_artist = Some(artist);
                break;
            }
        }

        if let Some(artist) = valid_artist
            && let Some(album) = artist.albums.choose(&mut rng)
        {
            valid_album = Some(album);
        }

        if let (Some(album), Some(artist)) = (valid_album, valid_artist) {
            random_albums_with_artists.push(response_album(album, artist));
        }
    }

    random_albums_with_artists
}

#[derive(Serialize, Deserialize)]
pub enum AlbumInfo {
    Full(ResponseAlbum),
    Bare(Album),
}

pub fn fetch_album_info(
    album_id: String,
    bare: Option<bool>,
    cache: &LibraryCache,
) -> Result<AlbumInfo, crate::api::LookupError> {
    let bare = bare.unwrap_or(false);

    let album = cache.album(&album_id).ok_or(crate::api::LookupError)?;
    if bare {
        return Ok(AlbumInfo::Bare(album.clone()));
    }
    let artist = cache
        .album_owner(&album_id)
        .ok_or(crate::api::LookupError)?;
    Ok(AlbumInfo::Full(response_album(album, artist)))
}

#[get("/random/{amount}")]
async fn get_random_album(
    amount: web::Path<usize>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };

    HttpResponse::Ok().json(fetch_random_albums(
        (*amount).min(MAX_COLLECTION_RESPONSE_SIZE),
        &cache,
    ))
}
#[derive(Deserialize)]
pub struct AlbumQuery {
    bare: Option<bool>,
}

#[get("/{id}")]
async fn get_album_info(
    id: web::Path<String>,
    query: web::Query<AlbumQuery>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let album_id = id.into_inner();
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };

    let bare = query.bare.unwrap_or(false);
    match fetch_album_info(album_id, Some(bare), &cache) {
        Ok(album) => HttpResponse::Ok().json(album),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

#[derive(Deserialize)]
pub struct BatchAlbumInfoForm {
    ids: Vec<String>,
    bare: Option<bool>,
}

async fn batch_album_info_response(
    form: web::Json<BatchAlbumInfoForm>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };

    let bare = form.bare.unwrap_or(false);
    let mut albums = HashMap::new();

    for id in form
        .ids
        .iter()
        .filter(|id| !id.is_empty())
        .take(MAX_BATCH_LOOKUP_IDS)
    {
        if albums.contains_key(id) {
            continue;
        }

        if let Ok(album) = fetch_album_info(id.clone(), Some(bare), cache.as_ref()) {
            albums.insert(id.clone(), album);
        }
    }

    HttpResponse::Ok().json(albums)
}

#[post("/batch")]
async fn get_batch_album_info(
    form: web::Json<BatchAlbumInfoForm>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    batch_album_info_response(form, lifecycle).await
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/albums")
            .service(get_random_album)
            .service(get_batch_album_info)
            .service(get_album_info),
    );
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use super::{AlbumInfo, fetch_album_info, response_album};
    use crate::domain::{Album, Artist, Song};
    use crate::library::search::SearchIndex;
    use crate::library::state::LibraryCache;

    fn fixture() -> (Artist, LibraryCache) {
        let album = Album {
            id: "album-1".into(),
            name: "Album".into(),
            songs: vec![
                Song {
                    id: "song-2".into(),
                    name: "Second".into(),
                    track_number: 2,
                    ..Song::default()
                },
                Song {
                    id: "song-1".into(),
                    name: "First".into(),
                    track_number: 1,
                    ..Song::default()
                },
                Song {
                    id: "song-1".into(),
                    name: "Duplicate".into(),
                    track_number: 1,
                    ..Song::default()
                },
            ],
            ..Album::default()
        };
        let artist = Artist {
            id: "artist-1".into(),
            name: "Artist".into(),
            albums: vec![album],
            ..Artist::default()
        };
        let cache = LibraryCache {
            artists: Arc::new(vec![artist.clone()]),
            search_index: SearchIndex::build(std::slice::from_ref(&artist)).unwrap(),
            song_map: HashMap::new(),
            album_genres: HashMap::new(),
            artist_positions: HashMap::from([("artist-1".into(), 0)]),
            album_positions: HashMap::from([("album-1".into(), (0, 0))]),
            song_positions: HashMap::new(),
            songs_flat: Vec::new(),
            songs_by_artist: HashMap::new(),
            songs_by_genre: HashMap::new(),
            image_paths: Default::default(),
        };
        (artist, cache)
    }

    #[test]
    fn full_album_responses_sort_and_deduplicate_tracks_without_mutating_cache() {
        let (artist, _) = fixture();
        let response = response_album(&artist.albums[0], &artist);
        assert_eq!(
            response
                .songs
                .iter()
                .map(|song| song.id.as_str())
                .collect::<Vec<_>>(),
            ["song-1", "song-2"]
        );
        assert_eq!(artist.albums[0].songs.len(), 3);
        assert!(response.artist_object.albums.is_empty());
    }

    #[test]
    fn album_lookup_honors_bare_and_full_contracts() {
        let (_, cache) = fixture();
        assert!(matches!(
            fetch_album_info("album-1".into(), Some(true), &cache),
            Ok(AlbumInfo::Bare(_))
        ));
        let full = fetch_album_info("album-1".into(), Some(false), &cache).unwrap();
        match full {
            AlbumInfo::Full(album) => {
                assert_eq!(album.artist_object.id, "artist-1");
                assert!(album.artist_object.albums.is_empty());
            }
            AlbumInfo::Bare(_) => panic!("expected full album"),
        }
    }

    #[test]
    fn album_lookup_rejects_missing_ids() {
        let (_, cache) = fixture();
        assert!(fetch_album_info("missing".into(), None, &cache).is_err());
    }
}
