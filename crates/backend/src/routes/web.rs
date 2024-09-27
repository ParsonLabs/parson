use actix_web::{get, web, HttpResponse};
use futures::future::join_all;
use rand::seq::SliceRandom;
use tokio::task;

use crate::structures::structures::{Album, Artist, Genre};
use crate::utils::config::fetch_library;

use super::album::ResponseAlbum;
use super::user::fetch_listen_history;
use super::genres::{fetch_albums_by_genres, get_genre_info_by_song};

use std::convert::TryInto;
use std::collections::HashMap;

#[derive(Clone, Debug, serde::Serialize)]
struct SongInfo {
    song_name: String,
    song_id: String,
    song_path: String,
    artist_id: String,
    artist_name: String,
    album_id: String,
    album_name: String,
    album_cover: String,
    album_songs_count: usize,
    release_date: String,
    item_type: String,
}

#[derive(Clone, Debug, serde::Serialize)]
struct AlbumCardProps {
    artist_id: String,
    artist_name: String,
    album_id: String,
    album_name: String,
    album_cover: String,
    album_songs_count: usize,
    first_release_date: String,
}

async fn find_song_info_min(song_id: String) -> Result<SongInfo, ()> {
    let library = fetch_library().await.map_err(|_| ())?;

    for artist in library.iter() {
        for album in artist.albums.iter() {
            for song in album.songs.iter() {
                if song.id == song_id {
                    return Ok(SongInfo {
                        song_name: song.name.clone(),
                        song_id: song.id.clone(),
                        song_path: song.path.clone(),
                        artist_id: artist.id.clone(),
                        artist_name: artist.name.clone(),
                        album_id: album.id.clone(),
                        album_name: album.name.clone(),
                        album_cover: album.cover_url.clone(),
                        release_date: album.first_release_date.clone(),
                        album_songs_count: album.songs.len().clone(),
                        item_type: "song".to_string(),
                    });
                }
            }
        }
    }

    Err(())
}

async fn fetch_listen_history_songs(user_id: u32) -> Result<Vec<SongInfo>, ()> {
    let listen_history_items = fetch_listen_history(user_id.try_into().unwrap()).await.unwrap();
    
    let mut unique_listen_history_items: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    
    for item in listen_history_items.into_iter().rev() {
        if seen.insert(item.song_id.clone()) {
            unique_listen_history_items.push(item.song_id);
        }
    }

    let unique_listen_history_items: Vec<String> = unique_listen_history_items.into_iter().take(30).collect();

    let tasks: Vec<_> = unique_listen_history_items
        .into_iter()
        .map(|song_id| {
            let song_id = song_id.clone();
            task::spawn(async move {
                find_song_info_min(song_id).await
            })
        })
        .collect();

    let songs_info: Vec<SongInfo> = join_all(tasks)
        .await
        .into_iter()
        .filter_map(|res| res.ok())
        .filter_map(|res| res.ok())
        .collect();

    let mut album_count: HashMap<String, Vec<SongInfo>> = HashMap::new();
    for song in &songs_info {
        album_count.entry(song.album_id.clone()).or_insert(Vec::new()).push(song.clone());
    }

    let mut result: Vec<SongInfo> = Vec::new();
    for (album_id, songs) in album_count {
        if songs.len() >= 3 {
            result.push(SongInfo {
                song_name: songs[0].album_name.clone(),
                song_id: album_id.clone(),
                song_path: "".to_string(),
                artist_id: songs[0].artist_id.clone(),
                artist_name: songs[0].artist_name.clone(),
                album_id: album_id.clone(),
                album_name: songs[0].album_name.clone(),
                album_cover: songs[0].album_cover.clone(),
                album_songs_count: songs[0].album_songs_count.clone(),
                release_date: songs[0].release_date.clone(),
                item_type: "album".to_string(),
            });
        } else {
            result.extend(songs);
        }
    }

    result.truncate(30);

    Ok(result)
}

async fn fetch_similar_albums(user_id: u32) -> Result<(Vec<AlbumCardProps>, String), ()> {
    let listen_history_songs = fetch_listen_history_songs(user_id).await?;
    
    let last_10_songs: Vec<_> = listen_history_songs.iter().take(10).collect();
    
    if last_10_songs.is_empty() {
        return Err(());
    }
    
    let random_song = match last_10_songs.choose(&mut rand::thread_rng()) {
        Some(song) => song,
        None => return Err(()),
    };
    
    
    let song_genres = get_genre_info_by_song(&random_song.song_id).await?;
    let song_genre = song_genres.into_iter().next().unwrap_or(Genre {
        musicbrainz_id: String::new(),
        disambiguation: String::new(),
        name: String::new(),
        count: 0,
    });

    if song_genre.name.is_empty() {
        return Err(());
    }

    let similar_albums = fetch_albums_by_genres(vec![song_genre.name.clone()]).await.unwrap();
    let similar_albums: Vec<_> = similar_albums.into_iter().take(30).collect();

    let album_ids: Vec<String> = similar_albums.into_iter().map(|album| album.id).collect();
    let albums_info: Vec<ResponseAlbum> = fetch_albums_info(album_ids).await?;

    let album_card_props: Vec<AlbumCardProps> = albums_info.into_iter().map(|album| {
        AlbumCardProps {
            artist_id: album.artist_object.id,
            artist_name: album.artist_object.name,
            album_id: album.id,
            album_name: album.name,
            album_cover: album.cover_url,
            album_songs_count: album.songs.len(),
            first_release_date: album.first_release_date,
        }
    }).collect();

    Ok((album_card_props, song_genre.name))
}

async fn fetch_albums_info(album_ids: Vec<String>) -> Result<Vec<ResponseAlbum>, ()> {
    let library = fetch_library().await.map_err(|_| ())?;
    let mut album_map: HashMap<String, (&Artist, &Album)> = HashMap::new();

    for artist in library.iter() {
        for album in artist.albums.iter() {
            album_map.insert(album.id.clone(), (artist, album));
        }
    }

    let mut albums_info: Vec<ResponseAlbum> = Vec::new();
    for album_id in album_ids {
        if let Some((artist, album)) = album_map.get(&album_id) {
            albums_info.push(ResponseAlbum {
                id: album.id.clone(),
                name: album.name.clone(),
                cover_url: album.cover_url.clone(),
                songs: album.songs.clone(),
                first_release_date: album.first_release_date.clone(),
                musicbrainz_id: album.musicbrainz_id.clone(),
                wikidata_id: album.wikidata_id.clone(),
                primary_type: album.primary_type.clone(),
                description: album.description.clone(),
                artist_object: (*artist).clone(),
                contributing_artists: album.contributing_artists.clone(),
                contributing_artists_ids: album.contributing_artists_ids.clone(),
                release_album: album.release_album.clone(),
                release_group_album: album.release_group_album.clone(),
            });
        }
    }

    Ok(albums_info)
}

#[get("/similar_to/{user_id}")]
async fn get_similar_albums(user_id: web::Path<u32>) -> HttpResponse {
    let user_id = user_id.into_inner();
    match fetch_similar_albums(user_id).await {
        Ok((albums, genre)) => HttpResponse::Ok().json((albums, genre)),
        Err(_) => HttpResponse::InternalServerError().json("Failed to fetch similar albums"),
    }
}

async fn fetch_listen_again_songs(user_id: u32) -> Result<Vec<SongInfo>, ()> {
    fetch_listen_history_songs(user_id).await
}

#[get("/listen_again/{user_id}")]
async fn get_listen_again(user_id: web::Path<u32>) -> HttpResponse {
    let user_id = user_id.into_inner();
    match fetch_listen_again_songs(user_id).await {
        Ok(songs) => HttpResponse::Ok().json(songs),
        Err(_) => HttpResponse::InternalServerError().json("Failed to fetch listen again songs"),
    }
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/web")
            .service(get_similar_albums)
            .service(get_listen_again)
    );
}