use actix_web::{get, web, HttpResponse};
use std::collections::HashSet;
use crate::structures::structures::{Artist, Album, Song};
use crate::config::get_config;
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
            let mut album_genres = HashSet::new();
            if let Some(release_album) = &album.release_album {
                for genre in &release_album.genres {
                    album_genres.insert(genre.name.clone());
                }
            }
            if let Some(release_group_album) = &album.release_group_album {
                for genre in &release_group_album.genres {
                    album_genres.insert(genre.name.clone());
                }
            }
            if !album_genres.is_disjoint(&genre_set) {
                response_albums.push(album.clone());
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
        let mut artist_genres = HashSet::new();
        for album in &artist.albums {
            if let Some(release_album) = &album.release_album {
                for genre in &release_album.genres {
                    artist_genres.insert(genre.name.clone());
                }
            }
            if let Some(release_group_album) = &album.release_group_album {
                for genre in &release_group_album.genres {
                    artist_genres.insert(genre.name.clone());
                }
            }
        }
        if !artist_genres.is_disjoint(&genre_set) {
            response_artists.push(artist.clone());
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
                let mut song_genres = HashSet::new();
                if let Some(release_album) = &album.release_album {
                    for genre in &release_album.genres {
                        song_genres.insert(genre.name.clone());
                    }
                }
                if let Some(release_group_album) = &album.release_group_album {
                    for genre in &release_group_album.genres {
                        song_genres.insert(genre.name.clone());
                    }
                }
                if !song_genres.is_disjoint(&genre_set) {
                    response_songs.push(song.clone());
                }
            }
        }
    }
    Ok(response_songs)
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