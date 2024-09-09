use actix_web::{get, web, HttpResponse};
use rand::seq::{IteratorRandom, SliceRandom};
use serde::{Deserialize, Serialize};
use tracing::error;

use crate::structures::structures::{Album, Artist, Song};
use crate::utils::config::get_config;

#[derive(Serialize, Deserialize, Clone)]
pub struct ResponseSong {
    pub id: String,
    pub name: String,
    pub artist: String,
    pub contributing_artists: Vec<String>,
    pub track_number: u16,
    pub path: String,
    pub duration: f64,
    pub album_object: Album,
    pub artist_object: Artist,
}

pub async fn fetch_random_songs(amount: usize) -> Result<Vec<ResponseSong>, ()> {
    let config = get_config().await.map_err(|_| ())?;
    let library: Vec<Artist> = serde_json::from_str(&config).map_err(|_| ())?;

    let mut response_songs = Vec::new();
    let mut rng = rand::thread_rng();

    for _ in 0..amount {
        let mut valid_artist = None;
        let mut valid_album = None;
        let mut valid_song = None;

        for _ in 0..10 {
            if let Some(artist) = library.iter().choose(&mut rng) {
                if !artist.albums.is_empty() {
                    valid_artist = Some(artist);
                    break;
                }
            }
        }

        if let Some(artist) = valid_artist {
            for _ in 0..10 {
                if let Some(album) = artist.albums.choose(&mut rng) {
                    if !album.songs.is_empty() {
                        valid_album = Some(album);
                        break;
                    }
                }
            }
        }

        if let Some(album) = valid_album {
            if let Some(song) = album.songs.choose(&mut rng) {
                valid_song = Some(song);
            }
        }

        if let Some(song) = valid_song {
            let response_song = ResponseSong {
                id: song.id.clone(),
                name: song.name.clone(),
                artist: song.artist.clone(),
                contributing_artists: song.contributing_artists.clone(),
                track_number: song.track_number,
                path: song.path.clone(),
                duration: song.duration,
                album_object: valid_album.unwrap().clone(),
                artist_object: valid_artist.unwrap().to_owned().clone(),
            };

            response_songs.push(response_song);
        }
    }

    Ok(response_songs)
}

pub async fn fetch_song_info(song_id: String) -> Result<ResponseSong, ()> {
    let config = get_config().await.map_err(|_| ())?;
    let library: Vec<Artist> = serde_json::from_str(&config).map_err(|_| ())?;

    for artist in &library {
        for album in &artist.albums {
            for song in &album.songs {
                if song.id == song_id {
                    return Ok(ResponseSong {
                        id: song.id.clone(),
                        name: song.name.clone(),
                        artist: song.artist.clone(),
                        contributing_artists: song.contributing_artists.clone(),
                        track_number: song.track_number,
                        path: song.path.clone(),
                        duration: song.duration,
                        album_object: album.clone(),
                        artist_object: artist.clone(),
                    });
                }
            }
        }
    }

    Err(())
}

#[get("/random/{amount}")]
async fn get_random_song(amount: web::Path<usize>) -> HttpResponse {
    match fetch_random_songs(*amount).await {
        Ok(songs) => HttpResponse::Ok().json(songs),
        Err(_) => HttpResponse::InternalServerError().json("Failed to load configuration"),
    }
}

#[get("/info/{id}")]
async fn get_song_info(id: web::Path<String>) -> HttpResponse {
    let id_str = id.into_inner();
    match fetch_song_info(id_str.clone()).await {
        Ok(song) => HttpResponse::Ok().json(song),
        Err(_) => {
            error!("Song with ID {} not found.", id_str);
            HttpResponse::NotFound().finish()
        }
    }
}

pub async fn fetch_songs_with_music_videos() -> Result<Vec<Song>, ()> {
    let config = get_config().await.map_err(|_| ())?;
    let library: Vec<Artist> = serde_json::from_str(&config).map_err(|_| ())?;

    let mut response_songs = Vec::new();

    for artist in &library {
        for album in &artist.albums {
            for song in &album.songs {
                if song.music_video.is_some() {
                    response_songs.push(song.clone());
                }
            }
        }
    }

    Ok(response_songs)
}

#[get("/music_videos")]
async fn get_songs_with_music_videos() -> HttpResponse {
    match fetch_songs_with_music_videos().await {
        Ok(songs) => HttpResponse::Ok().json(songs),
        Err(_) => HttpResponse::InternalServerError().json("Failed to load configuration"),
    }
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/song")
            .service(get_song_info)
            .service(get_random_song)
            .service(get_songs_with_music_videos)
    );
}