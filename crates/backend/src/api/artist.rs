use actix_web::{HttpResponse, get, post, web};
use rand::seq::IteratorRandom;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::domain::Album;
pub use crate::domain::Artist;
use crate::library::normalize::{classify_release_type, is_edition_primary_type};
use crate::library::state::{LibraryCache, LibraryLifecycle, library_unavailable_response};

const MAX_COLLECTION_RESPONSE_SIZE: usize = 100;
const MAX_BATCH_LOOKUP_IDS: usize = 500;

#[derive(Clone, Serialize)]
pub struct ArtistDiscographySection {
    pub key: String,
    pub title: String,
    pub albums: Vec<Album>,
}

#[derive(Clone, Serialize)]
pub struct ResponseArtist {
    pub id: String,
    pub name: String,
    pub icon_url: String,
    pub followers: u64,
    pub albums: Vec<Album>,
    pub discography: Vec<ArtistDiscographySection>,
    pub featured_on_album_ids: Vec<String>,
    pub description: String,
}

fn response_artist(artist: Artist) -> ResponseArtist {
    let mut albums = artist.albums.clone();
    for album in albums.iter_mut() {
        if album.primary_type.is_empty() {
            album.primary_type = classify_release_type(album);
        }
    }

    ResponseArtist {
        id: artist.id,
        name: artist.name,
        icon_url: artist.icon_url,
        followers: artist.followers,
        discography: build_discography_sections(&albums),
        albums,
        featured_on_album_ids: artist.featured_on_album_ids,
        description: artist.description,
    }
}

fn build_discography_sections(albums: &[Album]) -> Vec<ArtistDiscographySection> {
    let section_order = [
        ("Album", "Albums"),
        ("Edition", "Editions"),
        ("EP", "EPs"),
        ("Single", "Singles"),
        ("Remix", "Remixes"),
        ("Compilation", "Compilations"),
        ("Live", "Live"),
        ("Demos & Rarities", "Demos & Rarities"),
        ("Bootleg", "Bootlegs & Mixtapes"),
        ("Soundtrack", "Soundtracks"),
        ("Acapella", "Acapella"),
        ("Bonus Audio", "Bonus Audio"),
    ];

    let mut sections = Vec::new();
    for (release_type, title) in section_order {
        let section_albums: Vec<Album> = albums
            .iter()
            .filter(|album| {
                if release_type == "Edition" {
                    is_edition_primary_type(&album.primary_type)
                } else {
                    album.primary_type == release_type
                }
            })
            .cloned()
            .collect();

        if !section_albums.is_empty() {
            sections.push(ArtistDiscographySection {
                key: release_type.to_ascii_lowercase().replace([' ', '-'], "_"),
                title: title.to_string(),
                albums: section_albums,
            });
        }
    }

    let other_albums: Vec<Album> = albums
        .iter()
        .filter(|album| {
            !section_order.iter().any(|(release_type, _)| {
                if *release_type == "Edition" {
                    is_edition_primary_type(&album.primary_type)
                } else {
                    album.primary_type == *release_type
                }
            })
        })
        .cloned()
        .collect();

    if !other_albums.is_empty() {
        sections.push(ArtistDiscographySection {
            key: "other".to_string(),
            title: "Other".to_string(),
            albums: other_albums,
        });
    }

    sections
}

pub fn fetch_random_artists(amount: usize, cache: &LibraryCache) -> Vec<ResponseArtist> {
    cache
        .artists
        .iter()
        .filter(|artist| !artist.albums.is_empty())
        .sample(&mut rand::rng(), amount)
        .into_iter()
        .cloned()
        .map(response_artist)
        .collect()
}

pub fn fetch_artist_response(
    artist_id: String,
    cache: &LibraryCache,
) -> Result<ResponseArtist, crate::api::LookupError> {
    cache
        .artist(&artist_id)
        .cloned()
        .map(response_artist)
        .ok_or(crate::api::LookupError)
}

#[get("/random/{amount}")]
async fn get_random_artist(
    amount: web::Path<usize>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };

    HttpResponse::Ok().json(fetch_random_artists(
        (*amount).min(MAX_COLLECTION_RESPONSE_SIZE),
        &cache,
    ))
}

#[get("/{id}")]
async fn get_artist_info(
    id: web::Path<String>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let artist_id = id.into_inner();
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };

    match fetch_artist_response(artist_id, &cache) {
        Ok(artist) => HttpResponse::Ok().json(artist),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

#[derive(Deserialize)]
pub struct BatchArtistInfoForm {
    ids: Vec<String>,
}

async fn batch_artist_info_response(
    form: web::Json<BatchArtistInfoForm>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };

    let mut artists: HashMap<String, ResponseArtist> = HashMap::new();

    for id in form
        .ids
        .iter()
        .filter(|id| !id.is_empty())
        .take(MAX_BATCH_LOOKUP_IDS)
    {
        if artists.contains_key(id) {
            continue;
        }

        if let Ok(artist) = fetch_artist_response(id.clone(), cache.as_ref()) {
            artists.insert(id.clone(), artist);
        }
    }

    HttpResponse::Ok().json(artists)
}

#[post("/batch")]
async fn get_batch_artist_info(
    form: web::Json<BatchArtistInfoForm>,
    lifecycle: web::Data<LibraryLifecycle>,
) -> HttpResponse {
    batch_artist_info_response(form, lifecycle).await
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/artists")
            .service(get_random_artist)
            .service(get_batch_artist_info)
            .service(get_artist_info),
    );
}

#[cfg(test)]
mod tests {
    use super::{build_discography_sections, response_artist};
    use crate::domain::{Album, Artist};

    fn album(id: &str, release_type: &str) -> Album {
        Album {
            id: id.into(),
            name: id.into(),
            primary_type: release_type.into(),
            ..Album::default()
        }
    }

    #[test]
    fn discography_sections_follow_product_order_and_omit_empty_groups() {
        let sections = build_discography_sections(&[
            album("single", "Single"),
            album("deluxe", "Deluxe Edition"),
            album("album", "Album"),
            album("live", "Live"),
            album("acapella", "Acapella"),
        ]);
        assert_eq!(
            sections
                .iter()
                .map(|section| section.key.as_str())
                .collect::<Vec<_>>(),
            ["album", "edition", "single", "live", "acapella"]
        );
        assert_eq!(
            sections
                .iter()
                .map(|section| section.title.as_str())
                .collect::<Vec<_>>(),
            ["Albums", "Editions", "Singles", "Live", "Acapella"]
        );
        assert_eq!(sections[1].albums[0].primary_type, "Deluxe Edition");
    }

    #[test]
    fn unknown_release_types_are_preserved_in_other() {
        let sections = build_discography_sections(&[album("spoken", "Spoken Word")]);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].key, "other");
        assert_eq!(sections[0].albums[0].id, "spoken");
    }

    #[test]
    fn artist_responses_classify_blank_release_types_without_mutating_input() {
        let artist = Artist {
            id: "artist".into(),
            albums: vec![Album {
                id: "release".into(),
                name: "Release (Deluxe Edition)".into(),
                ..Album::default()
            }],
            ..Artist::default()
        };
        let response = response_artist(artist.clone());
        assert!(!response.albums[0].primary_type.is_empty());
        assert!(artist.albums[0].primary_type.is_empty());
        assert_eq!(
            response
                .discography
                .iter()
                .map(|section| section.albums.len())
                .sum::<usize>(),
            1
        );
    }
}
