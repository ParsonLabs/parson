use std::collections::HashSet;
use std::sync::Arc;

use actix_web::{get, post, web, HttpResponse};
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use tracing::error;

use crate::routes::search::populate_search_data;
use crate::structures::structures::{Album, Artist, MusicVideo, Song};
use crate::utils::config::{fetch_library, get_config, refresh_cache, save_library};
use crate::utils::hash::{hash_album, hash_artist};

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

#[derive(Serialize)]
pub enum SongInfo {
    Full(ResponseSong),
    Bare(Song),
}

pub async fn fetch_song_info(song_id: String, include: Option<HashSet<String>>, bare: Option<bool>) -> Result<SongInfo, ()> {
    let library = fetch_library().await.map_err(|_| ())?;
    let bare = bare.unwrap_or(false);

    for artist in library.iter() {
        for album in artist.albums.iter() {
            for song in album.songs.iter() {
                if song.id == song_id {
                    if bare {
                        return Ok(SongInfo::Bare(song.clone()));
                    }

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

                    return Ok(SongInfo::Full(ResponseSong {
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
                    }));
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

#[derive(Deserialize)]
pub struct SongQuery {
    bare: Option<bool>,
}

#[get("/info/{id}")]
async fn get_song_info(id: web::Path<String>, query: web::Query<SongQuery>) -> HttpResponse {
    let id_str = id.into_inner();
    let bare = query.bare.unwrap_or(false);
    match fetch_song_info(id_str.clone(), None, Some(bare)).await {
        Ok(song) => HttpResponse::Ok().json(song),
        Err(_) => {
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

#[post("/edit/{id}")]
async fn edit_song_metadata(form: web::Json<Song>) -> HttpResponse {
    let mut library = match fetch_library().await {
        Ok(lib) => lib,
        Err(_) => return HttpResponse::InternalServerError().finish(),
    };

    let new_song = form.into_inner();
    let mut song_found = false;

    for artist in Arc::make_mut(&mut library).iter_mut() {
        for album in artist.albums.iter_mut() {
            for song in album.songs.iter_mut() {
                if song.id == new_song.id {
                    *song = new_song.clone();
                    song_found = true;
                    break;
                }
            }
        }
    }

    if song_found {
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
pub struct AddSongForm {
    song: Song,
    artist_id: Option<String>,
    album_id: Option<String>,
}

#[post("/add")]
pub async fn add_song(form: web::Json<AddSongForm>) -> HttpResponse {
    let new_song = form.song.clone();
    let artist_id = form.artist_id.clone();
    let album_id = form.album_id.clone();

    let mut library = match fetch_library().await {
        Ok(lib) => lib,
        Err(_) => return HttpResponse::InternalServerError().finish(),
    };

    if let Some(artist_id) = artist_id {
        for artist in Arc::make_mut(&mut library).iter_mut() {
            if artist.id == artist_id {
                if let Some(album_id) = album_id {
                    for album in artist.albums.iter_mut() {
                        if album.id == album_id {
                            album.songs.push(new_song.clone());
                            break;
                        }
                    }
                } else {
                    let new_album = Album {
                        id: hash_album(&new_song.name, &artist.name),
                        name: new_song.name.clone(),
                        cover_url: String::new(),
                        songs: vec![new_song.clone()],
                        first_release_date: String::new(),
                        musicbrainz_id: String::new(),
                        wikidata_id: None,
                        primary_type: String::new(),
                        description: String::new(),
                        contributing_artists: vec![],
                        contributing_artists_ids: vec![],
                        release_album: None,
                        release_group_album: None,
                    };
                    artist.albums.push(new_album);
                }
                break;
            }
        }
    } else {
        let artist_name = new_song.artist.clone();
        let album_name = new_song.name.clone();

        let mut artist_found = false;
        for artist in Arc::make_mut(&mut library).iter_mut() {
            if artist.name == artist_name {
                for album in artist.albums.iter_mut() {
                    if album.name == album_name {
                        album.songs.push(new_song.clone());
                        artist_found = true;
                        break;
                    }
                }
                if !artist_found {
                    let new_album = Album {
                        id: hash_album(&album_name, &artist_name),
                        name: album_name.clone(),
                        cover_url: String::new(),
                        songs: vec![new_song.clone()],
                        first_release_date: String::new(),
                        musicbrainz_id: String::new(),
                        wikidata_id: None,
                        primary_type: String::new(),
                        description: String::new(),
                        contributing_artists: vec![],
                        contributing_artists_ids: vec![],
                        release_album: None,
                        release_group_album: None,
                    };
                    artist.albums.push(new_album);
                }
                artist_found = true;
                break;
            }
        }

        if !artist_found {
            let new_artist = Artist {
                id: hash_artist(&artist_name),
                name: artist_name.clone(),
                albums: vec![Album {
                    id: hash_album(&album_name, &artist_name),
                    name: album_name.clone(),
                    cover_url: String::new(),
                    songs: vec![new_song.clone()],
                    first_release_date: String::new(),
                    musicbrainz_id: String::new(),
                    wikidata_id: None,
                    primary_type: String::new(),
                    description: String::new(),
                    contributing_artists: vec![],
                    contributing_artists_ids: vec![],
                    release_album: None,
                    release_group_album: None,
                }],
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

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/song")
            .service(get_song_info)
            .service(get_random_song)
            .service(get_songs_with_music_videos)
            .service(edit_song_metadata)
            .service(add_song)
    );
}