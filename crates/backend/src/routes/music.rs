use std::process::Stdio;
use std::time::Instant;

use actix_web::http::header;
use actix_web::web::Bytes;
use actix_web::{get, web, HttpRequest, HttpResponse, Responder};
use futures::Stream;
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::process::Command;
use tokio_util::io::ReaderStream;
use tracing::{error, info, warn};
use walkdir::WalkDir;

use crate::routes::search::populate_search_data;
use crate::structures::structures::Artist;
use crate::utils::compare::compare;
use crate::utils::config::{get_config, save_config};
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

#[get("/index/{pathToLibrary}")]
pub async fn process_library(path_to_library: web::Path<String>) -> impl Responder {
    info!("Indexing library...");
    log_to_ws("Indexing library...".to_string()).await;

    let now = Instant::now();
    let library = index_library(path_to_library.as_str()).await.unwrap();

    let client = reqwest::Client::builder()
        .user_agent("ParsonLabsMusic/0.1 (will@parsonlabs.com)")
        .build()
        .unwrap();

        let config_data = get_config().await.unwrap_or("".to_string());
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
    
    if let Ok((mut new_artist_entries, mut new_album_entries, _new_song_entries)) =
        compare(&library).await
    {
        if !new_artist_entries.is_empty() {
            let artists_without_icon_count = new_artist_entries
                .iter()
                .filter(|artist| artist.icon_url.is_empty())
                .count();
            let log = format!(
                "Searching icon art for {} artists...",
                artists_without_icon_count
            );
            info!(log);
            log_to_ws(log).await;
    
            match get_access_token().await {
                Ok(access_token) => {
                    for artist in new_artist_entries.iter_mut() {
                        process_artist(&client, artist, access_token.clone()).await;
                        current_library.push(artist.clone());
                    }
                }
                Err(e) => warn!("Failed to get access token. Error: {}", e),
            }
        }
    
        if !new_album_entries.is_empty() {
            let albums_without_cover_count = new_album_entries
                .iter()
                .filter(|modified_album| modified_album.album.cover_url.is_empty())
                .count();
            let log = format!(
                "Searching cover art for {} albums...",
                albums_without_cover_count
            );
            info!(log);
            log_to_ws(log).await;
    
            for modified_album in new_album_entries.iter_mut() {
                process_album(
                    &client,
                    modified_album.artist_name.clone(),
                    &mut modified_album.album,
                )
                .await;
                if let Some(artist) = current_library
                    .iter_mut()
                    .find(|a| a.id == modified_album.artist_id)
                {
                    match artist
                        .albums
                        .iter_mut()
                        .find(|a| a.id == modified_album.album.id)
                    {
                        Some(existing_album) => *existing_album = modified_album.album.clone(),
                        None => artist.albums.push(modified_album.album.clone()),
                    }

                    refresh_audio_db_info(artist);
                }
            }
        }
    }

    // https://musicbrainz.org/ws/2/release/cbaf43b4-0d8f-4b58-9173-9fe7298e04e9?inc=aliases+artist-credits+labels+discids+recordings+release-groups+media+discids+recordings+artist-credits+isrcs+artist-rels+release-rels+url-rels+recording-rels+work-rels+label-rels+place-rels+event-rels+area-rels+instrument-rels+series-rels+work-rels&fmt=json

    let library_guard = library.lock().unwrap();
    let elapsed = now.elapsed().as_secs();

    let log = format!("Finished Indexing Library in {} seconds", elapsed);
    info!(log);
    log_to_ws(log).await;

    let data_to_serialize = if current_library.is_empty() {
        &*library_guard
    } else {
        &current_library
    };

    let json = serde_json::to_string(data_to_serialize).unwrap();

    save_config(&json, true).await.unwrap();

    match populate_search_data().await {
        Ok(_) => {},
        Err(e) => {
            error!("Failed to populate search data: {:?}", e);
        }
    }

    HttpResponse::Ok()
        .content_type("application/json; charset=utf-8")
        .body(json)
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
        panic!("ERROR: Path is not a file!");
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

    let content_range = format!("bytes {}-{}/{}", start, end, song_file_size);

    if bitrate == 0 && !slowed_reverb {
        let mut file = tokio::fs::File::open(&song).await.unwrap();
        let mut buffer = vec![0; (end - start + 1) as usize];
        file.seek(tokio::io::SeekFrom::Start(start)).await.unwrap();
        file.read_exact(&mut buffer).await.unwrap();
    
        let extension = path.extension().and_then(std::ffi::OsStr::to_str);
        let mime_type = match extension {
            Some("mp3") => "audio/mpeg",
            Some("flac") => "audio/flac",
            Some("wav") => "audio/wav",
            Some("ogg") => "audio/ogg",
            Some("aac") => "audio/aac",
            _ => "application/octet-stream",
        };
    
        HttpResponse::PartialContent()
            .append_header((header::CONTENT_TYPE, mime_type))
            .append_header((header::CONTENT_RANGE, content_range))
            .body(Bytes::from(buffer))
    } else {
        let mut command: Command = Command::new("ffmpeg");

        if slowed_reverb {
            command.args(&[
                "-i", &song,
                "-filter_complex", "asetrate=44100*0.8, atempo=0.9, aecho=0.8:0.88:60:0.4",
                "-v", "0",
                "-f", "mp3",
                "pipe:1",
            ]);
        } else {
            command.args(&[
                "-i", &song,
                "-map", "0:a:0",
                "-b:a", &format!("{}k", bitrate),
                "-v", "0",
                "-f", "mp3",
                "pipe:1",
            ]);
        }

        let mut command = command.stdout(Stdio::piped()).spawn().expect("Failed to start ffmpeg process");

        let stdout = command.stdout.take().expect("Failed to take stdout of ffmpeg");

        let stream = ReaderStream::new(stdout);

        let new_content_length = stream.size_hint().1.unwrap_or(0) as u64;
        let new_content_range = if new_content_length > 0 {
            let new_end = start + new_content_length - 1;
            format!("bytes {}-{}/{}", start, new_end, new_content_length)
        } else {
            format!("bytes {}-{}", start, start)
        };

        HttpResponse::PartialContent()
            .append_header((header::CONTENT_TYPE, "audio/mpeg"))
            .append_header((header::CONTENT_RANGE, new_content_range))
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
