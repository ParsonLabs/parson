use std::sync::Arc;

use actix_web::{delete, get, post, web, HttpResponse};
use rand::seq::SliceRandom;
use serde::Deserialize;

pub use crate::structures::structures::Artist;
use crate::utils::config::{fetch_library, get_config, refresh_cache, save_library};

pub async fn fetch_random_artists(amount: usize) -> Result<Vec<Artist>, ()> {
    let config = get_config().await.map_err(|_| ())?;
    let library: Vec<Artist> = serde_json::from_str(&config).map_err(|_| ())?;

    let artists_with_albums: Vec<&Artist> = library.iter().filter(|artist| !artist.albums.is_empty()).collect();

    let mut random_artists = Vec::new();
    let mut rng = rand::thread_rng();

    for _ in 0..amount {
        if artists_with_albums.is_empty() {
            break;
        }

        if let Some(artist) = artists_with_albums.choose(&mut rng) {
            random_artists.push((*artist).clone());
        }
    }

    Ok(random_artists)
}

pub async fn fetch_artist_info(artist_id: String) -> Result<Artist, ()> {
    let config = get_config().await.map_err(|_| ())?;
    let library: Vec<Artist> = serde_json::from_str(&config).map_err(|_| ())?;

    for artist in library.iter() {
        if artist.id == artist_id {
            return Ok(artist.clone());
        }
    }

    Err(())
}

#[get("/random/{amount}")]
async fn get_random_artist(amount: web::Path<usize>) -> HttpResponse {
    match fetch_random_artists(*amount).await {
        Ok(artists) => HttpResponse::Ok().json(artists),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

#[get("/info/{id}")]
async fn get_artist_info(id: web::Path<String>) -> HttpResponse {
    match fetch_artist_info(id.into_inner()).await {
        Ok(artist) => HttpResponse::Ok().json(artist),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

#[post("/edit/{id}")]
async fn edit_artist_metadata(form: web::Json<Artist>) -> HttpResponse {
    let mut library = match fetch_library().await {
        Ok(lib) => lib,
        Err(_) => return HttpResponse::InternalServerError().finish(),
    };

    let new_artist= form.into_inner();
    let mut artist_found = false;

    for artist in Arc::make_mut(&mut library).iter_mut() {
        if artist.id == new_artist.id {
            *artist= new_artist.clone();
            artist_found = true;
            break;
        }
    }

    if artist_found {
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

#[derive(Deserialize)]
pub struct AddArtistForm {
    artist: Artist,
}

#[post("/add")]
pub async fn add_artist(form: web::Json<AddArtistForm>) -> HttpResponse {
    let new_artist = form.artist.clone();

    let mut library = match fetch_library().await {
        Ok(lib) => lib,
        Err(_) => return HttpResponse::InternalServerError().finish(),
    };

    Arc::make_mut(&mut library).push(new_artist);

    if save_library(&library).await.is_err() {
        return HttpResponse::InternalServerError().finish();
    }

    if refresh_cache().await.is_err() {
        return HttpResponse::InternalServerError().finish();
    }

    HttpResponse::Ok().finish()
}

#[derive(Deserialize)]
pub struct DeleteArtistForm {
    artist_id: String,
}

#[delete("/delete")]
pub async fn delete_artist(form: web::Json<DeleteArtistForm>) -> HttpResponse {
    let artist_id = form.artist_id.clone();

    let mut library = match fetch_library().await {
        Ok(lib) => lib,
        Err(_) => return HttpResponse::InternalServerError().finish(),
    };

    let initial_len = library.len();
    Arc::make_mut(&mut library).retain(|artist| artist.id != artist_id);

    if library.len() == initial_len {
        return HttpResponse::NotFound().finish();
    }

    if save_library(&library).await.is_err() {
        return HttpResponse::InternalServerError().finish();
    }

    if refresh_cache().await.is_err() {
        return HttpResponse::InternalServerError().finish();
    }

    HttpResponse::Ok().finish()
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/artist")
            .service(get_random_artist)
            .service(get_artist_info)
            .service(edit_artist_metadata)
    );
}