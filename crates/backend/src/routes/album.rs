use std::sync::Arc;

use actix_web::{delete, get, post, web, HttpResponse};
use rand::seq::{IteratorRandom, SliceRandom};
use serde::{Deserialize, Serialize};
use tracing::error;

use crate::routes::search::populate_search_data;
use crate::structures::structures::{Album, Artist, ReleaseAlbum, ReleaseGroupAlbum, Song};
use crate::utils::config::{fetch_library, get_config, refresh_cache, save_library};
use crate::utils::hash::hash_artist;

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

#[derive(Serialize, Deserialize)]
pub enum AlbumInfo {
    Full(ResponseAlbum),
    Bare(Album)
}

pub async fn fetch_album_info(album_id: String, bare: Option<bool>) -> Result<AlbumInfo, ()> {
    let library = fetch_library().await.map_err(|_| ())?;
    let bare = bare.unwrap_or(false);

    for artist in library.iter() {
        for album in artist.albums.iter() {
            if album.id == album_id {
                if bare {
                    return Ok(AlbumInfo::Bare(album.clone()))
                }
                return Ok(AlbumInfo::Full(ResponseAlbum {
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
                }));
            }
        }
    }

    Err(())
}

#[post("/edit/{id}")]
async fn edit_album_metadata(form: web::Json<Album>) -> HttpResponse {
    let mut library = match fetch_library().await {
        Ok(lib) => lib,
        Err(_) => return HttpResponse::InternalServerError().finish(),
    };

    let new_album = form.into_inner();
    let mut album_found = false;

    for artist in Arc::make_mut(&mut library).iter_mut() {
        for album in artist.albums.iter_mut() {
            if album.id == new_album.id {
                *album= new_album.clone();
                album_found = true;
                break;
            }
        }
    }

    if album_found {
        if save_library(&library).await.is_err() {
            return HttpResponse::InternalServerError().finish();
        }
        if refresh_cache().await.is_err() {
            return HttpResponse::InternalServerError().finish();
        }
        HttpResponse::Ok().finish()
    } else {
        HttpResponse::InternalServerError().finish()
    }
}

#[get("/random/{amount}")]
async fn get_random_album(amount: web::Path<usize>) -> HttpResponse {
    match fetch_random_albums(*amount).await {
        Ok(albums) => HttpResponse::Ok().json(albums),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}
#[derive(Deserialize)]
pub struct AlbumQuery {
    bare: Option<bool>,
}

#[get("/info/{id}")]
async fn get_album_info(id: web::Path<String>, query: web::Query<AlbumQuery>) -> HttpResponse {
    let bare = query.bare.unwrap_or(false);
    match fetch_album_info(id.into_inner(), Some(bare)).await {
        Ok(album) => HttpResponse::Ok().json(album),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

#[derive(Deserialize)]
pub struct AddAlbumForm {
    album: Album,
    artist_id: Option<String>,
}

#[post("/add")]
pub async fn add_album(form: web::Json<AddAlbumForm>) -> HttpResponse {
    let new_album = form.album.clone();
    let artist_id = form.artist_id.clone();

    let mut library = match fetch_library().await {
        Ok(lib) => lib,
        Err(_) => return HttpResponse::InternalServerError().finish(),
    };

    if let Some(artist_id) = artist_id {
        for artist in Arc::make_mut(&mut library).iter_mut() {
            if artist.id == artist_id {
                artist.albums.push(new_album.clone());
                break;
            }
        }
    } else {
        let artist_name = new_album.name.clone();

        let mut artist_found = false;
        for artist in Arc::make_mut(&mut library).iter_mut() {
            if artist.name == artist_name {
                artist.albums.push(new_album.clone());
                artist_found = true;
                break;
            }
        }

        if !artist_found {
            let new_artist = Artist {
                id: hash_artist(&artist_name),
                name: artist_name.clone(),
                albums: vec![new_album.clone()],
                featured_on_album_ids: vec![],
                icon_url: String::new(),
                followers: 0,
                description: String::new(),
                tadb_music_videos: None,
            };
            Arc::make_mut(&mut library).push(new_artist);
        }
    }

    if save_library(&library).await.is_err() {
        return HttpResponse::InternalServerError().finish();
    }

    if refresh_cache().await.is_err() {
        return HttpResponse::InternalServerError().finish();
    }

    match populate_search_data().await {
        Ok(_) => {},
        Err(e) => {
            error!("Failed to populate search data: {:?}", e);
        }
    }

    HttpResponse::Ok().finish()
}

#[derive(Deserialize)]
pub struct DeleteAlbumForm {
    album_id: String,
}

#[delete("/delete")]
pub async fn delete_album(form: web::Json<DeleteAlbumForm>) -> HttpResponse {
    let album_id = form.album_id.clone();

    let mut library = match fetch_library().await {
        Ok(lib) => lib,
        Err(_) => return HttpResponse::InternalServerError().finish(),
    };

    let mut album_found = false;

    for artist in Arc::make_mut(&mut library).iter_mut() {
        artist.albums.retain(|album| {
            if album.id == album_id {
                album_found = true;
                false
            } else {
                true
            }
        });
        if album_found {
            break;
        }
    }

    if !album_found {
        return HttpResponse::NotFound().finish();
    }

    if save_library(&library).await.is_err() {
        return HttpResponse::InternalServerError().finish();
    }

    if refresh_cache().await.is_err() {
        return HttpResponse::InternalServerError().finish();
    }

    match populate_search_data().await {
        Ok(_) => {},
        Err(e) => {
            error!("Failed to populate search data: {:?}", e);
        }
    }

    HttpResponse::Ok().finish()
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/album")
            .service(get_random_album)
            .service(get_album_info)
            .service(edit_album_metadata)
            .service(add_album)
            .service(delete_album)
    );
}