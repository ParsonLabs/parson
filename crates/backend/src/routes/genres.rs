use actix_web::{get, web, HttpResponse};
use std::collections::HashSet;
use crate::structures::structures::{Album, Artist, Genre, Song};
use crate::config::get_config;
use crate::utils::config::fetch_library;
use serde::Deserialize;
use serde_json::from_str;

#[derive(Deserialize)]
struct GenresQuery {
    genres: String,
}

#[get("/list")]
async fn list_all_genres_route() -> HttpResponse {
    match list_all_genres().await {
        Ok(genres) => HttpResponse::Ok().json(genres),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

#[get("/albums")]
async fn get_albums_by_genres(query: web::Query<GenresQuery>) -> HttpResponse {
    let genres: Vec<String> = query.genres.split(|c| c == ',' || c == '+' || c == ' ').map(String::from).collect();
    match fetch_albums_by_genres(genres).await {
        Ok(albums) => HttpResponse::Ok().json(albums),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

#[get("/artists")]
async fn get_artists_by_genres(query: web::Query<GenresQuery>) -> HttpResponse {
    let genres: Vec<String> = query.genres.split(|c| c == ',' || c == '+' || c == ' ').map(String::from).collect();
    match fetch_artists_by_genres(genres).await {
        Ok(artists) => HttpResponse::Ok().json(artists),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

#[get("/songs")]
async fn get_songs_by_genres(query: web::Query<GenresQuery>) -> HttpResponse {
    let genres: Vec<String> = query.genres.split(|c| c == ',' || c == '+' || c == ' ').map(String::from).collect();
    match fetch_songs_by_genres(genres).await {
        Ok(songs) => HttpResponse::Ok().json(songs),
        Err(_) => HttpResponse::InternalServerError().finish(),
    }
}

pub async fn list_all_genres() -> Result<HashSet<String>, ()> {
    let config = get_config().await.map_err(|_| ())?;
    let library: Vec<Artist> = from_str(&config).map_err(|_| ())?;

    let mut genres = HashSet::new();
    let mut seen_genres = HashSet::new();

    for artist in &library {
        for album in &artist.albums {
            if let Some(release_album) = &album.release_album {
                for genre in &release_album.genres {
                    let genre_key = format!("{}:{}", genre.name, album.musicbrainz_id);
                    if !seen_genres.contains(&genre_key) {
                        genres.insert(genre.name.clone());
                        seen_genres.insert(genre_key);
                    }
                }
            }
            if let Some(release_group_album) = &album.release_group_album {
                for genre in &release_group_album.genres {
                    let genre_key = format!("{}:{}", genre.name, album.musicbrainz_id);
                    if !seen_genres.contains(&genre_key) {
                        genres.insert(genre.name.clone());
                        seen_genres.insert(genre_key);
                    }
                }
            }
        }
    }
    Ok(genres)
}

pub async fn fetch_albums_by_genres(genres: Vec<String>) -> Result<Vec<Album>, ()> {
    let config = get_config().await.map_err(|_| ())?;
    let library: Vec<Artist> = from_str(&config).map_err(|_| ())?;

    let mut response_albums = Vec::new();
    let genre_set: HashSet<String> = genres.into_iter().collect();

    for artist in &library {
        for album in &artist.albums {
            if let Ok(album_genres) = get_genre_info_by_album(&album.id).await {
                let album_genre_names: HashSet<String> = album_genres.into_iter().map(|g| g.name).collect();
                if !album_genre_names.is_disjoint(&genre_set) {
                    response_albums.push(album.clone());
                }
            }
        }
    }
    Ok(response_albums)
}

pub async fn fetch_artists_by_genres(genres: Vec<String>) -> Result<Vec<Artist>, ()> {
    let config = get_config().await.map_err(|_| ())?;
    let library: Vec<Artist> = from_str(&config).map_err(|_| ())?;

    let mut response_artists = Vec::new();
    let genre_set: HashSet<String> = genres.into_iter().collect();

    for artist in &library {
        for album in &artist.albums {
            if let Ok(album_genres) = get_genre_info_by_album(&album.id).await {
                let album_genre_names: HashSet<String> = album_genres.into_iter().map(|g| g.name).collect();
                if !album_genre_names.is_disjoint(&genre_set) {
                    response_artists.push(artist.clone());
                    break;
                }
            }
        }
    }
    Ok(response_artists)
}

pub async fn fetch_songs_by_genres(genres: Vec<String>) -> Result<Vec<Song>, ()> {
    let config = get_config().await.map_err(|_| ())?;
    let library: Vec<Artist> = from_str(&config).map_err(|_| ())?;

    let mut response_songs = Vec::new();
    let genre_set: HashSet<String> = genres.into_iter().collect();

    for artist in &library {
        for album in &artist.albums {
            for song in &album.songs {
                if let Ok(song_genres) = get_genre_info_by_song(&song.id).await {
                    let song_genre_names: HashSet<String> = song_genres.into_iter().map(|g| g.name).collect();
                    if !song_genre_names.is_disjoint(&genre_set) {
                        response_songs.push(song.clone());
                    }
                }
            }
        }
    }
    Ok(response_songs)
}

pub async fn get_genre_info_by_song(song_id: &str) -> Result<Vec<Genre>, ()> {
    let library = fetch_library().await.map_err(|_| ())?;

    for artist in library.iter() {
        for album in artist.albums.iter() {
            for song in album.songs.iter() {
                if song.id == song_id {
                    return Ok(get_genres_from_album(album));
                }
            }
        }
    }

    Err(())
}

pub async fn get_genre_info_by_album(album_id: &str) -> Result<Vec<Genre>, ()> {
    let library = fetch_library().await.map_err(|_| ())?;

    for artist in library.iter() {
        for album in artist.albums.iter() {
            if album.id == album_id {
                return Ok(get_genres_from_album(album));
            }
        }
    }

    Err(())
}

fn get_genres_from_album(album: &Album) -> Vec<Genre> {
    let mut genres = Vec::new();
    if let Some(release_album) = &album.release_album {
        genres.extend(release_album.genres.clone());
    }
    if let Some(release_group_album) = &album.release_group_album {
        genres.extend(release_group_album.genres.clone());
    }
    genres
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/genres")
            .service(list_all_genres_route)
            .service(get_albums_by_genres)
            .service(get_artists_by_genres)
            .service(get_songs_by_genres),
    );
}