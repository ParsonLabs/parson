use std::{collections::HashMap, error::Error, path::Path, sync::{Arc, Mutex}, time::Duration};

use regex::Regex;
use reqwest::{
    header::{HeaderMap, AUTHORIZATION, CONTENT_TYPE, USER_AGENT},
    Client,
};
use levenshtein::levenshtein;
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::Value;
use tokio::{fs, io, time::sleep};
use tracing::{info, warn};
use std::error::Error as StdError;

use crate::{
    structures::structures::{
        Album, Alias, Artist, Collection, CoverArtStatus, CreditArtist, Genre, Information, Label, MusicVideo, Rating, Relationship, ReleaseAlbum, ReleaseGroupAlbum, Tag, Track
    },
    utils::websocket::log_to_ws,
};

use super::config::{get_cover_art_path, get_icon_art_path};

#[derive(Debug, Deserialize)]
struct SearchResponse {
    best_match: BestMatch,
}

#[derive(Debug, Deserialize)]
struct BestMatch {
    items: Vec<ArtistItem>,
}

#[derive(Debug, Deserialize)]
struct ArtistItem {
    followers: Followers,
    images: Vec<Image>,
}

#[derive(Debug, Deserialize)]
struct Followers {
    total: u64,
}

#[derive(Debug, Deserialize)]
struct Image {
    url: String,
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize)]
struct TokenResponse {
    accessToken: String,
}

pub async fn get_access_token() -> Result<String, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    let token_res: TokenResponse = client
        .get("https://open.spotify.com/get_access_token?reason=transport&productType=web_player")
        .header(reqwest::header::USER_AGENT, "MyApp/1.0")
        .send()
        .await?
        .json()
        .await?;
    Ok(token_res.accessToken)
}

async fn get_artist_metadata(
    client: &Client,
    artist_name: &str,
    access_token: String,
) -> Option<(String, u64)> {
    let mut headers = HeaderMap::new();

    headers.insert(
        AUTHORIZATION,
        format!("Bearer {}", access_token).parse().unwrap(),
    );
    headers.insert(CONTENT_TYPE, "application/json".parse().unwrap());
    headers.insert(USER_AGENT, "MyApp/1.0".parse().unwrap());

    let url = format!("https://api.spotify.com/v1/search?type=artist&q={}&decorate_restrictions=false&best_match=true&include_external=audio&limit=1", artist_name);

    let response = match client.get(&url).headers(headers).send().await {
        Ok(response) => response,
        Err(_) => {
            warn!("Failed to send request for artist: {}", artist_name);
            return None;
        }
    };

    let body = match response.text().await {
        Ok(body) => body,
        Err(_) => {
            warn!("Failed to read response body for artist: {}", artist_name);
            return None;
        }
    };

    let res: SearchResponse = match serde_json::from_str(&body) {
        Ok(res) => res,
        Err(_) => {
            warn!("Failed to parse response body for artist: {}", artist_name);
            return None;
        }
    };

    if let Some(artist) = res.best_match.items.get(0) {
        if let Some(image) = artist.images.get(0) {
            return Some((image.url.clone(), artist.followers.total));
        }
    }

    warn!("No artist found for: {}", artist_name);
    None
}

pub async fn process_artist(
    client: &Client,
    artist: &mut Artist,
    access_token: Option<String>,
    store_audio_db_image: bool,
) {
    let client1 = client.clone();
    let artist_name1 = artist.name.clone();
    let wikipedia_future =
        tokio::spawn(async move {
            fetch_wikipedia_extract(&client1, &artist_name1, None, None).await
        });

    let wikipedia_extract = wikipedia_future.await.unwrap();
    if let Some(wikipedia_extract) = wikipedia_extract {
        artist.description = wikipedia_extract;
        let log = format!("Wikipedia extract downloaded for Artist: {}", artist.name);
        info!(log);
        log_to_ws(log).await;
    }

    if let Some(token) = access_token.clone() {
        let client2 = client.clone();
        let artist_name2 = artist.name.clone();
        let metadata_future = tokio::spawn(async move {
            get_artist_metadata(&client2, &artist_name2, token).await
        });

        if let Some((img_url, followers)) = metadata_future.await.unwrap() {
            match download_and_store_icon_art(client, &img_url, &artist.id.to_string()).await {
                Ok(path) => {
                    artist.icon_url = path;
                    artist.followers = followers;

                    let log = format!("Icon art downloaded and stored for Artist: {}", artist.name);
                    info!(log);
                    log_to_ws(log).await;
                }
                Err(e) => warn!(
                    "Failed to store icon art for Artist: {}. Error: {}",
                    artist.name, e
                ),
            }
        } else {
            warn!("No Spotify icon for {}", artist.name);
        }
    } else {
        warn!("Skipping Spotify metadata (no token) for {}", artist.name);
    }

    let client3 = client.clone();
    let artist_clone = Arc::new(Mutex::new(artist.clone()));
    let artist_clone_for_task = Arc::clone(&artist_clone);
    
    let audio_db_future = tokio::task::spawn_blocking(move || {
        tokio::runtime::Handle::current().block_on(async move {
            fetch_audio_db_info(&client3, &mut artist_clone_for_task.lock().unwrap(), store_audio_db_image).await
        })
    });

    match audio_db_future.await {
        Ok(inner_result) => match inner_result {
            Ok(()) => {
                let artist_clone_locked = artist_clone.lock().unwrap();
                *artist = artist_clone_locked.clone();
                let log = format!("AudioDB info done for {}", artist.name);
                info!(log);
                log_to_ws(log).await;
            }
            Err(e) => {
                warn!("AudioDB task error for {}: {}", artist.name, e);
                log_to_ws(format!("AudioDB error for {}: {}", artist.name, e)).await;
            }
        },
        Err(e) => {
            warn!("Failed to join AudioDB task for {}: {:?}", artist.name, e);
            log_to_ws(format!("Join AudioDB task failed: {:?}", e)).await;
        }
    }

    sleep(Duration::from_secs(1)).await;
}

pub async fn process_artists(client: &Client, library: &mut Vec<Artist>) {
    match get_access_token().await {
        Ok(tok) => {
            for artist in library.iter_mut() {
                process_artist(client, artist, Some(tok.clone()), false).await;
            }
        }
        Err(e) => {
            warn!("Failed to get Spotify token: {}", e);
            log_to_ws(format!("Spotify token error, using AudioDB fallback: {}", e)).await;
            for artist in library.iter_mut() {
                process_artist(client, artist, None, true).await;
            }
        }
    }
}

async fn download_and_store_icon_art(
    client: &Client,
    image_url: &str,
    artist_id: &str,
) -> Result<String, io::Error> {
    let image_response = client.get(image_url).send().await.unwrap();
    let image_bytes = image_response.bytes().await.unwrap();

    let icon_art_path = get_icon_art_path();
    let icon_url_path = icon_art_path.join(format!("{}.jpg", artist_id));
    let icon_url_file_path = icon_url_path.to_str().map(|s| s.to_owned()).unwrap();
    fs::write(&icon_url_file_path, image_bytes).await?;

    let absolute_path = fs::canonicalize(&icon_url_file_path).await?;
    let absolute_path_str = absolute_path
        .to_str()
        .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "Path conversion error"))?;
    let clean_path = absolute_path_str.trim_start_matches("\\\\?\\");
    Ok(clean_path.to_string())
}

async fn fetch_album_metadata(
    client: &Client,
    artist_name: &String,
    mut album: &mut Album,
) -> AlbumMetadata {
    let status = "AND (status:\"Official\" OR status:\"Promotion\")";
    let query_with_status = format!(
        "artist:\"{}\" AND release:\"{}\" {}",
        artist_name, album.name, status
    );
    let query_without_status = format!("artist:\"{}\" AND release:\"{}\"", artist_name, album.name);

    let cover_art_path = get_cover_art_path();
    let cover_url_path = cover_art_path.join(format!("{}.jpg", album.id));
    let cover_url_path = Path::new(&cover_url_path);
    let cover_art_already_downloaded = cover_url_path.exists();

    let url_with_status = format!(
        "https://musicbrainz.org/ws/2/release-group/?query={}&fmt=json&limit=10",
        query_with_status
    );
    let url_without_status = format!(
        "https://musicbrainz.org/ws/2/release-group/?query={}&fmt=json&limit=10",
        query_without_status
    );

    let mut album_metadata = fetch_musicbrainz_metadata(
        client,
        &url_with_status,
        cover_art_already_downloaded,
        &mut album,
    )
    .await;

    if album_metadata.is_err() || album_metadata.as_ref().unwrap().cover_url.is_empty() {
        let log_message = format!(
            "Didn't find the album: {} in release group with status, trying without status...",
            album.name
        );
        info!("{}", log_message);
        log_to_ws(log_message).await;

        sleep(Duration::from_secs(1)).await;
        album_metadata = fetch_musicbrainz_metadata(
            client,
            &url_without_status,
            cover_art_already_downloaded,
            &mut album,
        )
        .await;
    }

    if album_metadata.is_err() {
        let log_message = format!(
            "Didn't find the album: {} in release group, trying release...",
            album.name
        );
        info!("{}", log_message);
        log_to_ws(log_message).await;

        let url = format!(
            "https://musicbrainz.org/ws/2/release/?query={}&fmt=json&limit=10",
            query_without_status
        );
        album_metadata =
            fetch_musicbrainz_metadata(client, &url, cover_art_already_downloaded, &mut album)
                .await;
    }

    album_metadata.unwrap_or_default()
}

async fn fetch_wikipedia_extract(
    client: &Client,
    artist_name: &str,
    album_name: Option<&str>,
    wikidata_id: Option<&str>,
) -> Option<String> {
    if let Some(wikidata_id) = wikidata_id {
        let wikidata_url = format!(
            "https://www.wikidata.org/wiki/Special:EntityData/{}.json",
            wikidata_id
        );
        if let Ok(response) = client.get(&wikidata_url).send().await {
            if let Ok(body) = response.text().await {
                let v: Value = serde_json::from_str(&body).unwrap_or_else(|_| "[]".into());
                if let Some(wikipedia_title) =
                    v["entities"][wikidata_id]["sitelinks"]["enwiki"]["title"].as_str()
                {
                    return fetch_wikipedia_page_extract(client, wikipedia_title).await;
                }
            }
        }
    }

    let query = match album_name {
        Some(album) => format!("{} (Album)", album),
        None => format!("{} Artist", artist_name),
    };
    let search_url = format!("https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch={}&srlimit=1", query);
    if let Ok(response) = client.get(&search_url).send().await {
        if let Ok(body) = response.text().await {
            let v: Value = serde_json::from_str(&body).unwrap_or_else(|_| "[]".into());
            if let Some(page_title) = v["query"]["search"][0]["title"].as_str() {
                return fetch_wikipedia_page_extract(client, page_title).await;
            }
        }
    }

    None
}

async fn fetch_wikipedia_page_extract(client: &Client, page_title: &str) -> Option<String> {
    sleep(Duration::from_secs(1)).await;
    let extract_url = format!("https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=&format=json&titles={}", page_title);
    if let Ok(response) = client.get(&extract_url).send().await {
        if let Ok(body) = response.text().await {
            let v: Value = serde_json::from_str(&body).unwrap_or_else(|_| "[]".into());
            if let Some(pages) = v["query"]["pages"].as_object() {
                for page in pages.values() {
                    if let Some(extract) = page["extract"].as_str() {
                        let re = Regex::new(r"<.*?>|\n").unwrap();
                        let clean_extract = re.replace_all(extract, "").to_string();

                        let re_amp = Regex::new(r"&amp;").unwrap();
                        let without_amp = re_amp.replace_all(&clean_extract, "&").to_string();
                        let re_lt = Regex::new(r"&lt;").unwrap();
                        let without_lt = re_lt.replace_all(&without_amp, "<").to_string();
                        let re_gt = Regex::new(r"&gt;").unwrap();
                        let without_gt = re_gt.replace_all(&without_lt, ">").to_string();
                        let re_quot = Regex::new(r"&quot;").unwrap();
                        let without_quot = re_quot.replace_all(&without_gt, "\"").to_string();

                        let re_backticks = Regex::new(r"(?m)^`|`$").unwrap();
                        let final_extract = re_backticks.replace_all(&without_quot, "").to_string();

                        return Some(final_extract);
                    }
                }
            }
        }
    }
    None
}

pub struct AlbumMetadata {
    pub cover_url: String,
    pub first_release_date: String,
    pub musicbrainz_id: String,
    pub wikidata_id: Option<String>,
    pub primary_type: String,
}

impl Default for AlbumMetadata {
    fn default() -> Self {
        Self {
            cover_url: String::from(""),
            first_release_date: String::from(""),
            musicbrainz_id: String::from(""),
            wikidata_id: None,
            primary_type: String::from(""),
        }
    }
}

async fn fetch_musicbrainz_metadata(
    client: &Client,
    url: &str,
    cover_art_already_downloaded: bool,
    album: &mut Album,
) -> Result<AlbumMetadata, Box<dyn std::error::Error>> {
    let response = client.get(url).send().await?;
    let body = response.text().await?;
    let v: serde_json::Value = serde_json::from_str(&body)?;

    let empty_vec = Vec::new();
    let release_groups = if v["release-groups"].is_array() {
        v["release-groups"].as_array().unwrap()
    } else if v["releases"].is_array() {
        v["releases"].as_array().unwrap()
    } else {
        &empty_vec
    };

    for release in release_groups {
        let id = release["id"].as_str().unwrap_or("");
        let is_release_group = url.contains("release-group");

        let cover_url = if !cover_art_already_downloaded {
            let cover_art_url = if is_release_group {
                format!("http://coverartarchive.org/release-group/{}", id)
            } else {
                format!("http://coverartarchive.org/release/{}", id)
            };

            sleep(Duration::from_secs(1)).await;

            let cover_art_response = client.get(&cover_art_url).send().await?;
            let cover_art_body = if cover_art_response.status().is_success() {
                cover_art_response.text().await?
            } else {
                "".to_string()
            };
            let cover_art: serde_json::Value = serde_json::from_str(&cover_art_body)?;
            let images = cover_art["images"].as_array().unwrap_or(&empty_vec);
            let first_image = images.get(0).unwrap_or(&serde_json::Value::Null).clone();
            first_image["image"].as_str().unwrap_or("").to_string()
        } else {
            let cover_art_path = get_icon_art_path();
            let cover_url_path = cover_art_path.join(format!("{}.jpg", album.id));
            cover_url_path
                .to_str()
                .map(|s| s.to_owned())
                .unwrap_or_else(|| "".to_string())
        };

        let release_url = if is_release_group {
            format!("https://musicbrainz.org/ws/2/release-group/{}?inc=aliases+artist-credits+releases+annotation+tags+genres+ratings+url-rels&fmt=json", id)
        } else {
            format!("https://musicbrainz.org/ws/2/release/{}?inc=aliases+artist-credits+annotation+labels+recordings+tags+url-rels+release-groups+media+genres+tags+ratings+discids&fmt=json", id)
        };
        let release_response = client.get(&release_url).send().await?;
        let release_body = release_response.text().await?;
        let release: serde_json::Value = serde_json::from_str(&release_body)?;

        if release_url.contains("release-group") {
            let mapped_release_group = map_to_release_group_album(&release).unwrap_or_default();
            album.release_group_album = Some(mapped_release_group);
        } else {
            let mapped_release = map_to_release_album(&release).unwrap_or_default();
            album.release_album = Some(mapped_release);
        }

        let first_release_date = if is_release_group {
            release["first-release-date"].as_str().unwrap_or("")
        } else {
            release["date"].as_str().unwrap_or("")
        };
        let primary_type = if is_release_group {
            release["primary-type"].as_str().unwrap_or("")
        } else {
            release["status"].as_str().unwrap_or("")
        };

        let wikidata_id = release["relations"]
            .as_array()
            .and_then(|relations| {
                relations.iter().find_map(|relation| {
                    if relation["type"].as_str() == Some("wikidata") {
                        relation["url"]["resource"]
                            .as_str()
                            .and_then(|wikidata_url| wikidata_url.split('/').last())
                            .map(|id| id.to_string())
                    } else {
                        None
                    }
                })
            })
            .unwrap_or("".to_string());

        return Ok(AlbumMetadata {
            cover_url: cover_url.to_string(),
            first_release_date: first_release_date.to_string(),
            musicbrainz_id: id.to_string(),
            wikidata_id: Some(wikidata_id),
            primary_type: primary_type.to_string(),
        });
    }

    Ok(AlbumMetadata {
        cover_url: "".to_string(),
        first_release_date: "".to_string(),
        musicbrainz_id: "".to_string(),
        wikidata_id: Some("".to_string()),
        primary_type: "".to_string(),
    })
}

async fn download_and_store_cover_art(
    client: &Client,
    image_url: &str,
    album_id: &str,
) -> Result<String, io::Error> {
    let cover_art_path = get_cover_art_path();
    let cover_url_path = cover_art_path.join(format!("{}.jpg", album_id));
    let cover_url_file_path = cover_url_path.to_str().map(|s| s.to_owned()).unwrap();

    if cover_url_path.exists() {
        // warn!("Cover art already downloaded for album: {}", album_id);
        let absolute_path = fs::canonicalize(&cover_url_file_path).await?;
        let clean_path = absolute_path.to_str().ok_or_else(|| {
            let error_message = "Path conversion error";
            warn!("{}", error_message);
            io::Error::new(io::ErrorKind::Other, error_message)
        })?;
        return Ok(clean_path.to_string());
    }

    if image_url.is_empty() {
        warn!("Image URL is empty for album: {}", album_id);
        return Err(io::Error::new(io::ErrorKind::Other, "Image URL is empty"));
    }

    let _ = reqwest::Url::parse(image_url).map_err(|e| {
        warn!("Invalid URL: {}, error: {}", image_url, e);
        io::Error::new(io::ErrorKind::Other, e)
    })?;

    let image_response = client.get(image_url).send().await.map_err(|e| {
        warn!("Failed to send GET request to image URL: {}", e);
        io::Error::new(io::ErrorKind::Other, e)
    })?;

    let image_bytes = image_response.bytes().await.map_err(|e| {
        warn!("Failed to read response body as bytes: {}", e);
        io::Error::new(io::ErrorKind::Other, e)
    })?;

    fs::write(&cover_url_file_path, image_bytes)
        .await
        .map_err(|e| {
            warn!("Failed to write image bytes to file: {}", e);
            e
        })?;

    let absolute_path = fs::canonicalize(&cover_url_file_path).await.map_err(|e| {
        warn!("Failed to get absolute path of image file: {}", e);
        e
    })?;

    let absolute_path_str = absolute_path.to_str().ok_or_else(|| {
        let error_message = "Path conversion error";
        warn!("{}", error_message);
        io::Error::new(io::ErrorKind::Other, error_message)
    })?;

    let clean_path = absolute_path_str.trim_start_matches("\\\\?\\");
    Ok(clean_path.to_string())
}

pub async fn process_albums(client: &Client, library: &mut Vec<Artist>) {
    for artist in library.iter_mut() {
        for album in &mut artist.albums {
            process_album(client, artist.name.clone(), album).await;
        }
    }
}

pub async fn process_album(client: &Client, artist_name: String, album: &mut Album) {
    let re = Regex::new(r"(?i)\b.*cd.*\b").unwrap();
    let album_name = album.name.to_lowercase();
    let album_name = re.replace_all(&album_name, "").trim().to_string();

    let metadata = fetch_album_metadata(client, &artist_name, album).await;

    if let Some(wikidata_id) = metadata.wikidata_id.clone() {
        if let Some(wikipedia_extract) =
            fetch_wikipedia_extract(client, &album_name, Some(&artist_name), Some(&wikidata_id))
                .await
        {
            album.description = wikipedia_extract;
        } else {
            warn!(
                "Failed to fetch Wikipedia extract for Album: {}",
                album.name
            );
        }
    }

    if album.cover_url.is_empty() {
        match download_and_store_cover_art(client, &metadata.cover_url, &album.id.to_string()).await
        {
            Ok(path) => {
                album.cover_url = path;
                let log = format!("Cover art downloaded and stored for Album: {}", album.name);
                info!(log);
                log_to_ws(log)
                    .await
            }
            Err(e) => warn!(
                "Failed to store cover art for Album: {}. Error: {}",
                album.name, e
            ),
        }
    } else {
        let log = format!("Cover art already found for Album: {}", album.name);
        warn!(log);
        log_to_ws(log)
            .await
    }

    album.first_release_date = metadata.first_release_date;
    album.musicbrainz_id = metadata.musicbrainz_id;
    album.wikidata_id = metadata.wikidata_id;
    album.primary_type = metadata.primary_type;

    let log = format!("Metadata updated for Album: {}", album.name);
    info!(log);
    log_to_ws(log)
        .await;

    sleep(Duration::from_secs(1)).await;
}

fn map_to_release_album(release_album_json: &Value) -> Result<ReleaseAlbum, Box<dyn Error>> {
    let information = Information {
        date: release_album_json["date"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        country: release_album_json["country"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        status_id: release_album_json["status-id"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        title: release_album_json["title"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        barcode: release_album_json["barcode"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        quality: release_album_json["quality"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        packaging: release_album_json["packaging"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        disambiguation: release_album_json["disambiguation"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        release_type: release_album_json["release_type"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        asin: release_album_json["asin"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        music_brainz_id: release_album_json["id"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        packaging_id: release_album_json["packaging-id"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        status: release_album_json["status"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        tags: release_album_json["tags"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .map(|tag| Tag {
                count: tag["count"].as_u64().unwrap_or_default(),
                name: tag["name"].as_str().unwrap_or_default().to_string(),
            })
            .collect(),
        genres: release_album_json["genres"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .map(|genre| Genre {
                musicbrainz_id: genre["id"].as_str().unwrap_or_default().to_string(),
                disambiguation: genre["disambiguation"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                name: genre["name"].as_str().unwrap_or_default().to_string(),
                count: genre["count"].as_u64().unwrap_or_default(),
            })
            .collect(),
        cover_art_status: CoverArtStatus {
            count: release_album_json["cover-art-archive"]["count"]
                .as_u64()
                .unwrap_or_default() as u16,
            front: release_album_json["cover-art-archive"]["front"]
                .as_bool()
                .unwrap_or_default()
                .to_string(),
            darkened: release_album_json["cover-art-archive"]["darkened"]
                .as_bool()
                .unwrap_or_default()
                .to_string(),
            artwork: release_album_json["cover-art-archive"]["artwork"]
                .as_bool()
                .unwrap_or_default()
                .to_string(),
            back: release_album_json["cover-art-archive"]["back"]
                .as_bool()
                .unwrap_or_default()
                .to_string(),
        },
        collections: release_album_json["release-group"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .map(|group| Collection {
                secondary_type_ids: group["secondary-type-ids"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .map(|id| id.as_str().unwrap_or_default().to_string())
                    .collect(),
                id: group["id"].as_str().unwrap_or_default().to_string(),
                tags: group["tags"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .map(|tag| Tag {
                        count: tag["count"].as_u64().unwrap_or_default(),
                        name: tag["name"].as_str().unwrap_or_default().to_string(),
                    })
                    .collect(),
                artist_credit: group["artist-credit"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .map(|credit| CreditArtist {
                        name: credit["name"].as_str().unwrap_or_default().to_string(),
                        join_phrase: credit["joinphrase"]
                            .as_str()
                            .unwrap_or_default()
                            .to_string(),
                        musicbrainz_id: credit["artist"]["id"]
                            .as_str()
                            .unwrap_or_default()
                            .to_string(),
                        artist_type: credit["artist"]["type"]
                            .as_str()
                            .unwrap_or_default()
                            .to_string(),
                        disambiguation: credit["artist"]["disambiguation"]
                            .as_str()
                            .unwrap_or_default()
                            .to_string(),
                        genres: credit["artist"]["genres"]
                            .as_array()
                            .unwrap_or(&vec![])
                            .iter()
                            .map(|genre| Genre {
                                musicbrainz_id: genre["id"]
                                    .as_str()
                                    .unwrap_or_default()
                                    .to_string(),
                                disambiguation: genre["disambiguation"]
                                    .as_str()
                                    .unwrap_or_default()
                                    .to_string(),
                                name: genre["name"].as_str().unwrap_or_default().to_string(),
                                count: genre["count"].as_u64().unwrap_or_default(),
                            })
                            .collect(),
                        aliases: credit["artist"]["aliases"]
                            .as_array()
                            .unwrap_or(&vec![])
                            .iter()
                            .map(|alias| Alias {
                                sort_name: alias["sort-name"]
                                    .as_str()
                                    .unwrap_or_default()
                                    .to_string(),
                                begin: alias["begin"]
                                    .as_str()
                                    .map(|s| s.to_string())
                                    .unwrap_or_default(),
                                ended: alias["ended"].as_bool().unwrap_or_default(),
                                name: alias["name"].as_str().unwrap_or_default().to_string(),
                                alias_type: alias["type"].as_str().unwrap_or_default().to_string(),
                                end: alias["end"]
                                    .as_str()
                                    .map(|s| s.to_string())
                                    .unwrap_or_default(),
                                primary: alias["primary"]
                                    .as_str()
                                    .map(|s| s.to_string())
                                    .unwrap_or_default(),
                                locale: alias["locale"]
                                    .as_str()
                                    .map(|s| s.to_string())
                                    .unwrap_or_default(),
                                type_id: alias["type-id"].as_str().unwrap_or_default().to_string(),
                            })
                            .collect(),
                    })
                    .collect(),
                aliases: group["aliases"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .map(|alias| alias.as_str().unwrap_or_default().to_string())
                    .collect(),
                secondary_types: group["secondary-types"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .map(|stype| stype.as_str().unwrap_or_default().to_string())
                    .collect(),
                disambiguation: group["disambiguation"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                first_release_date: group["first-release-date"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                entity_type: group["entity-type"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                type_id: group["type-id"].as_str().unwrap_or_default().to_string(),
                name: group["name"].as_str().unwrap_or_default().to_string(),
                editor: group["editor"].as_str().unwrap_or_default().to_string(),
                release_count: group["release-count"].as_u64().unwrap_or_default(),
                collection_type: group["collection-type"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            })
            .collect(),
        artist_credits: release_album_json["artist-credit"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .map(|credit| CreditArtist {
                name: credit["name"].as_str().unwrap_or_default().to_string(),
                join_phrase: credit["joinphrase"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                musicbrainz_id: credit["artist"]["id"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                artist_type: credit["artist"]["type"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                disambiguation: credit["artist"]["disambiguation"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                genres: credit["artist"]["genres"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .map(|genre| Genre {
                        musicbrainz_id: genre["id"].as_str().unwrap_or_default().to_string(),
                        disambiguation: genre["disambiguation"]
                            .as_str()
                            .unwrap_or_default()
                            .to_string(),
                        name: genre["name"].as_str().unwrap_or_default().to_string(),
                        count: genre["count"].as_u64().unwrap_or_default(),
                    })
                    .collect(),
                aliases: credit["artist"]["aliases"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .map(|alias| Alias {
                        sort_name: alias["sort-name"].as_str().unwrap_or_default().to_string(),
                        begin: alias["begin"]
                            .as_str()
                            .map(|s| s.to_string())
                            .unwrap_or_default(),
                        ended: alias["ended"].as_bool().unwrap_or_default(),
                        name: alias["name"].as_str().unwrap_or_default().to_string(),
                        alias_type: alias["type"].as_str().unwrap_or_default().to_string(),
                        end: alias["end"]
                            .as_str()
                            .map(|s| s.to_string())
                            .unwrap_or_default(),
                        primary: alias["primary"]
                            .as_str()
                            .map(|s| s.to_string())
                            .unwrap_or_default(),
                        locale: alias["locale"]
                            .as_str()
                            .map(|s| s.to_string())
                            .unwrap_or_default(),
                        type_id: alias["type-id"].as_str().unwrap_or_default().to_string(),
                    })
                    .collect(),
            })
            .collect(),
    };

    let labels = release_album_json["label-info"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|label_info| {
            let label = &label_info["label"];
            Label {
                catalog_number: label_info["catalog-number"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                type_id: label["type-id"].as_str().unwrap_or_default().to_string(),
                name: label["name"].as_str().unwrap_or_default().to_string(),
                sort_name: label["sort-name"].as_str().unwrap_or_default().to_string(),
                label_type: label["type"].as_str().unwrap_or_default().to_string(),
                id: label["id"].as_str().unwrap_or_default().to_string(),
                aliases: label["aliases"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .map(|alias| Alias {
                        begin: alias["begin"].as_str().unwrap_or_default().to_string(),
                        alias_type: alias["type"].as_str().unwrap_or_default().to_string(),
                        sort_name: alias["sort-name"].as_str().unwrap_or_default().to_string(),
                        name: alias["name"].as_str().unwrap_or_default().to_string(),
                        end: alias["end"].as_str().unwrap_or_default().to_string(),
                        locale: alias["locale"].as_str().unwrap_or_default().to_string(),
                        ended: alias["ended"].as_bool().unwrap_or_default(),
                        type_id: alias["type-id"].as_str().unwrap_or_default().to_string(),
                        primary: alias["primary"].as_str().unwrap_or_default().to_string(),
                    })
                    .collect(),
            }
        })
        .collect();

    let empty_vec = vec![];
    let media_array = release_album_json["media"].as_array().unwrap_or(&empty_vec);

    let tracks: Vec<Track> = media_array
        .iter()
        .flat_map(|media| media["tracks"].as_array().unwrap_or(&empty_vec))
        .map(|track| {
            let artist_credit: Vec<CreditArtist> = track["artist-credit"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(|artist_credit| CreditArtist {
                    name: artist_credit["name"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    join_phrase: artist_credit["joinphrase"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    musicbrainz_id: artist_credit["artist"]["id"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    artist_type: artist_credit["artist"]["type"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    disambiguation: artist_credit["artist"]["disambiguation"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    genres: artist_credit["artist"]["genres"]
                        .as_array()
                        .unwrap_or(&vec![])
                        .iter()
                        .map(|genre| Genre {
                            musicbrainz_id: genre["id"].as_str().unwrap_or_default().to_string(),
                            disambiguation: genre["disambiguation"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            name: genre["name"].as_str().unwrap_or_default().to_string(),
                            count: genre["count"].as_u64().unwrap_or_default(),
                        })
                        .collect(),
                    aliases: artist_credit["artist"]["aliases"]
                        .as_array()
                        .unwrap_or(&vec![])
                        .iter()
                        .map(|alias| Alias {
                            begin: alias["begin"].as_str().unwrap_or_default().to_string(),
                            alias_type: alias["type"].as_str().unwrap_or_default().to_string(),
                            sort_name: alias["sort-name"].as_str().unwrap_or_default().to_string(),
                            name: alias["name"].as_str().unwrap_or_default().to_string(),
                            end: alias["end"].as_str().unwrap_or_default().to_string(),
                            locale: alias["locale"].as_str().unwrap_or_default().to_string(),
                            ended: alias["ended"].as_bool().unwrap_or_default(),
                            type_id: alias["type-id"].as_str().unwrap_or_default().to_string(),
                            primary: alias["primary"].as_str().unwrap_or_default().to_string(),
                        })
                        .collect(),
                })
                .collect();

            let tags: Vec<Tag> = track["tags"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(|tag| Tag {
                    count: tag["count"].as_u64().unwrap_or_default(),
                    name: tag["name"].as_str().unwrap_or_default().to_string(),
                })
                .collect();

            Track {
                length: track["length"].as_u64().unwrap_or_default(),
                artist_credit,
                track_name: track["title"].as_str().unwrap_or_default().to_string(),
                position: track["position"].as_u64().unwrap_or_default() as u16,
                video: track["video"].as_bool().unwrap_or_default(),
                first_release_date: track["first-release-date"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                number: track["number"].as_str().unwrap_or_default().to_string(),
                musicbrainz_id: track["id"].as_str().unwrap_or_default().to_string(),
                rating: Rating {
                    value: track["rating"]["value"].as_f64().unwrap_or_default(),
                    votes_count: track["rating"]["count"].as_u64().unwrap_or_default(),
                },
                tags,
            }
        })
        .collect();

    let relationships = release_album_json["relations"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|relation| Relationship {
            direction: relation["direction"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            type_id: relation["type-id"].as_str().unwrap_or_default().to_string(),
            ended: relation["ended"].as_bool().unwrap_or_default(),
            begin: relation["begin"].as_str().unwrap_or_default().to_string(),
            purchase_relationship_type: relation["purchase-relationship-type"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            musicbrainz_id: relation["musicbrainz-id"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            target_credit: relation["target-credit"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            source_credit: relation["source-credit"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            target_type: relation["target-type"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            end: relation["end"].as_str().unwrap_or_default().to_string(),
            url: relation["url"].as_str().unwrap_or_default().to_string(),
        })
        .collect();

    let musicbrainz_id = release_album_json["id"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let first_release_date = release_album_json["first-release-date"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let title = release_album_json["title"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let aliases = release_album_json["aliases"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|alias| Alias {
            begin: alias["begin"].as_str().unwrap_or_default().to_string(),
            alias_type: alias["alias-type"].as_str().unwrap_or_default().to_string(),
            sort_name: alias["sort-name"].as_str().unwrap_or_default().to_string(),
            name: alias["name"].as_str().unwrap_or_default().to_string(),
            end: alias["end"].as_str().unwrap_or_default().to_string(),
            locale: alias["locale"].as_str().unwrap_or_default().to_string(),
            ended: alias["ended"].as_bool().unwrap_or_default(),
            type_id: alias["type-id"].as_str().unwrap_or_default().to_string(),
            primary: alias["primary"].as_str().unwrap_or_default().to_string(),
        })
        .collect();
    let primary_type_id = release_album_json["primary-type-id"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let annotation = release_album_json["annotation"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let tags = release_album_json["tags"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|tag| Tag {
            count: tag["count"].as_u64().unwrap_or_default(),
            name: tag["name"].as_str().unwrap_or_default().to_string(),
        })
        .collect();
    let genres = release_album_json["genres"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|genre| Genre {
            musicbrainz_id: genre["musicbrainz-id"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            disambiguation: genre["disambiguation"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            name: genre["name"].as_str().unwrap_or_default().to_string(),
            count: genre["count"].as_u64().unwrap_or_default(),
        })
        .collect();

    Ok(ReleaseAlbum {
        information,
        tracks,
        labels,
        relationships,
        musicbrainz_id,
        first_release_date,
        title,
        aliases,
        primary_type_id,
        annotation,
        tags,
        genres,
    })
}

fn map_to_release_group_album(
    release_group_json: &Value,
) -> Result<ReleaseGroupAlbum, Box<dyn Error>> {
    let musicbrainz_id = release_group_json["id"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let first_release_date = release_group_json["first-release-date"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let title = release_group_json["title"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let primary_type_id = release_group_json["primary-type-id"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let annotation = release_group_json["annotation"]
        .as_str()
        .unwrap_or_default()
        .to_string();

    let rating = Rating {
        votes_count: release_group_json["rating"]["votes-count"]
            .as_u64()
            .unwrap_or_default(),
        value: release_group_json["rating"]["value"]
            .as_f64()
            .unwrap_or_default(),
    };

    let artist_credit = release_group_json["artist-credit"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|credit| CreditArtist {
            name: credit["name"].as_str().unwrap_or_default().to_string(),
            join_phrase: credit["joinphrase"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            musicbrainz_id: credit["artist"]["id"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            artist_type: credit["artist"]["type"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            disambiguation: credit["artist"]["disambiguation"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            genres: credit["artist"]["genres"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(|genre| Genre {
                    musicbrainz_id: genre["id"].as_str().unwrap_or_default().to_string(),
                    disambiguation: genre["disambiguation"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    name: genre["name"].as_str().unwrap_or_default().to_string(),
                    count: genre["count"].as_u64().unwrap_or_default(),
                })
                .collect(),
            aliases: credit["artist"]["aliases"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(|alias| Alias {
                    sort_name: alias["sort-name"].as_str().unwrap_or_default().to_string(),
                    begin: alias["begin"]
                        .as_str()
                        .map(|s| s.to_string())
                        .unwrap_or_default(),
                    ended: alias["ended"].as_bool().unwrap_or_default(),
                    name: alias["name"].as_str().unwrap_or_default().to_string(),
                    alias_type: alias["type"].as_str().unwrap_or_default().to_string(),
                    end: alias["end"]
                        .as_str()
                        .map(|s| s.to_string())
                        .unwrap_or_default(),
                    primary: alias["primary"]
                        .as_str()
                        .map(|s| s.to_string())
                        .unwrap_or_default(),
                    locale: alias["locale"]
                        .as_str()
                        .map(|s| s.to_string())
                        .unwrap_or_default(),
                    type_id: alias["type-id"].as_str().unwrap_or_default().to_string(),
                })
                .collect(),
        })
        .collect();

    let relationships = release_group_json["relations"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|relationship| Relationship {
            direction: relationship["direction"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            type_id: relationship["type-id"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            ended: relationship["ended"].as_bool().unwrap_or_default(),
            begin: relationship["begin"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            purchase_relationship_type: relationship["type"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            musicbrainz_id: relationship["url"]["id"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            target_credit: relationship["target-credit"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            source_credit: relationship["source-credit"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            target_type: relationship["target-type"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            end: relationship["end"].as_str().unwrap_or_default().to_string(),
            url: relationship["url"]["resource"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        })
        .collect();

    let releases = release_group_json["releases"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|release| Information {
            title: release["title"].as_str().unwrap_or_default().to_string(),
            status: release["status"].as_str().unwrap_or_default().to_string(),
            date: release["date"].as_str().unwrap_or_default().to_string(),
            country: release["country"].as_str().unwrap_or_default().to_string(),
            barcode: release["barcode"].as_str().unwrap_or_default().to_string(),
            status_id: release["status-id"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            quality: release["quality"].as_str().unwrap_or_default().to_string(),
            packaging: release["packaging"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            disambiguation: release["disambiguation"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            release_type: release["release-type"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            asin: release["asin"].as_str().unwrap_or_default().to_string(),
            music_brainz_id: release["music-brainz-id"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            packaging_id: release["packaging-id"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            tags: release["tags"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(|tag| Tag {
                    name: tag["name"].as_str().unwrap_or_default().to_string(),
                    count: tag["count"].as_u64().unwrap_or_default(),
                })
                .collect(),
            genres: release["genres"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(|genre| Genre {
                    musicbrainz_id: genre["id"].as_str().unwrap_or_default().to_string(),
                    disambiguation: genre["disambiguation"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    name: genre["name"].as_str().unwrap_or_default().to_string(),
                    count: genre["count"].as_u64().unwrap_or_default(),
                })
                .collect(),
            cover_art_status: CoverArtStatus {
                count: release["cover-art-archive"]["count"]
                    .as_u64()
                    .unwrap_or_default() as u16,
                front: release["cover-art-archive"]["front"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                darkened: release["cover-art-archive"]["darkened"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                artwork: release["cover-art-archive"]["artwork"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                back: release["cover-art-archive"]["back"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            },
            collections: release["collections"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(|collection| Collection {
                    entity_type: collection["entity-type"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    type_id: collection["type-id"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    name: collection["name"].as_str().unwrap_or_default().to_string(),
                    editor: collection["editor"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    release_count: collection["release-count"].as_u64().unwrap_or_default(),
                    id: collection["id"].as_str().unwrap_or_default().to_string(),
                    collection_type: collection["type"].as_str().unwrap_or_default().to_string(),
                    secondary_type_ids: collection["secondary-type-ids"]
                        .as_array()
                        .unwrap_or(&vec![])
                        .iter()
                        .map(|id| id.as_str().unwrap_or_default().to_string())
                        .collect(),
                    tags: collection["tags"]
                        .as_array()
                        .unwrap_or(&vec![])
                        .iter()
                        .map(|tag| Tag {
                            name: tag["name"].as_str().unwrap_or_default().to_string(),
                            count: tag["count"].as_u64().unwrap_or_default(),
                        })
                        .collect(),
                    artist_credit: collection["artist-credit"]
                        .as_array()
                        .unwrap_or(&vec![])
                        .iter()
                        .map(|credit| CreditArtist {
                            name: credit["name"].as_str().unwrap_or_default().to_string(),
                            join_phrase: credit["joinphrase"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            musicbrainz_id: credit["artist"]["id"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            artist_type: credit["artist"]["type"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            disambiguation: credit["artist"]["disambiguation"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            genres: credit["artist"]["genres"]
                                .as_array()
                                .unwrap_or(&vec![])
                                .iter()
                                .map(|genre| Genre {
                                    musicbrainz_id: genre["id"]
                                        .as_str()
                                        .unwrap_or_default()
                                        .to_string(),
                                    disambiguation: genre["disambiguation"]
                                        .as_str()
                                        .unwrap_or_default()
                                        .to_string(),
                                    name: genre["name"].as_str().unwrap_or_default().to_string(),
                                    count: genre["count"].as_u64().unwrap_or_default(),
                                })
                                .collect(),
                            aliases: credit["artist"]["aliases"]
                                .as_array()
                                .unwrap_or(&vec![])
                                .iter()
                                .map(|alias| Alias {
                                    sort_name: alias["sort-name"]
                                        .as_str()
                                        .unwrap_or_default()
                                        .to_string(),
                                    begin: alias["begin"]
                                        .as_str()
                                        .map(|s| s.to_string())
                                        .unwrap_or_default(),
                                    ended: alias["ended"].as_bool().unwrap_or_default(),
                                    name: alias["name"].as_str().unwrap_or_default().to_string(),
                                    alias_type: alias["type"]
                                        .as_str()
                                        .unwrap_or_default()
                                        .to_string(),
                                    end: alias["end"]
                                        .as_str()
                                        .map(|s| s.to_string())
                                        .unwrap_or_default(),
                                    primary: alias["primary"]
                                        .as_str()
                                        .map(|s| s.to_string())
                                        .unwrap_or_default(),
                                    locale: alias["locale"]
                                        .as_str()
                                        .map(|s| s.to_string())
                                        .unwrap_or_default(),
                                    type_id: alias["type-id"]
                                        .as_str()
                                        .unwrap_or_default()
                                        .to_string(),
                                })
                                .collect(),
                        })
                        .collect(),
                    aliases: collection["aliases"]
                        .as_array()
                        .unwrap_or(&vec![])
                        .iter()
                        .map(|alias| alias.as_str().unwrap_or_default().to_string())
                        .collect(),
                    secondary_types: collection["secondary-types"]
                        .as_array()
                        .unwrap_or(&vec![])
                        .iter()
                        .map(|stype| stype.as_str().unwrap_or_default().to_string())
                        .collect(),
                    disambiguation: collection["disambiguation"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    first_release_date: collection["first-release-date"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                })
                .collect(),
            artist_credits: release["artist-credit"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(|credit| CreditArtist {
                    name: credit["name"].as_str().unwrap_or_default().to_string(),
                    join_phrase: credit["joinphrase"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    musicbrainz_id: credit["artist"]["id"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    artist_type: credit["artist"]["type"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    disambiguation: credit["artist"]["disambiguation"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    genres: credit["artist"]["genres"]
                        .as_array()
                        .unwrap_or(&vec![])
                        .iter()
                        .map(|genre| Genre {
                            musicbrainz_id: genre["id"].as_str().unwrap_or_default().to_string(),
                            disambiguation: genre["disambiguation"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            name: genre["name"].as_str().unwrap_or_default().to_string(),
                            count: genre["count"].as_u64().unwrap_or_default(),
                        })
                        .collect(),
                    aliases: credit["artist"]["aliases"]
                        .as_array()
                        .unwrap_or(&vec![])
                        .iter()
                        .map(|alias| Alias {
                            sort_name: alias["sort-name"].as_str().unwrap_or_default().to_string(),
                            begin: alias["begin"]
                                .as_str()
                                .map(|s| s.to_string())
                                .unwrap_or_default(),
                            ended: alias["ended"].as_bool().unwrap_or_default(),
                            name: alias["name"].as_str().unwrap_or_default().to_string(),
                            alias_type: alias["type"].as_str().unwrap_or_default().to_string(),
                            end: alias["end"]
                                .as_str()
                                .map(|s| s.to_string())
                                .unwrap_or_default(),
                            primary: alias["primary"]
                                .as_str()
                                .map(|s| s.to_string())
                                .unwrap_or_default(),
                            locale: alias["locale"]
                                .as_str()
                                .map(|s| s.to_string())
                                .unwrap_or_default(),
                            type_id: alias["type-id"].as_str().unwrap_or_default().to_string(),
                        })
                        .collect(),
                })
                .collect(),
        })
        .collect();

    let aliases = release_group_json["aliases"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|alias| Alias {
            sort_name: alias["sort-name"].as_str().unwrap_or_default().to_string(),
            begin: alias["begin"]
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_default(),
            ended: alias["ended"].as_bool().unwrap_or_default(),
            name: alias["name"].as_str().unwrap_or_default().to_string(),
            alias_type: alias["type"].as_str().unwrap_or_default().to_string(),
            end: alias["end"]
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_default(),
            primary: alias["primary"]
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_default(),
            locale: alias["locale"]
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_default(),
            type_id: alias["type-id"].as_str().unwrap_or_default().to_string(),
        })
        .collect();

    let tags = release_group_json["tags"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|tag| Tag {
            name: tag["name"].as_str().unwrap_or_default().to_string(),
            count: tag["count"].as_u64().unwrap_or_default(),
        })
        .collect();

    let genres = release_group_json["genres"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|genre| Genre {
            musicbrainz_id: genre["id"].as_str().unwrap_or_default().to_string(),
            disambiguation: genre["disambiguation"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            name: genre["name"].as_str().unwrap_or_default().to_string(),
            count: genre["count"].as_u64().unwrap_or_default(),
        })
        .collect();

    Ok(ReleaseGroupAlbum {
        rating,
        artist_credit,
        relationships,
        releases,
        musicbrainz_id,
        first_release_date,
        title,
        aliases,
        primary_type_id,
        annotation,
        tags,
        genres,
    })
}

async fn fetch_audio_db_info(client: &Client, artist: &mut Artist, store_image: bool) -> Result<(), Box<dyn StdError + Send + Sync>> {
    let mut params = HashMap::new();
    params.insert("search", &artist.name);

    let res = client.post("https://www.theaudiodb.com/browse.php")
        .form(&params)
        .send()
        .await?;

    let body = res.text().await?;

    if store_image {
        let document = Html::parse_document(&body);
        if let Ok(img_sel) = Selector::parse("div.col-sm-3 img") {
            if let Some(img_el) = document.select(&img_sel).next() {
                if let Some(src) = img_el.value().attr("src") {
                    if let Ok(path) = download_and_store_icon_art(client, src, &artist.id.to_string()).await {
                        artist.icon_url = path;
                        let log = format!("AudioDB fallback icon stored for Artist: {}", artist.name);
                        info!("{}", log.clone());
                        log_to_ws(log).await;
                    }
                }
            }
        }
    }
        
    let document = Html::parse_document(&body);
    let selector = Selector::parse("div.col-sm-3 a")
        .map_err(|e: scraper::error::SelectorErrorKind| Box::<dyn StdError + Send + Sync>::from(e.to_string()))?;

    for element in document.select(&selector) {
        if let Some(href) = element.value().attr("href") {
            if href.contains("/artist/") {
                let parts: Vec<&str> = href.split('/').collect();
                if parts.len() > 2 {
                    let artist_id = parts[2].split('-').next().unwrap();

                    let api_url = format!("https://www.theaudiodb.com/api/v1/json/2/mvid.php?i={}", artist_id);
                    let api_res = client.get(&api_url).send().await?;

                    let api_body = api_res.text().await?;
                    artist.tadb_music_videos = Some(api_body.clone());

                    let root: Value = serde_json::from_str(&api_body)?;

                    for album in &mut artist.albums {
                        for song in &mut album.songs {
                            if let Some(mvids) = root["mvids"].as_array() {
                                for mvid in mvids {
                                    let distance = levenshtein(&song.name, mvid["strTrack"].as_str().unwrap_or(""));
                                    if distance < 3 {
                                        song.music_video = Some(MusicVideo {
                                            url: mvid["strMusicVid"].as_str().unwrap_or("").to_string(),
                                            thumbnail_url: mvid["strTrackThumb"].as_str().map(|s| s.to_string()),
                                            tadb_track_id: mvid["idTrack"].as_str().unwrap_or("").to_string(),
                                            tadb_album_id: mvid["idAlbum"].as_str().unwrap_or("").to_string(),
                                            description: mvid["strDescriptionEN"].as_str().unwrap_or("").to_string(),
                                            musicbrainz_recording_id: mvid["strMusicBrainzID"].as_str().unwrap_or("").to_string(),
                                        });
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

pub fn refresh_audio_db_info(artist: &mut Artist) {
    if let Some(tadb_music_videos) = &artist.tadb_music_videos {
        let root: Value = serde_json::from_str(tadb_music_videos).unwrap();

        for album in &mut artist.albums {
            for song in &mut album.songs {
                if let Some(mvids) = root["mvids"].as_array() {
                    for mvid in mvids {
                        let distance = levenshtein(&song.name, mvid["strTrack"].as_str().unwrap_or(""));
                        if distance < 3 {
                            song.music_video = Some(MusicVideo {
                                url: mvid["strMusicVid"].as_str().unwrap_or("").to_string(),
                                thumbnail_url: mvid["strTrackThumb"].as_str().map(|s| s.to_string()),
                                tadb_track_id: mvid["idTrack"].as_str().unwrap_or("").to_string(),
                                tadb_album_id: mvid["idAlbum"].as_str().unwrap_or("").to_string(),
                                description: mvid["strDescriptionEN"].as_str().unwrap_or("").to_string(),
                                musicbrainz_recording_id: mvid["strMusicBrainzID"].as_str().unwrap_or("").to_string(),
                            });
                            break;
                        }
                    }
                }
            }
        }
    }
}