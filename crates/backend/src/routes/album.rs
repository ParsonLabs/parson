use actix_web::{get, web, HttpResponse};
use rand::seq::{IteratorRandom, SliceRandom};
use serde::{Deserialize, Serialize};

use crate::structures::structures::{Artist, ReleaseAlbum, ReleaseGroupAlbum, Song};
use crate::utils::config::{fetch_library, get_config};

#[derive(Serialize, Deserialize, Clone)]
pub struct ResponseAlbum {
    pub id: String,
    pub name: String,
    pub cover_url: String,
    pub songs: Vec<Song>,
    pub first_release_date: String,
    pub musicbrainz_id: String,
    pub wikidata_id: Option<String>,
    pub primary_type: String,
    pub description: String,
    pub artist_object: Artist,
    pub contributing_artists: Vec<String>,
    pub contributing_artists_ids: Vec<String>,
    pub release_album: Option<ReleaseAlbum>,
    pub release_group_album: Option<ReleaseGroupAlbum>
}

pub async fn fetch_random_albums(amount: usize) -> Result<Vec<ResponseAlbum>, ()> {
    let config = get_config().await.map_err(|_| ())?;
    let library: Vec<Artist> = serde_json::from_str(&config).map_err(|_| ())?;

    let mut random_albums_with_artists = Vec::new();
    let mut rng = rand::thread_rng();

    for _ in 0..amount {
        let mut valid_artist = None;
        let mut valid_album = None;

        for _ in 0..10 {
            if let Some(artist) = library.iter().choose(&mut rng) {
                if !artist.albums.is_empty() {
                    valid_artist = Some(artist);
                    break;
                }
            }
        }

        if let Some(artist) = valid_artist {
            if let Some(album) = artist.albums.choose(&mut rng) {
                valid_album = Some(album);
            }
        }

        if let Some(album) = valid_album {
            random_albums_with_artists.push(ResponseAlbum {
                id: album.id.clone(),
                name: album.name.clone(),
                cover_url: album.cover_url.clone(),
                songs: album.songs.clone(),
                first_release_date: album.first_release_date.clone(),
                musicbrainz_id: album.musicbrainz_id.clone(),
                wikidata_id: album.wikidata_id.clone(),
                primary_type: album.primary_type.clone(),
                description: album.description.clone(),
                artist_object: valid_artist.unwrap().to_owned().clone(),
                contributing_artists: album.contributing_artists.clone(),
                contributing_artists_ids: album.contributing_artists_ids.clone(),
                release_album: album.release_album.clone(),
                release_group_album: album.release_group_album.clone()
            });
        }
    }

    Ok(random_albums_with_artists)
}

pub async fn fetch_album_info(album_id: String) -> Result<ResponseAlbum, ()> {
    let library = fetch_library().await.map_err(|_| ())?;

    for artist in library.iter() {
        for album in artist.albums.iter() {
            if album.id == album_id {
                return Ok(ResponseAlbum {
                    id: album.id.clone(),
                    name: album.name.clone(),
                    cover_url: album.cover_url.clone(),
                    songs: album.songs.clone(),
                    first_release_date: album.first_release_date.clone(),
                    musicbrainz_id: album.musicbrainz_id.clone(),
                    wikidata_id: album.wikidata_id.clone(),
                    primary_type: album.primary_type.clone(),
                    description: album.description.clone(),
                    artist_object: artist.clone(),
                    contributing_artists: album.contributing_artists.clone(),
                    contributing_artists_ids: album.contributing_artists_ids.clone(),
                    release_album: album.release_album.clone(),
                    release_group_album: album.release_group_album.clone()
                });
            }
        }
    }

    Err(())
}

#[get("/random/{amount}")]
async fn get_random_album(amount: web::Path<usize>) -> HttpResponse {
    match fetch_random_albums(*amount).await {
        Ok(albums) => HttpResponse::Ok().json(albums),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

#[get("/info/{id}")]
async fn get_album_info(id: web::Path<String>) -> HttpResponse {
    match fetch_album_info(id.into_inner()).await {
        Ok(album) => HttpResponse::Ok().json(album),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/album")
            .service(get_random_album)
            .service(get_album_info),
    );
}