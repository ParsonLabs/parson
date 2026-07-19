use std::collections::{HashMap, HashSet};

use actix_web::{HttpResponse, get, web};
use serde::{Deserialize, Serialize};

use crate::domain::{Album, Artist, Song};
use crate::library::state::{LibraryCache, LibraryLifecycle, library_unavailable_response};

const DEFAULT_PAGE_SIZE: usize = 100;
const MAX_PAGE_SIZE: usize = 500;
const MAX_PAGE_OFFSET: usize = 100_000;
const MAX_GENRE_RESULTS: usize = 1_000;
const MAX_GENRE_CHARACTERS: usize = 128;

#[derive(Deserialize)]
struct CollectionQuery {
    limit: Option<usize>,
    offset: Option<usize>,
}

fn page_bounds(query: &CollectionQuery) -> (usize, usize) {
    (
        query.offset.unwrap_or(0).min(MAX_PAGE_OFFSET),
        query
            .limit
            .unwrap_or(DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE),
    )
}

fn valid_genre(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= MAX_GENRE_CHARACTERS
}

#[derive(Serialize)]
struct GenreStat {
    name: String,
    song_count: usize,
    cover_image: Option<String>,
}

fn normalized(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn matches(album: &Album, genre: &str, cache: &LibraryCache) -> bool {
    let genre = normalized(genre);
    cache.album_genres.get(&album.id).is_some_and(|genres| {
        genres
            .iter()
            .any(|candidate| normalized(candidate) == genre)
    })
}

#[get("")]
async fn list(lifecycle: web::Data<LibraryLifecycle>) -> HttpResponse {
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let mut genres = cache
        .album_genres
        .values()
        .flatten()
        .filter(|genre| !genre.trim().is_empty())
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    genres.sort_by_key(|genre| genre.to_lowercase());
    genres.truncate(MAX_GENRE_RESULTS);
    HttpResponse::Ok().json(genres)
}

#[get("/popular")]
async fn popular(lifecycle: web::Data<LibraryLifecycle>) -> HttpResponse {
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let mut stats = HashMap::<String, (usize, Option<String>)>::new();
    for artist in cache.artists.iter() {
        for album in &artist.albums {
            for genre in cache.album_genres.get(&album.id).into_iter().flatten() {
                let entry = stats.entry(genre.clone()).or_default();
                entry.0 += album.songs.len();
                if entry.1.is_none() && !album.cover_url.is_empty() {
                    entry.1 = Some(album.cover_url.clone());
                }
            }
        }
    }
    let mut stats = stats
        .into_iter()
        .map(|(name, (song_count, cover_image))| GenreStat {
            name,
            song_count,
            cover_image,
        })
        .collect::<Vec<_>>();
    stats.sort_by_key(|genre| std::cmp::Reverse(genre.song_count));
    stats.truncate(MAX_GENRE_RESULTS);
    HttpResponse::Ok().json(stats)
}

#[get("/{genre}/albums")]
async fn albums(
    genre: web::Path<String>,
    query: web::Query<CollectionQuery>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    if !valid_genre(&genre) {
        return HttpResponse::BadRequest().finish();
    }
    let (offset, limit) = page_bounds(&query);
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let albums = cache
        .artists
        .iter()
        .flat_map(|artist| &artist.albums)
        .filter(|album| matches(album, &genre, &cache))
        .skip(offset)
        .take(limit)
        .cloned()
        .collect::<Vec<Album>>();
    HttpResponse::Ok().json(albums)
}

#[get("/{genre}/artists")]
async fn artists(
    genre: web::Path<String>,
    query: web::Query<CollectionQuery>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    if !valid_genre(&genre) {
        return HttpResponse::BadRequest().finish();
    }
    let (offset, limit) = page_bounds(&query);
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let artists = cache
        .artists
        .iter()
        .filter(|artist| {
            artist
                .albums
                .iter()
                .any(|album| matches(album, &genre, &cache))
        })
        .skip(offset)
        .take(limit)
        .cloned()
        .collect::<Vec<Artist>>();
    HttpResponse::Ok().json(artists)
}

#[get("/{genre}/songs")]
async fn songs(
    genre: web::Path<String>,
    query: web::Query<CollectionQuery>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    if !valid_genre(&genre) {
        return HttpResponse::BadRequest().finish();
    }
    let (offset, limit) = page_bounds(&query);
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let songs = cache
        .artists
        .iter()
        .flat_map(|artist| &artist.albums)
        .filter(|album| matches(album, &genre, &cache))
        .flat_map(|album| &album.songs)
        .skip(offset)
        .take(limit)
        .cloned()
        .collect::<Vec<Song>>();
    HttpResponse::Ok().json(songs)
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/genres")
            .service(list)
            .service(popular)
            .service(albums)
            .service(artists)
            .service(songs),
    );
}

#[cfg(test)]
mod tests {
    use super::{CollectionQuery, MAX_PAGE_OFFSET, MAX_PAGE_SIZE, page_bounds, valid_genre};

    #[test]
    fn genre_collections_have_bounded_pages_and_inputs() {
        assert_eq!(
            page_bounds(&CollectionQuery {
                limit: Some(usize::MAX),
                offset: Some(usize::MAX),
            }),
            (MAX_PAGE_OFFSET, MAX_PAGE_SIZE)
        );
        assert!(valid_genre("Alternative"));
        assert!(!valid_genre(""));
        assert!(!valid_genre(&"x".repeat(129)));
    }
}
