use std::env;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use actix_web::{delete, get, post, web, HttpResponse, Responder};
use chrono::NaiveDateTime;
use diesel::{ExpressionMethods, QueryDsl, RunQueryDsl};
use dirs;
use lazy_static::lazy_static;
use rand::seq::SliceRandom;
use rayon::prelude::*;
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::{self, from_str, json};
use tantivy::collector::TopDocs;
use tantivy::query::{
    BooleanQuery, FuzzyTermQuery, Occur, PhraseQuery, Query, QueryParser, RegexQuery, TermQuery,
};
use tantivy::schema::{Term, *};
use tantivy::{doc, DocAddress, Index, IndexWriter, ReloadPolicy, Searcher};
use tokio::task;
use tracing::{debug, error, info, warn};
use url::Url;

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
    let acronym: String = name
        .split_whitespace()
        .map(|word| {
            if word == "&" {
                'A'
            } else {
                word.chars()
                    .next()
                    .unwrap_or_default()
                    .to_uppercase()
                    .next()
                    .unwrap_or_default()
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

pub async fn populate_search_data(
) -> Result<Vec<CombinedItem>, Box<dyn std::error::Error + Send + Sync>> {
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
        error!(
            "Index metadata file does not exist after commit at {:?}",
            meta_path
        );
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
            HttpResponse::InternalServerError()
                .body(format!("Failed to populate search data: {:?}", e))
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
    relevance_score: f32,
}

#[get("/library")]
async fn search_fn(query: web::Query<SearchQuery>) -> HttpResponse {
    if query.q.trim().is_empty() {
        return HttpResponse::BadRequest().body("Search query cannot be empty");
    }

    let index_path: PathBuf = match TEMP_DIR_PATH.lock() {
        Ok(lock) => match &*lock {
            Some(path) => path.clone(),
            None => {
                error!("TempDir path is not set");
                return HttpResponse::InternalServerError().json(json!({
                    "error": "Search index is not available"
                }));
            }
        },
        Err(e) => {
            error!("Failed to lock TEMP_DIR_PATH: {:?}", e);
            return HttpResponse::InternalServerError().json(json!({
                "error": "Internal server error"
            }));
        }
    };

    if !index_path.exists() || !index_path.join("meta.json").exists() {
        error!("Search index does not exist at {:?}", index_path);

        info!("Attempting to rebuild search index");
        match populate_search_data().await {
            Ok(_) => info!("Successfully rebuilt search index"),
            Err(e) => {
                error!("Failed to rebuild search index: {:?}", e);
                return HttpResponse::InternalServerError().json(json!({
                    "error": "Search index is not available and could not be rebuilt"
                }));
            }
        }
    }

    let schema = build_search_schema();
    let index = match Index::open_in_dir(&index_path) {
        Ok(index) => index,
        Err(e) => {
            error!("Failed to open index: {:?}", e);
            return HttpResponse::InternalServerError().json(json!({
                "error": "Failed to access search index"
            }));
        }
    };

    let reader = match index
        .reader_builder()
        .reload_policy(ReloadPolicy::OnCommitWithDelay)
        .try_into()
    {
        Ok(reader) => reader,
        Err(e) => {
            error!("Failed to create reader: {:?}", e);
            return HttpResponse::InternalServerError().json(json!({
                "error": "Failed to access search index"
            }));
        }
    };

    let searcher = reader.searcher();
    let search_results = perform_search(&query.q, &schema, &searcher).await;

    HttpResponse::Ok().json(search_results)
}

fn build_search_schema() -> Schema {
    let mut schema_builder = Schema::builder();
    schema_builder.add_text_field("item_type", TEXT | STORED);
    schema_builder.add_text_field("name", TEXT | STORED);
    schema_builder.add_text_field("id", TEXT | STORED);
    schema_builder.add_text_field("description", TEXT | STORED);
    schema_builder.add_text_field("acronym", TEXT | STORED);
    schema_builder.build()
}

async fn perform_search(
    query_text: &str,
    schema: &Schema,
    searcher: &Searcher,
) -> Vec<ResponseCombinedItem> {
    let name_field = schema.get_field("name").unwrap();
    let description_field = schema.get_field("description").unwrap();
    let acronym_field = schema.get_field("acronym").unwrap();

    let mut query_parser = QueryParser::for_index(
        &searcher.index(),
        vec![name_field, description_field, acronym_field],
    );

    query_parser.set_field_boost(name_field, 3.0);
    query_parser.set_field_boost(acronym_field, 5.0);
    query_parser.set_field_boost(description_field, 0.5);

    let parsed_query = match query_parser.parse_query(query_text) {
        Ok(q) => q,
        Err(e) => {
            error!("Query parsing error: {:?}", e);
            Box::new(TermQuery::new(
                Term::from_field_text(name_field, query_text),
                IndexRecordOption::WithFreqsAndPositions,
            ))
        }
    };

    let mut query_clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();

    let words: Vec<&str> = query_text.split_whitespace().collect();
    if words.len() > 1 {
        let mut multi_word_fuzzy_queries: Vec<(Occur, Box<dyn Query>)> = Vec::new();

        for word in &words {
            if word.len() > 1 {
                let word_fuzzy =
                    FuzzyTermQuery::new(Term::from_field_text(name_field, word), 2, true);
                multi_word_fuzzy_queries.push((Occur::Should, Box::new(word_fuzzy)));
            }
        }

        let required_matches = std::cmp::max(1, words.len() * 2 / 3);

        let multi_word_query =
            BooleanQuery::with_minimum_required_clauses(multi_word_fuzzy_queries, required_matches);

        query_clauses.push((Occur::Should, Box::new(multi_word_query)));

        let mut phrase_terms = Vec::new();
        for word in &words {
            if word.len() <= 2 {
                phrase_terms.push(Term::from_field_text(name_field, word));
            } else {
                phrase_terms.push(Term::from_field_text(name_field, word));
            }
        }

        let phrase_query = PhraseQuery::new(phrase_terms);
        query_clauses.push((Occur::Should, Box::new(phrase_query)));
    }

    query_clauses.push((Occur::Should, Box::new(parsed_query)));

    let fuzzy_query = FuzzyTermQuery::new(Term::from_field_text(name_field, query_text), 2, true);
    query_clauses.push((Occur::Should, Box::new(fuzzy_query)));

    let description_fuzzy = FuzzyTermQuery::new(
        Term::from_field_text(description_field, query_text),
        2,
        true,
    );
    query_clauses.push((Occur::Should, Box::new(description_fuzzy)));

    let normalized_query = query_text
        .to_lowercase()
        .replace(&[',', '.', '!', '?', ':', ';', '(', ')', '[', ']'], "");
    if normalized_query != query_text {
        let normalized_fuzzy = FuzzyTermQuery::new(
            Term::from_field_text(name_field, &normalized_query),
            2,
            true,
        );
        query_clauses.push((Occur::Should, Box::new(normalized_fuzzy)));
    }

    let simplified_query = query_text
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>();
    if simplified_query.len() > 3 && simplified_query != query_text {
        let simple_fuzzy = FuzzyTermQuery::new(
            Term::from_field_text(name_field, &simplified_query),
            2,
            true,
        );
        query_clauses.push((Occur::Should, Box::new(simple_fuzzy)));
    }

    let prefix_query =
        RegexQuery::from_pattern(&format!("{}{}", regex::escape(&words[0]), ".*"), name_field)
            .unwrap();
    query_clauses.push((Occur::Should, Box::new(prefix_query)));

    if query_text.len() <= 10 {
        query_clauses.push((
            Occur::Should,
            Box::new(TermQuery::new(
                Term::from_field_text(acronym_field, &query_text.to_uppercase()),
                IndexRecordOption::WithFreqsAndPositions,
            )),
        ));

        if words.len() > 1 {
            let potential_acronym: String = words
                .iter()
                .filter_map(|word| word.chars().next())
                .map(|c| c.to_uppercase().next().unwrap_or_default())
                .collect();

            if potential_acronym.len() > 1 {
                query_clauses.push((
                    Occur::Should,
                    Box::new(TermQuery::new(
                        Term::from_field_text(acronym_field, &potential_acronym),
                        IndexRecordOption::WithFreqsAndPositions,
                    )),
                ));
            }
        }
    }

    let contains_by = query_text.to_lowercase().contains(" by ");
    if contains_by {
        let parts: Vec<&str> = query_text.splitn(2, " by ").collect();
        if parts.len() == 2 {
            let title_part = parts[0].trim();
            let artist_part = parts[1].trim();

            let title_fuzzy =
                FuzzyTermQuery::new(Term::from_field_text(name_field, title_part), 3, true);

            let artist_query = TermQuery::new(
                Term::from_field_text(schema.get_field("item_type").unwrap(), "song"),
                IndexRecordOption::Basic,
            );

            let combined_query = BooleanQuery::new(vec![
                (Occur::Must, Box::new(title_fuzzy)),
                (Occur::Must, Box::new(artist_query)),
            ]);

            query_clauses.push((Occur::Should, Box::new(combined_query)));
        }
    }

    if words.len() > 1 {
        let mut phrase_terms = Vec::new();
        for word in &words {
            phrase_terms.push(Term::from_field_text(name_field, word));
        }

        let phrase_query = PhraseQuery::new(phrase_terms);
        query_clauses.push((Occur::Should, Box::new(phrase_query)));
    }

    if words.len() == 1 && query_text.len() > 3 {
        let item_type_field = schema.get_field("item_type").unwrap();
        let song_type_query = TermQuery::new(
            Term::from_field_text(item_type_field, "song"),
            IndexRecordOption::Basic,
        );
        query_clauses.push((Occur::Should, Box::new(song_type_query)));
    }

    let bool_query = BooleanQuery::with_minimum_required_clauses(query_clauses, 1);

    let top_docs = match searcher.search(&bool_query, &TopDocs::with_limit(20)) {
        Ok(docs) => docs,
        Err(e) => {
            error!("Search failed: {:?}", e);
            return Vec::new();
        }
    };

    let schema_clone = schema.clone();
    let searcher_clone = searcher.clone();
    let hits: Vec<ResponseCombinedItem> = task::spawn_blocking(move || {
        top_docs
            .into_par_iter()
            .map(|(score, doc_address)| {
                let searcher = searcher_clone.clone();
                let schema = schema_clone.clone();
                let rt = tokio::runtime::Runtime::new().unwrap();

                rt.block_on(async move {
                    process_search_result(score, doc_address, searcher, schema).await
                })
            })
            .collect::<Vec<_>>()
    })
    .await
    .unwrap_or_default();

    hits
}

async fn process_search_result(
    score: f32,
    doc_address: DocAddress,
    searcher: Searcher,
    schema: Schema,
) -> ResponseCombinedItem {
    let item_type;
    let name;
    let id;
    let description;
    let acronym;

    let retrieved_doc = match searcher.doc(doc_address) {
        Ok(doc) => doc,
        Err(e) => {
            error!("Failed to retrieve doc: {:?}", e);
            return create_empty_result();
        }
    };

    item_type = match get_text_field(&retrieved_doc, "item_type", &schema) {
        Some(value) => value,
        None => return create_empty_result(),
    };

    name = match get_text_field(&retrieved_doc, "name", &schema) {
        Some(value) => value,
        None => return create_empty_result(),
    };

    id = match get_text_field(&retrieved_doc, "id", &schema) {
        Some(value) => value,
        None => return create_empty_result(),
    };

    description = get_text_field(&retrieved_doc, "description", &schema);

    acronym = match get_text_field(&retrieved_doc, "acronym", &schema) {
        Some(value) => value,
        None => String::new(),
    };

    let (song_object, album_object, artist_object) = match item_type.as_str() {
        "song" => {
            let song = fetch_song_info(id.clone(), None, None).await.ok();
            (song, None, None)
        }
        "album" => {
            let album = fetch_album_info(id.clone(), None).await.ok();
            (None, album, None)
        }
        "artist" => {
            let artist = fetch_artist_info(id.clone()).await.ok();
            (None, None, artist)
        }
        _ => (None, None, None),
    };

    build_response_item(
        item_type,
        name,
        id,
        description,
        acronym,
        song_object,
        album_object,
        artist_object,
        score,
    )
}

fn get_text_field(doc: &TantivyDocument, field_name: &str, schema: &Schema) -> Option<String> {
    schema
        .get_field(field_name)
        .and_then(|field| Ok(doc.get_first(field).and_then(|v| v.as_str())))
        .ok()
        .flatten()
        .map(|s| s.to_string())
}

fn create_empty_result() -> ResponseCombinedItem {
    ResponseCombinedItem {
        item_type: String::new(),
        name: String::new(),
        id: String::new(),
        description: None,
        acronym: String::new(),
        artist_object: None,
        album_object: None,
        song_object: None,
        relevance_score: 0.0,
    }
}

fn build_response_item(
    item_type: String,
    name: String,
    id: String,
    description: Option<String>,
    acronym: String,
    song_object: Option<super::song::SongInfo>,
    album_object: Option<super::album::AlbumInfo>,
    artist_object: Option<super::artist::Artist>,
    relevance_score: f32,
) -> ResponseCombinedItem {
    ResponseCombinedItem {
        item_type: item_type.clone(),
        name,
        id,
        description,
        acronym,
        artist_object: extract_artist_info(&item_type, &song_object, &album_object, &artist_object),
        album_object: extract_album_info(&item_type, &song_object, &album_object),
        song_object: extract_song_info(&song_object),
        relevance_score,
    }
}

fn extract_artist_info(
    item_type: &str,
    song_object: &Option<super::song::SongInfo>,
    album_object: &Option<super::album::AlbumInfo>,
    artist_object: &Option<super::artist::Artist>,
) -> Option<ArtistInfo> {
    match item_type {
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
    }
}

fn extract_album_info(
    item_type: &str,
    song_object: &Option<super::song::SongInfo>,
    album_object: &Option<super::album::AlbumInfo>,
) -> Option<AlbumInfo> {
    match item_type {
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
    }
}

fn extract_song_info(song_object: &Option<super::song::SongInfo>) -> Option<SongInfo> {
    song_object.as_ref().and_then(|song| match song {
        super::song::SongInfo::Full(song) => Some(SongInfo {
            id: song.id.clone(),
            name: song.name.clone(),
            duration: song.duration,
        }),
        _ => None,
    })
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
async fn add_search_history(
    item: web::Json<AddSearchHistoryRequest>,
) -> Result<impl Responder, Box<dyn Error>> {
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
async fn delete_item_from_search_history(
    item: web::Json<DeleteItemFromSearchHistoryRequest>,
) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::search_item::dsl::*;

    let mut connection = establish_connection().get().unwrap();

    diesel::delete(search_item.filter(id.eq(item.id))).execute(&mut connection)?;

    Ok(HttpResponse::Ok().body("Search history item deleted successfully"))
}

#[get("/get_last_searched_queries")]
async fn get_last_searched_queries(
    query: web::Query<GetLastSearchedQueriesRequest>,
) -> Result<impl Responder, Box<dyn Error>> {
    use crate::utils::database::schema::search_item::dsl::*;

    let mut connection = establish_connection().get().unwrap();

    let results = search_item
        .filter(user_id.eq(query.user_id))
        .order(created_at.desc())
        .limit(10)
        .load::<SearchItem>(&mut connection)?;

    let response: Vec<SearchItemResponse> = results
        .into_iter()
        .map(|item| SearchItemResponse {
            id: item.id,
            user_id: item.user_id,
            search: item.search,
            created_at: item.created_at,
        })
        .collect();

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
async fn search_youtube(
    query: web::Query<SearchRequest>,
) -> Result<impl Responder, Box<dyn Error>> {
    let client = reqwest::Client::new();
    let search_query = &query.q;

    for _ in 0..3 {
        let invidious_url =
            env::var("INVIDIOUS_URL").unwrap_or_else(|_| get_random_invidious_instance());

        let response = match client
            .get(format!(
                "{}/api/v1/search?q={}&type=video&page=1",
                invidious_url.trim_end_matches('/'),
                search_query
            ))
            .header("Accept", "application/json")
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                warn!("Failed to connect to {}: {}", invidious_url, e);
                continue;
            }
        };

        if !response.status().is_success() {
            warn!(
                "Instance {} returned status {}",
                invidious_url,
                response.status()
            );
            continue;
        }

        let response_text = match response.text().await {
            Ok(text) => text,
            Err(e) => {
                warn!("Failed to get response text from {}: {}", invidious_url, e);
                continue;
            }
        };

        match serde_json::from_str::<Vec<InvidiousVideo>>(&response_text) {
            Ok(videos) => {
                let limited_results = videos
                    .into_iter()
                    .take(10)
                    .map(|video| YouTubeVideoResponse {
                        id: video.video_id.clone(),
                        title: video.title,
                        thumbnail: format!(
                            "https://i.ytimg.com/vi/{}/mqdefault.jpg",
                            video.video_id
                        ),
                        channel: Channel { name: video.author },
                        url: format!("https://youtube.com/watch?v={}", video.video_id),
                    })
                    .collect::<Vec<_>>();

                return Ok(HttpResponse::Ok().json(limited_results));
            }
            Err(e) => {
                warn!(
                    "Failed to parse response from {}: {}\nResponse: {}",
                    invidious_url, e, response_text
                );
                continue;
            }
        }
    }

    Ok(HttpResponse::ServiceUnavailable().json(serde_json::json!({
        "error": "Failed to fetch results from any Invidious instance"
    })))
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

#[derive(Default, Debug, Serialize, Deserialize)]
struct Replies {
    #[serde(rename = "replyCount")]
    reply_count: i32,
    continuation: Option<String>,
}

fn get_random_invidious_instance() -> String {
    let instances = vec![
        "https://inv.nadeko.net",
        "https://vid.puffyan.us",
        "https://y.com.sb",
    ];

    instances
        .choose(&mut rand::thread_rng())
        .unwrap_or(&"https://inv.nadeko.net")
        .to_string()
}

#[get("/youtube/comments")]
async fn get_youtube_comments(
    query: web::Query<CommentsRequest>,
) -> Result<impl Responder, Box<dyn Error>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()?;
    let video_id = &query.video_id;

    for _ in 0..3 {
        let invidious_url =
            env::var("INVIDIOUS_URL").unwrap_or_else(|_| get_random_invidious_instance());

        info!("Trying Invidious instance: {}", invidious_url);

        let response = match client
            .get(format!(
                "{}/api/v1/comments/{}",
                invidious_url.trim_end_matches('/'),
                video_id
            ))
            .header("Accept", "application/json")
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                warn!("Failed to connect to {}: {}", invidious_url, e);
                continue;
            }
        };

        if !response.status().is_success() {
            warn!(
                "Instance {} returned status {}",
                invidious_url,
                response.status()
            );
            continue;
        }

        let response_text = match response.text().await {
            Ok(text) => {
                debug!("Response from {}: {}", invidious_url, text);
                text
            }
            Err(e) => {
                warn!("Failed to get response text from {}: {}", invidious_url, e);
                continue;
            }
        };

        match serde_json::from_str::<CommentInfo>(&response_text) {
            Ok(comments) => {
                if comments.comments.is_empty() {
                    warn!("No comments returned from {}", invidious_url);
                    continue;
                }
                return Ok(HttpResponse::Ok().json(comments));
            }
            Err(e) => {
                warn!(
                    "Failed to parse comments from {}: {}\nResponse: {}",
                    invidious_url, e, response_text
                );
                continue;
            }
        }
    }

    Ok(HttpResponse::ServiceUnavailable().json(json!({
        "error": "Failed to fetch comments from any Invidious instance"
    })))
}

#[derive(Debug, Serialize, Deserialize)]
struct YouTubeApiResponse {
    items: Vec<InvidiousVideo>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GeniusSearchResult {
    title: String,
    artist: String,
    thumbnail: String,
    url: String,
    lyrics_snippet: Option<String>,
    id: i64,
}

#[derive(Debug, Serialize, Deserialize)]
struct GeniusSearchResponse {
    results: Vec<GeniusSearchResult>,
    query: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GeniusSongResponse {
    title: String,
    artist: String,
    lyrics: String,
    url: String,
}

#[derive(Deserialize)]
struct GeniusSongRequest {
    url: String,
}

#[get("/genius")]
async fn search_genius_lyrics(
    query: web::Query<SearchRequest>,
) -> Result<impl Responder, Box<dyn Error>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;
    
    let search_query = &query.q;
    let genius_search_url = "https://genius.com/api/search/multi";
    
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"));
    
    let response = match client
        .get(genius_search_url)
        .headers(headers.clone())
        .query(&[("q", search_query), ("per_page", &String::from("5"))])
        .send()
        .await {
            Ok(resp) => resp,
            Err(e) => {
                error!("Failed to connect to Genius: {}", e);
                return Ok(HttpResponse::ServiceUnavailable().json(json!({
                    "error": "Failed to connect to Genius API"
                })));
            }
        };
        
    if !response.status().is_success() {
        error!("Genius returned status {}", response.status());
        return Ok(HttpResponse::BadGateway().json(json!({
            "error": format!("Genius API returned status {}", response.status())
        })));
    }
    
    let response_text = match response.text().await {
        Ok(text) => text,
        Err(e) => {
            error!("Failed to get response text from Genius: {}", e);
            return Ok(HttpResponse::InternalServerError().json(json!({
                "error": "Failed to read response from Genius API"
            })));
        }
    };
    
    let parsed: serde_json::Value = match serde_json::from_str(&response_text) {
        Ok(val) => val,
        Err(e) => {
            error!("Failed to parse Genius response: {}", e);
            return Ok(HttpResponse::InternalServerError().json(json!({
                "error": "Failed to parse Genius API response"
            })));
        }
    };
    
    let sections = parsed["response"]["sections"].as_array();
    let mut results = Vec::new();
    
    if let Some(sections) = sections {
        for section in sections {
            if section["type"] == "lyric" {
                if let Some(hits) = section["hits"].as_array() {
                    for hit in hits {
                        if let Some(result) = hit["result"].as_object() {
                            let id = result.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                            let title = result.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let artist = result.get("artist_names").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            
                            let thumbnail = result
                                .get("song_art_image_thumbnail_url")
                                .and_then(|v| v.as_str())
                                .or_else(|| result.get("header_image_thumbnail_url").and_then(|v| v.as_str()))
                                .unwrap_or("").to_string();
                                
                            let url = result.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            
                            let mut lyrics_snippet = None;
                            if let Some(highlights) = hit["highlights"].as_array() {
                                for highlight in highlights {
                                    if highlight["property"] == "lyrics" {
                                        lyrics_snippet = highlight["value"].as_str().map(|s| s.to_string());
                                        break;
                                    }
                                }
                            }
                            
                            results.push(GeniusSearchResult {
                                id,
                                title,
                                artist,
                                thumbnail,
                                url,
                                lyrics_snippet,
                            });
                        }
                    }
                }
                break;
            }
        }
    }
    
    Ok(HttpResponse::Ok().json(GeniusSearchResponse {
        results,
        query: search_query.clone(),
    }))
}

#[get("/genius/lyrics")]
async fn get_genius_lyrics(
    query: web::Query<GeniusSongRequest>,
) -> Result<impl Responder, Box<dyn Error>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;
        
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"));
    
    let url = match Url::parse(&query.url) {
        Ok(url) => {
            if url.host_str() == Some("genius.com") {
                url
            } else {
                return Ok(HttpResponse::BadRequest().json(json!({
                    "error": "Only Genius URLs are allowed"
                })));
            }
        },
        Err(_) => {
            return Ok(HttpResponse::BadRequest().json(json!({
                "error": "Invalid URL format"
            })));
        }
    };
    
    let response = match client
        .get(url.as_str())
        .headers(headers)
        .send()
        .await {
            Ok(resp) => resp,
            Err(e) => {
                error!("Failed to fetch lyrics from Genius: {}", e);
                return Ok(HttpResponse::ServiceUnavailable().json(json!({
                    "error": "Failed to fetch lyrics from Genius"
                })));
            }
        };
        
    if !response.status().is_success() {
        error!("Genius returned status {} for lyrics", response.status());
        return Ok(HttpResponse::BadGateway().json(json!({
            "error": format!("Genius returned status {}", response.status())
        })));
    }
    
    let html_content = match response.text().await {
        Ok(text) => text,
        Err(e) => {
            error!("Failed to get HTML content from Genius: {}", e);
            return Ok(HttpResponse::InternalServerError().json(json!({
                "error": "Failed to read HTML content"
            })));
        }
    };
    
    let document = Html::parse_document(&html_content);
    
    let title_selector = match Selector::parse("h1[data-lyrics-container='true']") {
        Ok(selector) => selector,
        Err(_) => {
            return Ok(HttpResponse::InternalServerError().json(json!({
                "error": "Failed to create title selector"
            })));
        }
    };
    
    let title = document.select(&title_selector)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .unwrap_or_else(|| {
            match Selector::parse("h1.SongHeader__Title-sc-1b7aqpg-0") {
                Ok(alt_selector) => document.select(&alt_selector)
                    .next()
                    .map(|el| el.text().collect::<String>().trim().to_string())
                    .unwrap_or_default(),
                Err(_) => String::new()
            }
        });
    
    let artist_selector = match Selector::parse("a.SongHeader__Artist-sc-1b7aqpg-2") {
        Ok(selector) => selector,
        Err(_) => {
            return Ok(HttpResponse::InternalServerError().json(json!({
                "error": "Failed to create artist selector"
            })));
        }
    };
    
    let artist = document.select(&artist_selector)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .unwrap_or_default();
    
    let lyrics_selector = match Selector::parse("div[data-lyrics-container='true']") {
        Ok(selector) => selector,
        Err(_) => {
            return Ok(HttpResponse::InternalServerError().json(json!({
                "error": "Failed to create lyrics selector"
            })));
        }
    };
    
    let mut lyrics = String::new();
    for element in document.select(&lyrics_selector) {
        let html = element.inner_html();
        lyrics.push_str(&html);
        lyrics.push_str("\n");
    }
    
    if lyrics.trim().is_empty() {
        return Ok(HttpResponse::NotFound().json(json!({
            "error": "No lyrics found on this page"
        })));
    }
    
    Ok(HttpResponse::Ok().json(GeniusSongResponse {
        title,
        artist,
        lyrics,
        url: query.url.clone(),
    }))
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
            .service(search_genius_lyrics)
            .service(get_genius_lyrics),
    );
}
