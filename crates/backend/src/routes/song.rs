use std::collections::HashSet;

use actix_web::{get, web, HttpResponse};
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use tracing::error;

use crate::structures::structures::{Album, Artist, MusicVideo, Song};
use crate::utils::config::{fetch_library, get_config};

use super::genres::fetch_albums_by_genres;

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
    pub music_video: MusicVideo,
}


pub async fn fetch_random_songs(amount: usize, genre: Option<String>) -> Result<Vec<ResponseSong>, ()> {
    let config = get_config().await.map_err(|_| ())?;
    let library: Vec<Artist> = serde_json::from_str(&config).map_err(|_| ())?;

    let mut response_songs = Vec::new();
    let mut rng = rand::thread_rng();

    let albums: Vec<Album> = if let Some(ref genre) = genre {
        fetch_albums_by_genres(vec![genre.clone()]).await?
    } else {
        library.iter().flat_map(|artist| artist.albums.clone()).collect()
    };

    for _ in 0..amount {
        let mut valid_album = None;
        let mut valid_song = None;

        for _ in 0..10 {
            if let Some(album) = albums.choose(&mut rng) {
                if !album.songs.is_empty() {
                    valid_album = Some(album.clone());
                    break;
                }
            }
        }

        if let Some(ref album) = valid_album {
            if let Some(song) = album.songs.choose(&mut rng) {
                valid_song = Some(song.clone());
            }
        }

        if let Some(song) = valid_song {
            let artist_object = library.iter()
                .find(|artist| artist.albums.iter().any(|a| a.id == valid_album.as_ref().unwrap().id))
                .unwrap()
                .clone();

            let response_song = ResponseSong {
                id: song.id.clone(),
                name: song.name.clone(),
                artist: song.artist.clone(),
                contributing_artists: song.contributing_artists.clone(),
                track_number: song.track_number,
                path: song.path.clone(),
                duration: song.duration,
                album_object: valid_album.clone().unwrap(),
                artist_object,
                music_video: song.music_video.unwrap_or_default(),
            };

            response_songs.push(response_song);
        }
    }

    Ok(response_songs)
}

pub async fn fetch_song_info(song_id: String, include: Option<HashSet<String>>) -> Result<ResponseSong, ()> {
    let library = fetch_library().await.map_err(|_| ())?;

    for artist in library.iter() {
        for album in artist.albums.iter() {
            for song in album.songs.iter() {
                if song.id == song_id {
                    let include_fields = include.unwrap_or_else(|| {
                        let mut all_fields = HashSet::new();
                        all_fields.insert("id".to_string());
                        all_fields.insert("name".to_string());
                        all_fields.insert("artist".to_string());
                        all_fields.insert("contributing_artists".to_string());
                        all_fields.insert("track_number".to_string());
                        all_fields.insert("path".to_string());
                        all_fields.insert("duration".to_string());
                        all_fields.insert("album_object".to_string());
                        all_fields.insert("artist_object".to_string());
                        all_fields.insert("music_video".to_string());
                        all_fields
                    });

                    return Ok(ResponseSong {
                        id: if include_fields.contains("id") { song.id.clone() } else { String::new() },
                        name: if include_fields.contains("name") { song.name.clone() } else { String::new() },
                        artist: if include_fields.contains("artist") { song.artist.clone() } else { String::new() },
                        contributing_artists: if include_fields.contains("contributing_artists") { song.contributing_artists.clone() } else { vec![String::new()] },
                        track_number: if include_fields.contains("track_number") { song.track_number } else { 0 },
                        path: if include_fields.contains("path") { song.path.clone() } else { String::new() },
                        duration: if include_fields.contains("duration") { song.duration } else { 0.0 },
                        album_object: if include_fields.contains("album_object") { album.clone() } else { Album::default() },
                        artist_object: if include_fields.contains("artist_object") { artist.clone() } else { Artist::default() },
                        music_video: if include_fields.contains("music_video") { song.music_video.clone().unwrap_or_default() } else { MusicVideo::default() },
                    });
                }
            }
        }
    }

    Err(())
}

#[derive(Deserialize)]
struct RandomSongQuery {
    genre: Option<String>,
}

#[get("/random/{amount}")]
async fn get_random_song(amount: web::Path<usize>, query: web::Query<RandomSongQuery>) -> HttpResponse {
    match fetch_random_songs(*amount, query.genre.clone()).await {
        Ok(songs) => HttpResponse::Ok().json(songs),
        Err(_) => HttpResponse::InternalServerError().json("Failed to load configuration"),
    }
}

#[get("/info/{id}")]
async fn get_song_info(id: web::Path<String>) -> HttpResponse {
    let id_str = id.into_inner();
    match fetch_song_info(id_str.clone(), None).await {
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