use std::env;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use actix_web::{delete, get, post, web, HttpResponse, Responder};
use chrono::NaiveDateTime;
use diesel::{ExpressionMethods, QueryDsl, RunQueryDsl};
use dirs;
use lazy_static::lazy_static;
use rand::seq::SliceRandom;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{self, from_str, json};
use tantivy::collector::TopDocs;
use tantivy::query::{FuzzyTermQuery, QueryParser};
use tantivy::schema::{*, Term};
use tantivy::{doc, Index, IndexWriter, ReloadPolicy};
use tokio::task;
use tracing::{error, info};

use crate::routes::album::fetch_album_info;
use crate::routes::artist::fetch_artist_info;
use crate::routes::song::fetch_song_info;
use crate::structures::structures::Artist;
use crate::utils::config::{get_config, is_docker};
use crate::utils::database::database::establish_connection;
use crate::utils::database::models::{NewSearchItem, SearchItem};

#[derive(Serialize, Deserialize, Clone)]
pub struct CombinedItem {
    pub item_type: String,
    pub name: String,
    pub id: String,
    pub description: Option<String>,
    pub acronym: String,
}

fn extract_acronym(name: &str) -> String {
    let acronym: String = name.split_whitespace()
        .map(|word| {
            if word == "&" {
                'A'
            } else {
                word.chars().next().unwrap_or_default().to_uppercase().next().unwrap_or_default()
            }
        })
        .collect();

    if acronym.len() > 1 {
        acronym
    } else {
        String::new()
    }
}

lazy_static! {
    static ref TEMP_DIR_PATH: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));
}

pub fn get_tantivy_index_path() -> PathBuf {
    let path = if is_docker() {
        Path::new("/ParsonLabsMusic/Search").to_path_buf()
    } else {
        let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push("ParsonLabs");
        path.push("Music");
        path.push("Search");
        path
    };

    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            eprintln!("Failed to create parent directories: {}", e);
        }
    } else {
        eprintln!("Parent directory is None for path: {:?}", path);
    }

    if let Err(e) = fs::create_dir_all(&path) {
        eprintln!("Failed to create search directory: {}", e);
    }

    path
}

pub async fn populate_search_data() -> Result<Vec<CombinedItem>, Box<dyn std::error::Error + Send + Sync>> {
    let config = match get_config().await {
        Ok(config) => config,
        Err(_e) => {
            let no_config = "Tantivy could not populate the search data! This is expected if the library has not been indexed yet or music.json file is not present.";
            error!("{}", no_config);
            return Err(no_config.to_string().into());
        }
    };

    let library: Vec<Artist> = from_str(&config)?;

    let index_path = get_tantivy_index_path();

    if index_path.exists() {
        std::fs::remove_dir_all(&index_path)?;
    }

    if let Err(e) = fs::create_dir_all(&index_path) {
        error!("Failed to create index directory: {}", e);
        return Err(format!("Failed to create index directory: {}", e).into());
    }

    {
        let mut temp_dir_path = TEMP_DIR_PATH.lock().unwrap();
        *temp_dir_path = Some(index_path.clone());
    }

    let mut schema_builder = Schema::builder();
    schema_builder.add_text_field("item_type", TEXT | STORED);
    schema_builder.add_text_field("name", TEXT | STORED);
    schema_builder.add_text_field("id", TEXT | STORED);
    schema_builder.add_text_field("description", TEXT | STORED);
    schema_builder.add_text_field("acronym", TEXT | STORED);
    let schema = schema_builder.build();

    let index = Index::create_in_dir(&index_path, schema.clone())?;

    let mut index_writer: IndexWriter = index.writer(100_000_000)?;

    let mut combined_items = Vec::new();

    for artist in library {
        let artist_doc = doc!(
            schema.get_field("item_type").unwrap() => "artist",
            schema.get_field("name").unwrap() => artist.name.clone(),
            schema.get_field("id").unwrap() => artist.id.clone(),
            schema.get_field("description").unwrap() => artist.description.clone(),
            schema.get_field("acronym").unwrap() => extract_acronym(&artist.name),
        );
        index_writer.add_document(artist_doc)?;

        combined_items.push(CombinedItem {
            item_type: "artist".to_string(),
            name: artist.name.clone(),
            id: artist.id.clone(),
            description: Some(artist.description),
            acronym: extract_acronym(&artist.name),
        });

        for album in &artist.albums {
            let album_doc = doc!(
                schema.get_field("item_type").unwrap() => "album",
                schema.get_field("name").unwrap() => album.name.clone(),
                schema.get_field("id").unwrap() => album.id.clone(),
                schema.get_field("description").unwrap() => album.description.clone(),
                schema.get_field("acronym").unwrap() => extract_acronym(&album.name),
            );
            index_writer.add_document(album_doc)?;

            combined_items.push(CombinedItem {
                item_type: "album".to_string(),
                name: album.name.clone(),
                id: album.id.clone(),
                description: Some(album.description.clone()),
                acronym: extract_acronym(&album.name),
            });

            for song in &album.songs {
                let song_doc = doc!(
                    schema.get_field("item_type").unwrap() => "song",
                    schema.get_field("name").unwrap() => song.name.clone(),
                    schema.get_field("id").unwrap() => song.id.clone(),
                    schema.get_field("description").unwrap() => "",
                    schema.get_field("acronym").unwrap() => extract_acronym(&song.name),
                );
                index_writer.add_document(song_doc)?;

                combined_items.push(CombinedItem {
                    item_type: "song".to_string(),
                    name: song.name.clone(),
                    id: song.id.clone(),
                    description: None,
                    acronym: extract_acronym(&song.name),
                });
            }
        }
    }

    index_writer.commit()?;

    let meta_path = index_path.join("meta.json");
    if !meta_path.exists() {
        error!("Index metadata file does not exist after commit at {:?}", meta_path);
        return Err("Index metadata file does not exist after commit".into());
    }

    Ok(combined_items)
}

#[get("/populate")]
async fn populate_search() -> HttpResponse {
    match populate_search_data().await {
        Ok(combined_items) => HttpResponse::Ok().json(combined_items),
        Err(e) => {
            error!("Failed to populate search data: {:?}", e);
            HttpResponse::InternalServerError().body(format!("Failed to populate search data: {:?}", e))
        }
    }
}

#[derive(Serialize, Deserialize)]
struct SearchQuery {
    q: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct ArtistInfo {
    id: String,
    name: String,
    icon_url: String,
    followers: u64,
    description: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct AlbumInfo {
    id: String,
    name: String,
    cover_url: String,
    first_release_date: String,
    description: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct SongInfo {
    id: String,
    name: String,
    duration: f64,
}

#[derive(Serialize, Deserialize, Debug)]
struct ResponseCombinedItem {
    item_type: String,
    name: String,
    id: String,
    description: Option<String>,
    acronym: String,
    artist_object: Option<ArtistInfo>,
    album_object: Option<AlbumInfo>,
    song_object: Option<SongInfo>,
}

#[get("/library")]
async fn search_fn(query: web::Query<SearchQuery>) -> HttpResponse {
    let index_path: PathBuf = {
        let temp_dir_path = TEMP_DIR_PATH.lock().unwrap();
        match &*temp_dir_path {
            Some(path) => path.clone(),
            None => {
                error!("TempDir path is not set");
                return HttpResponse::InternalServerError().body("TempDir path is not set");
            }
        }
    };

    if !index_path.exists() {
        if let Err(e) = std::fs::create_dir_all(&index_path) {
            error!("Failed to create directory: {:?}", e);
            return HttpResponse::InternalServerError().body(format!("Failed to create directory: {:?}", e));
        }
    }

    let meta_path = index_path.join("meta.json");
    if !meta_path.exists() {
        error!("Index metadata file does not exist at {:?}", meta_path);
        return HttpResponse::InternalServerError().body("Index metadata file does not exist");
    }

    let mut schema_builder = Schema::builder();
    schema_builder.add_text_field("item_type", TEXT | STORED);
    schema_builder.add_text_field("name", TEXT | STORED);
    schema_builder.add_text_field("id", TEXT | STORED);
    schema_builder.add_text_field("description", TEXT | STORED);
    schema_builder.add_text_field("acronym", TEXT | STORED);
    let schema = schema_builder.build();

    let index = match Index::open_in_dir(&index_path) {
        Ok(index) => index,
        Err(e) => {
            error!("Failed to open index: {:?}", e);
            return HttpResponse::InternalServerError().body(format!("Failed to open index: {:?}", e));
        }
    };

    let reader = match index.reader_builder().reload_policy(ReloadPolicy::OnCommitWithDelay).try_into() {
        Ok(reader) => reader,
        Err(e) => {
            error!("Failed to create reader: {:?}", e);
            return HttpResponse::InternalServerError().body(format!("Failed to create reader: {:?}", e));
        }
    };

    let searcher = reader.searcher();

    let query_parser = QueryParser::for_index(&index, vec![
        schema.get_field("name").unwrap(),
        schema.get_field("description").unwrap(),
    ]);

    let parsed_query = match query_parser.parse_query(&query.q) {
        Ok(parsed_query) => parsed_query,
        Err(e) => {
            error!("Failed to parse query: {:?}", e);
            return HttpResponse::BadRequest().body(format!("Failed to parse query: {:?}", e));
        }
    };

    let top_docs = match searcher.search(&parsed_query, &TopDocs::with_limit(10)) {
        Ok(top_docs) => top_docs,
        Err(e) => {
            error!("Search failed: {:?}", e);
            return HttpResponse::InternalServerError().body(format!("Search failed: {:?}", e));
        }
    };

    let fuzzy_query = FuzzyTermQuery::new(
        Term::from_field_text(schema.get_field("name").unwrap(), &query.q),
        2,
        true,
    );

    let fuzzy_top_docs = match searcher.search(&fuzzy_query, &TopDocs::with_limit(10)) {
        Ok(fuzzy_top_docs) => fuzzy_top_docs,
        Err(e) => {
            error!("Fuzzy search failed: {:?}", e);
            return HttpResponse::InternalServerError().body(format!("Fuzzy search failed: {:?}", e));
        }
    };

    let combined_top_docs = top_docs.into_iter().chain(fuzzy_top_docs.into_iter()).collect::<Vec<_>>();

    let hits: Vec<ResponseCombinedItem> = task::spawn_blocking(move || {
        combined_top_docs.into_par_iter().map(|(_score, doc_address)| {
            let searcher = searcher.clone();
            let schema = schema.clone();
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async move {
                let retrieved_doc: tantivy::TantivyDocument = searcher.doc(doc_address).unwrap();
                let item_type = retrieved_doc.get_first(schema.get_field("item_type").unwrap()).unwrap().as_str().unwrap().to_string();
                let name = retrieved_doc.get_first(schema.get_field("name").unwrap()).unwrap().as_str().unwrap().to_string();
                let id = retrieved_doc.get_first(schema.get_field("id").unwrap()).unwrap().as_str().unwrap().to_string();
                let description = retrieved_doc.get_first(schema.get_field("description").unwrap()).map(|f| f.as_str().unwrap().to_string());
                let acronym = retrieved_doc.get_first(schema.get_field("acronym").unwrap()).unwrap().as_str().unwrap().to_string();

                let song_object = if item_type == "song" {
                    fetch_song_info(id.clone(), None, None).await.ok()
                } else {
                    None
                };
                let album_object = if item_type == "album" {
                    fetch_album_info(id.clone(), None).await.ok()
                } else {
                    None
                };
                let artist_object = if item_type == "artist" {
                    fetch_artist_info(id.clone()).await.ok()
                } else {
                    None
                };

                ResponseCombinedItem {
                    item_type: item_type.clone(),
                    name,
                    id,
                    description,
                    acronym,
                    artist_object: match item_type.as_str() {
                        "song" => song_object.as_ref().and_then(|song| match song {
                            super::song::SongInfo::Full(song) => Some(ArtistInfo {
                                id: song.artist_object.id.clone(),
                                name: song.artist_object.name.clone(),
                                icon_url: song.artist_object.icon_url.clone(),
                                followers: song.artist_object.followers,
                                description: song.artist_object.description.clone(),
                            }),
                            _ => None,
                        }),
                        "album" => album_object.as_ref().and_then(|album| match album {
                            super::album::AlbumInfo::Full(album) => Some(ArtistInfo {
                                id: album.artist_object.id.clone(),
                                name: album.artist_object.name.clone(),
                                icon_url: album.artist_object.icon_url.clone(),
                                followers: album.artist_object.followers,
                                description: album.artist_object.description.clone(),
                            }),
                            _ => None,
                        }),
                        "artist" => artist_object.as_ref().map(|artist| ArtistInfo {
                            id: artist.id.clone(),
                            name: artist.name.clone(),
                            icon_url: artist.icon_url.clone(),
                            followers: artist.followers,
                            description: artist.description.clone(),
                        }),
                        _ => None,
                    },
                    album_object: match item_type.as_str() {
                        "song" => song_object.as_ref().and_then(|song| match song {
                            super::song::SongInfo::Full(song) => Some(AlbumInfo {
                                id: song.album_object.id.clone(),
                                name: song.album_object.name.clone(),
                                cover_url: song.album_object.cover_url.clone(),
                                first_release_date: song.album_object.first_release_date.clone(),
                                description: song.album_object.description.clone(),
                            }),
                            _ => None,
                        }),
                        _ => album_object.as_ref().and_then(|album| match album {
                            super::album::AlbumInfo::Full(album) => Some(AlbumInfo {
                                id: album.id.clone(),
                                name: album.name.clone(),
                                cover_url: album.cover_url.clone(),
                                first_release_date: album.first_release_date.clone(),
                                description: album.description.clone(),
                            }),
                            _ => None,
                        }),
                    },
                    song_object: song_object.as_ref().and_then(|song| match song {
                        super::song::SongInfo::Full(song) => Some(SongInfo {
                            id: song.id.clone(),
                            name: song.name.clone(),
                            duration: song.duration,
                        }),
                        _ => None,
                    }),
                }
            })
        }).collect::<Vec<_>>()
    }).await.unwrap();

    HttpResponse::Ok().json(hits)
}

#[derive(Deserialize)]
struct AddSearchHistoryRequest {
    user_id: i32,
    search: String,
}

#[derive(Deserialize)]
struct DeleteItemFromSearchHistoryRequest {
    id: i32,
}

#[derive(Deserialize)]
struct GetLastSearchedQueriesRequest {
    user_id: i32,
}

#[derive(Serialize)]
struct SearchItemResponse {
    id: i32,
    user_id: i32,
    search: String,
    created_at: NaiveDateTime,
}

#[post("/add_search_history")]
async fn add_search_history(item: web::Json<AddSearchHistoryRequest>) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::search_item::dsl::*;

    let mut connection = establish_connection().get().unwrap();

    let new_search_item = NewSearchItem {
        user_id: item.user_id,
        search: item.search.clone(),
    };

    diesel::insert_into(search_item)
        .values(&new_search_item)
        .execute(&mut connection)?;

    Ok(HttpResponse::Ok().body("Search history added successfully"))
}

#[delete("/delete_item_from_search_history")]
async fn delete_item_from_search_history(item: web::Json<DeleteItemFromSearchHistoryRequest>) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::search_item::dsl::*;

    let mut connection = establish_connection().get().unwrap();

    diesel::delete(search_item.filter(id.eq(item.id)))
        .execute(&mut connection)?;

    Ok(HttpResponse::Ok().body("Search history item deleted successfully"))
}

#[get("/get_last_searched_queries")]
async fn get_last_searched_queries(query: web::Query<GetLastSearchedQueriesRequest>) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::search_item::dsl::*;

    let mut connection = establish_connection().get().unwrap();

    let results = search_item
        .filter(user_id.eq(query.user_id))
        .order(created_at.desc())
        .limit(10)
        .load::<SearchItem>(&mut connection)?;

    let response: Vec<SearchItemResponse> = results.into_iter().map(|item| SearchItemResponse {
        id: item.id,
        user_id: item.user_id,
        search: item.search,
        created_at: item.created_at,
    }).collect();

    Ok(HttpResponse::Ok().json(response))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchRequest {
    q: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Channel {
    name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct YouTubeVideoResponse {
    id: String,
    title: String,
    thumbnail: String,
    channel: Channel,
    url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct InvidiousVideo {
    #[serde(rename = "videoId")]
    video_id: String,
    title: String,
    author: String,
}

#[get("/youtube")]
async fn search_youtube(query: web::Query<SearchRequest>) -> Result<impl Responder, Box<dyn Error>> {
    let client = reqwest::Client::new();
    let search_query = &query.q;
    
    let invidious_url = env::var("INVIDIOUS_URL")
        .unwrap_or_else(|_| get_random_invidious_instance());

    let response = client
        .get(format!(
            "{}/api/v1/search?q={}&type=video&page=1",
            invidious_url.trim_end_matches('/'),
            search_query
        ))
        .header("Accept", "application/json")
        .send()
        .await?
        .json::<Vec<InvidiousVideo>>()
        .await?;

    let limited_results = response.into_iter()
        .take(10)
        .map(|video| YouTubeVideoResponse {
            id: video.video_id.clone(),
            title: video.title,
            thumbnail: format!("https://i.ytimg.com/vi/{}/mqdefault.jpg", video.video_id),
            channel: Channel { 
                name: video.author 
            },
            url: format!("https://youtube.com/watch?v={}", video.video_id),
        })
        .collect::<Vec<_>>();

    Ok(HttpResponse::Ok().json(limited_results))
}

#[derive(Deserialize)]
struct CommentsRequest {
    video_id: String,
}

#[derive(Default, Debug, Serialize, Deserialize)]
struct CommentInfo {
    #[serde(rename = "commentCount")]
    comment_count: i64,
    #[serde(rename = "videoId")]
    video_id: String,
    comments: Vec<InvidiousComment>,
    continuation: Option<String>,
}

#[derive(Default, Debug, Serialize, Deserialize)]
struct InvidiousComment {
    #[serde(rename = "authorId")]
    author_id: String,
    #[serde(rename = "authorUrl")]
    author_url: String,
    author: String,
    verified: bool,
    #[serde(rename = "authorThumbnails")]
    author_thumbnails: Vec<AuthorThumbnail>,
    #[serde(rename = "authorIsChannelOwner")]
    author_is_channel_owner: bool,
    #[serde(rename = "isSponsor")]
    is_sponsor: bool,
    #[serde(rename = "likeCount")]
    likes: i64,
    #[serde(rename = "isPinned")]
    is_pinned: bool,
    #[serde(rename = "commentId")]
    comment_id: String,
    content: String,
    #[serde(rename = "contentHtml")]
    content_html: String,
    #[serde(rename = "isEdited")]
    is_edited: bool,
    published: i64,
    #[serde(rename = "publishedText")]
    published_text: String,
    replies: Option<Replies>,
}

#[derive(Default, Debug, Serialize, Deserialize)]
struct AuthorThumbnail {
    url: String,
    width: i32,
    height: i32,
}

#[derive(Default, Serialize, Debug)]
struct CommentResponse {
    author: String,
    author_thumbnails: Vec<AuthorThumbnail>,
    content: String,
    likes: i64,
    published: String,
    published_text: String,
    is_pinned: bool,
    replies: Option<Replies>,
}

#[derive(Default, Debug, Serialize, Deserialize)]
struct Replies {
    #[serde(rename = "replyCount")]
    reply_count: i32,
    continuation: Option<String>,
}

fn get_random_invidious_instance() -> String {
    let instances = vec![
        "https://invidious.nerdvpn.de",
        "https://invidious.jing.rocks"
    ];
    instances.choose(&mut rand::thread_rng())
        .unwrap_or(&"https://invidious.snopyta.org")
        .to_string()
}

#[get("/youtube/comments")]
async fn get_youtube_comments(query: web::Query<CommentsRequest>) -> Result<impl Responder, Box<dyn Error>> {
    let client = reqwest::Client::new();
    let video_id = &query.video_id;
    
    let invidious_url = env::var("INVIDIOUS_URL")
        .unwrap_or_else(|_| get_random_invidious_instance());

    info!("Using Invidious instance: {}", invidious_url);
    
    let response = client
        .get(format!(
            "{}/api/v1/comments/{}",
            invidious_url.trim_end_matches('/'),
            video_id
        ))
        .header("Accept", "application/json")
        .send()
        .await?;

    if !response.status().is_success() {
        error!("Failed to fetch comments: {}", response.status());
        return Ok(HttpResponse::InternalServerError().json(json!({
            "error": "Failed to fetch comments"
        })));
    }

    let comments = response.json::<CommentInfo>().await?;
    Ok(HttpResponse::Ok().json(comments))
}

#[derive(Debug, Serialize, Deserialize)]
struct YouTubeApiResponse {
    items: Vec<InvidiousVideo>,
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/search")
            .service(search_fn)
            .service(add_search_history)
            .service(delete_item_from_search_history)
            .service(get_last_searched_queries)
            .service(populate_search)
            .service(search_youtube)
            .service(get_youtube_comments)
    );
}
