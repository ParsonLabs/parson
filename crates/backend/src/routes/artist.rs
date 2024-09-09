use actix_web::{get, web, HttpResponse};
use rand::seq::SliceRandom;

use crate::structures::structures::Artist;
use crate::utils::config::get_config;

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

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/artist")
            .service(get_random_artist)
            .service(get_artist_info),
    );
}