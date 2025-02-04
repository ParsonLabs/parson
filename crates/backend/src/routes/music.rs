use std::fs;
use std::process::Stdio;
use std::time::Instant;

use actix_web::http::header::{self, HeaderMap, HeaderValue};
use actix_web::web::Bytes;
use actix_web::{get, web, HttpRequest, HttpResponse, Responder};
use futures::Stream;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::process::Command;
use tokio_util::io::ReaderStream;
use tracing::{error, info};
use walkdir::WalkDir;

use crate::routes::search::populate_search_data;
use crate::structures::structures::Artist;
use crate::utils::compare::compare;
use crate::utils::config::{get_config, get_libraries_config_path, refresh_cache, save_config};
use crate::utils::format::format_contributing_artists;
use crate::utils::library::index_library;
use crate::utils::metadata::{get_access_token, process_album, process_albums, process_artist, process_artists, refresh_audio_db_info};
use crate::utils::websocket::log_to_ws;

#[get("/songs/list/{path}")]
pub async fn songs_list(path: web::Path<String>) -> impl Responder {
    let now = Instant::now();

    let mut i = 0;
    for entry in WalkDir::new(path.as_str()) {
        let entry = entry.unwrap();
        let extension = entry.path().extension().unwrap_or_default();

        if entry.file_type().is_file() && extension == "mp3" || extension == "flac" {
            i += 1;
            // println!("{}", entry.path().display());
        }
    }

    let message = format!("{} songs found in {}ms", i, now.elapsed().as_millis());

    HttpResponse::Ok().body(message)
}

async fn process_music_library(path: &str) -> Result<String, Box<dyn std::error::Error>> {
    let now = Instant::now();
    let library = index_library(path).await?;

    let client = reqwest::Client::builder()
        .user_agent("ParsonLabsMusic/0.1 (will@parsonlabs.com)")
        .build()?;
    let config_data = get_config().await.unwrap_or_default();
    let mut current_library: Vec<Artist> = if config_data.is_empty() {
        Vec::new()
    } else {
        serde_json::from_str(&config_data).unwrap_or_else(|_| Vec::new())
    };

    if current_library.is_empty() {
        let mut library_guard = library.lock().unwrap();
        process_artists(&client, &mut *library_guard).await;
        process_albums(&client, &mut *library_guard).await;
    }

    if let Ok((mut new_artist_entries, mut new_album_entries, _new_song_entries)) = compare(&library).await {
        if !new_artist_entries.is_empty() {
            let artists_without_icon_count = new_artist_entries
                .iter()
                .filter(|artist| artist.icon_url.is_empty())
                .count();
            let log = format!("Searching icon art for {} artists...", artists_without_icon_count);
            info!(log);
            log_to_ws(log).await;

            if let Ok(access_token) = get_access_token().await {
                for artist in new_artist_entries.iter_mut() {
                    process_artist(&client, artist, access_token.clone()).await;
                    current_library.push(artist.clone());
                }
            }
        }

        if !new_album_entries.is_empty() {
            let albums_without_cover_count = new_album_entries
                .iter()
                .filter(|modified_album| modified_album.album.cover_url.is_empty())
                .count();
            let log = format!("Searching cover art for {} albums...", albums_without_cover_count);
            info!(log);
            log_to_ws(log).await;

                        for modified_album in new_album_entries.iter_mut() {
                process_album(&client, modified_album.artist_name.clone(), &mut modified_album.album).await;
                if let Some(artist) = current_library.iter_mut().find(|a| a.id == modified_album.artist_id) {
                    match artist.albums.iter_mut().find(|a| a.id == modified_album.album.id) {
                        Some(existing_album) => {
                            for new_song in modified_album.album.songs.iter() {
                                if let Some(existing_song) = existing_album.songs.iter_mut()
                                    .find(|s| s.id == new_song.id) {
                                    if existing_song.path != new_song.path {
                                        info!("Updated song path: {} -> {}", existing_song.path, new_song.path);
                                        log_to_ws(format!("Updated song path for: {}", new_song.name)).await;
                                        existing_song.path = new_song.path.clone();
                                    }
                                }
                            }

                            if !modified_album.album.cover_url.is_empty() && 
                               existing_album.cover_url != modified_album.album.cover_url {
                                info!("Updated album cover: {} -> {}", 
                                    existing_album.cover_url, modified_album.album.cover_url);
                                log_to_ws(format!("Updated cover art for: {}", existing_album.name)).await;
                                existing_album.cover_url = modified_album.album.cover_url.clone();
                            }
                        },
                        None => {
                            info!("Added new album: {}", modified_album.album.name);
                            log_to_ws(format!("Added new album: {}", modified_album.album.name)).await;
                            artist.albums.push(modified_album.album.clone());
                        },
                    }
                    refresh_audio_db_info(artist);
                }
            }
        }
    }

    let library_guard = library.lock().unwrap();
    let elapsed = now.elapsed().as_secs();
    info!("Finished Indexing Library in {} seconds", elapsed);
    log_to_ws(format!("Finished Indexing Library in {} seconds", elapsed)).await;

    let data_to_serialize = if current_library.is_empty() {
        &*library_guard
    } else {
        &current_library
    };

    let json = serde_json::to_string(data_to_serialize)?;
    save_config(&json, true).await?;
    populate_search_data().await.expect("Could not Populate the Search Data");
    refresh_cache().await.expect("Could not Refresh Music Data Cache");

    Ok(json)
}

#[get("/index/{pathToLibrary}")]
pub async fn index(path_to_library: web::Path<String>) -> impl Responder {
    info!("Indexing new library path...");
    log_to_ws("Indexing new library path...".to_string()).await;

    if let Err(e) = save_library_path(&path_to_library).await {
        error!("Failed to save library path: {:?}", e);
    }

    match process_music_library(&path_to_library).await {
        Ok(json) => HttpResponse::Ok().content_type("application/json; charset=utf-8").body(json),
        Err(e) => {
            error!("Failed to process library: {:?}", e);
            HttpResponse::InternalServerError().finish()
        }
    }
}

pub async fn process_music_library_no_ws(path: &str) -> Result<String, Box<dyn std::error::Error>> {
    let now = Instant::now();
    let library = index_library(path).await?;

    let client = reqwest::Client::builder()
        .user_agent("ParsonLabsMusic/0.1 (will@parsonlabs.com)")
        .build()?;
    let config_data = get_config().await.unwrap_or_default();
    let mut current_library: Vec<Artist> = if config_data.is_empty() {
        Vec::new()
    } else {
        serde_json::from_str(&config_data).unwrap_or_else(|_| Vec::new())
    };

    if current_library.is_empty() {
        let mut library_guard = library.lock().unwrap();
        process_artists(&client, &mut *library_guard).await;
        process_albums(&client, &mut *library_guard).await;
    }

    if let Ok((mut new_artist_entries, mut new_album_entries, _new_song_entries)) = compare(&library).await {
        if !new_artist_entries.is_empty() {
            let artists_without_icon_count = new_artist_entries
                .iter()
                .filter(|artist| artist.icon_url.is_empty())
                .count();
            info!("Searching icon art for {} artists...", artists_without_icon_count);

            if let Ok(access_token) = get_access_token().await {
                for artist in new_artist_entries.iter_mut() {
                    process_artist(&client, artist, access_token.clone()).await;
                    current_library.push(artist.clone());
                }
            }
        }

        if !new_album_entries.is_empty() {
            let albums_without_cover_count = new_album_entries
                .iter()
                .filter(|modified_album| modified_album.album.cover_url.is_empty())
                .count();
            info!("Searching cover art for {} albums...", albums_without_cover_count);

            for modified_album in new_album_entries.iter_mut() {
                process_album(&client, modified_album.artist_name.clone(), &mut modified_album.album).await;
                if let Some(artist) = current_library.iter_mut().find(|a| a.id == modified_album.artist_id) {
                    match artist.albums.iter_mut().find(|a| a.id == modified_album.album.id) {
                        Some(existing_album) => {
                            for new_song in modified_album.album.songs.iter() {
                                if let Some(existing_song) = existing_album.songs.iter_mut()
                                    .find(|s| s.id == new_song.id) {
                                    existing_song.path = new_song.path.clone();
                                }
                            }

                            if !modified_album.album.cover_url.is_empty() {
                                existing_album.cover_url = modified_album.album.cover_url.clone();
                            }
                        },
                        None => artist.albums.push(modified_album.album.clone()),
                    }
                    refresh_audio_db_info(artist);
                }
            }
        }
    }

    let library_guard = library.lock().unwrap();
    let elapsed = now.elapsed().as_secs();
    info!("Finished Indexing Library in {} seconds", elapsed);

    let data_to_serialize = if current_library.is_empty() {
        &*library_guard
    } else {
        &current_library
    };

    let json = serde_json::to_string(data_to_serialize)?;
    save_config(&json, true).await?;
    populate_search_data().await.expect("Could not Populate the Search Data");
    refresh_cache().await.expect("Could not Refresh Music Data Cache");

    Ok(json)
}

pub async fn refresh_libraries() -> Result<Vec<String>, Box<dyn std::error::Error>> {
    info!("Refreshing all library paths...");
    log_to_ws("Refreshing all library paths...".to_string()).await;

    let paths = read_library_paths().await;
    let mut results = Vec::new();

    for path in paths {
        match process_music_library(&path).await {
            Ok(json) => results.push(json),
            Err(e) => {
                error!("Failed to process library {}: {:?}", path, e);
            }
        }
    }

    Ok(results)
}

#[get("/refresh")]
pub async fn library_refresh() -> impl Responder {
    match refresh_libraries().await {
        Ok(results) => {
            if results.is_empty() {
                HttpResponse::InternalServerError().finish()
            } else {
                HttpResponse::Ok()
                    .content_type("application/json; charset=utf-8")
                    .body(results.join(","))
            }
        }
        Err(_) => HttpResponse::InternalServerError().finish()
    }
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct Libraries {
    pub paths: Vec<String>
}

pub async fn read_library_paths() -> Vec<String> {
    let libraries_file= get_libraries_config_path();
    
    if !libraries_file.exists() {
        return Vec::new();
    }
    
    let content = fs::read_to_string(libraries_file).expect("Could not read the Libraries JSON File");
    let libraries: Libraries = serde_json::from_str(&content).expect("Could not Parse the JSON as a String");
    
    libraries.paths
}

async fn save_library_path(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let libraries_file = get_libraries_config_path();

    let mut libraries = if libraries_file.exists() {
        let content = fs::read_to_string(&libraries_file)?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Libraries { paths: Vec::new() }
    };

    if !libraries.paths.contains(&path.to_string()) {
        libraries.paths.push(path.to_string());
        let json = serde_json::to_string_pretty(&libraries)?;
        fs::write(libraries_file, json)?;
    }

    Ok(())
}

#[derive(Deserialize)]
pub struct BitrateQueryParams {
    pub bitrate: u32,
    pub slowed_reverb: Option<bool>,
}

#[get("/stream/{song}")]
async fn stream_song(
    req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<BitrateQueryParams>,
) -> impl Responder {
    let song = path.into_inner();
    let bitrate = query.bitrate;
    let slowed_reverb: bool = query.slowed_reverb.unwrap_or(false);

    let file = tokio::fs::metadata(&song).await.unwrap();
    let song_file_size = file.len();

    let path = std::path::Path::new(&song);

    if !path.is_file() {
        return HttpResponse::NotFound().finish();
    }

    let range = req.headers().get("Range").and_then(|v| v.to_str().ok());
    let (start, end) = match range {
        Some(range) => {
            let bytes = range.trim_start_matches("bytes=");
            let range_parts: Vec<&str> = bytes.split('-').collect();
            let start = range_parts[0].parse::<u64>().unwrap_or(0);
            let end = range_parts
                .get(1)
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(song_file_size - 1);
            (start, end)
        }
        None => (0, song_file_size - 1),
    };

    if bitrate == 0 && !slowed_reverb {
        use tokio::io::AsyncSeekExt;
        
        let content_type = match path.extension().and_then(|ext| ext.to_str()) {
            Some("flac") => "audio/flac",
            Some("mp3") => "audio/mpeg",
            Some("mp4") => "video/mp4",
            Some("webm") => "video/webm", 
            Some("mkv") => "video/x-matroska",
            _ => "application/octet-stream",
        };

        let mut file = match tokio::fs::File::open(&song).await {
            Ok(file) => file,
            Err(_) => return HttpResponse::NotFound().finish()
        };

        let (start, end) = if let Some(range_header) = &range {
            if let Some(bytes_range) = range_header.trim().strip_prefix("bytes=") {
                let parts: Vec<&str> = bytes_range.split('-').collect();
                let start = parts
                    .get(0)
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(0);
                let end = match parts.get(1) {
                    Some(s) if !s.is_empty() => s.parse::<u64>().unwrap_or(song_file_size - 1),
                    _ => song_file_size - 1,
                };
                (start, end)
            } else {
                (0, song_file_size - 1)
            }
        } else {
            (0, song_file_size - 1)
        };

        if let Err(_) = file.seek(std::io::SeekFrom::Start(start)).await {
            return HttpResponse::InternalServerError().finish();
        }

        let stream = ReaderStream::with_capacity(
            file.take(end - start + 1),
            65536
        );

        HttpResponse::PartialContent()
            .insert_header((header::ACCEPT_RANGES, "bytes"))
            .insert_header((header::CONTENT_TYPE, content_type))
            .insert_header((header::CONTENT_RANGE, format!("bytes {}-{}/{}", start, end, song_file_size)))
            .insert_header((header::CONTENT_LENGTH, (end - start + 1).to_string()))
            .insert_header((header::CACHE_CONTROL, "public, max-age=31536000"))
            .streaming(stream)
    } else {
        let mut command = Command::new("ffmpeg");

        if start > 0 {
            command.arg("-ss")
                  .arg(format!("{}", start as f64 / 44100.0));
        }

        if slowed_reverb {
            command.args(&[
                "-i", &song,
                "-filter_complex", "asetrate=44100*0.8, atempo=0.9, aecho=0.8:0.88:60:0.4",
                "-v", "0",
                "-f", "mp3",
                "-chunk_size", "65536",
                "-movflags", "frag_keyframe+empty_moov",
                "pipe:1",
            ]);
        } else {
            command.args(&[
                "-i", &song,
                "-map", "0:a:0",
                "-b:a", &format!("{}k", bitrate),
                "-v", "0",
                "-f", "mp3",
                "-chunk_size", "65536",
                "-movflags", "frag_keyframe+empty_moov",
                "pipe:1",
            ]);
        }

        let mut child = match command.stdout(Stdio::piped())
                              .stderr(Stdio::piped())
                              .spawn()
                              .map_err(|e| {
                                  eprintln!("Failed to start ffmpeg: {}", e);
                                  HttpResponse::InternalServerError().finish()
                              }) {
            Ok(child) => child,
            Err(response) => return response,
        };

        let stdout = match child.stdout.take().ok_or_else(|| {
            eprintln!("Failed to get stdout handle");
            HttpResponse::InternalServerError()
        }) {
            Ok(stdout) => stdout,
            Err(response) => return response.await.unwrap(),
        };

        let stream = ReaderStream::with_capacity(stdout, 65536);

        HttpResponse::PartialContent()
            .append_header((header::CONTENT_TYPE, "audio/mpeg"))
            .append_header((header::TRANSFER_ENCODING, "chunked"))
            .streaming(stream)
    }
}

#[get("/format/{artist}")]
async fn format_contributing_artists_route(artist: web::Path<String>) -> impl Responder {
    let artists = vec![artist.to_string()];
    let formatted_artists: Vec<(String, Vec<String>)> = Into::<Vec<(String, Vec<String>)>>::into(&*&mut *format_contributing_artists(artists));
    let json = serde_json::to_string(&formatted_artists).unwrap();

    HttpResponse::Ok()
        .content_type("application/json; charset=utf-8")
        .body(json)
}

#[get("/index/quick/{path}")]
async fn index_library_no_cover_url(path: web::Path<String>) -> impl Responder {
    println!("Indexing");
    let indexed_library = index_library(path.as_str()).await.unwrap();

    let json: String = serde_json::to_string(&*indexed_library.lock().unwrap()).unwrap();

    HttpResponse::Ok()
        .content_type("application/json; charset=utf-8")
        .body(json)
}

#[get("/test")]
async fn test() -> impl Responder {
    log_to_ws("Hit the test endpoint.".to_string())
        .await;

    HttpResponse::Ok()
}
