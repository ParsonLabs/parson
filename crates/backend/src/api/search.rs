use std::collections::{HashMap, HashSet};

use actix_web::{HttpRequest, HttpResponse, get, web};
use serde::{Deserialize, Serialize};

use crate::api::auth::authenticated_user_id;
use crate::api::error::bad_request;
use crate::api::lyrics::{LyricsSearchHit, LyricsService};
use crate::domain::Artist;
use crate::library::search::{SearchHit, acronym as search_acronym, normalize, sort_hits};
use crate::library::state::{LibraryLifecycle, library_unavailable_response};
use crate::persistence::connection::DbPool;
use crate::recommendation::RankedCandidate;

const MAX_RESULTS: usize = 50;
const MAX_RERANK_CANDIDATES: usize = MAX_RESULTS * 4;
const MAX_RECOMMENDATIONS: usize = 100;
const MAX_RECOMMENDATION_BOOST: f32 = 12.0;
const MAX_QUERY_CHARACTERS: usize = 256;

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
}

fn normalize_query(value: &str) -> Result<String, &'static str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err("empty")
    } else if trimmed.chars().count() > MAX_QUERY_CHARACTERS {
        Err("too_long")
    } else {
        let query = normalize(trimmed);
        if query.is_empty() {
            Err("empty")
        } else {
            Ok(query)
        }
    }
}

#[derive(Serialize)]
struct SearchResult {
    item_type: &'static str,
    name: String,
    id: String,
    description: Option<String>,
    acronym: String,
    artist_object: Option<ArtistSummary>,
    album_object: Option<AlbumSummary>,
    song_object: Option<SongSummary>,
    relevance_score: f32,
}

#[derive(Clone, Serialize)]
struct ArtistSummary {
    id: String,
    name: String,
    icon_url: String,
    followers: u64,
    description: String,
}

#[derive(Clone, Serialize)]
struct AlbumSummary {
    id: String,
    name: String,
    cover_url: String,
    first_release_date: String,
    description: String,
}

#[derive(Serialize)]
struct SongSummary {
    id: String,
    name: String,
    duration: f64,
}

fn artist_summary(artist: &Artist) -> ArtistSummary {
    ArtistSummary {
        id: artist.id.clone(),
        name: artist.name.clone(),
        icon_url: artist.icon_url.clone(),
        followers: artist.followers,
        description: artist.description.clone(),
    }
}

fn response_acronym(name: &str) -> String {
    search_acronym(name).to_uppercase()
}

fn apply_recommendation_boosts(hits: &mut [SearchHit], recommendations: &[RankedCandidate]) {
    if recommendations.is_empty() {
        return;
    }
    let count = recommendations.len() as f32;
    let mut boosts = HashMap::<&str, f32>::new();
    for (rank, candidate) in recommendations.iter().enumerate() {
        let rank_weight = 1.0 - rank as f32 / count;
        let boost = MAX_RECOMMENDATION_BOOST * rank_weight;
        boosts
            .entry(candidate.song_id.as_str())
            .and_modify(|existing| *existing = existing.max(boost))
            .or_insert(boost);
    }
    for hit in hits.iter_mut().filter(|hit| hit.entity_type == "song") {
        hit.score += boosts.get(hit.entity_id.as_str()).copied().unwrap_or(0.0);
    }
    sort_hits(hits);
}

fn deduplicate_results(results: &mut Vec<SearchResult>) {
    let mut seen = HashSet::new();
    results.retain(|result| {
        let artist = result
            .artist_object
            .as_ref()
            .map(|artist| normalize(&artist.name))
            .unwrap_or_default();
        seen.insert((result.item_type, normalize(&result.name), artist))
    });
}

fn merge_lyrics_hits(
    hits: &mut Vec<SearchHit>,
    lyric_hits: Vec<LyricsSearchHit>,
) -> HashMap<String, String> {
    let mut snippets = HashMap::new();
    for lyric in lyric_hits {
        if let Some(existing) = hits
            .iter_mut()
            .find(|hit| hit.entity_type == "song" && hit.entity_id == lyric.song_id)
        {
            if lyric.score > existing.score {
                existing.score = lyric.score;
                existing.match_reason = if lyric.exact_phrase {
                    "lyrics_phrase"
                } else {
                    "lyrics_terms"
                };
                snippets.insert(lyric.song_id, lyric.snippet);
            }
            continue;
        }
        snippets.insert(lyric.song_id.clone(), lyric.snippet);
        hits.push(SearchHit {
            entity_type: "song".into(),
            entity_id: lyric.song_id,
            score: lyric.score,
            match_reason: if lyric.exact_phrase {
                "lyrics_phrase"
            } else {
                "lyrics_terms"
            },
        });
    }
    sort_hits(hits);
    snippets
}

#[get("")]
async fn search(
    query: web::Query<SearchQuery>,
    lifecycle: web::Data<LibraryLifecycle>,
    pool: web::Data<DbPool>,
    lyrics: web::Data<LyricsService>,
    request: HttpRequest,
) -> HttpResponse {
    let query = match normalize_query(&query.q) {
        Ok(query) => query,
        Err("empty") => return bad_request("Search query cannot be empty.", "search_query_empty"),
        Err(_) => return bad_request("Search query is too long.", "search_query_too_long"),
    };

    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let mut hits = match cache.search_index.search(&query, MAX_RERANK_CANDIDATES) {
        Ok(hits) => hits,
        Err(error) => {
            tracing::error!(%error, "library search failed");
            return HttpResponse::InternalServerError().finish();
        }
    };
    let lyric_snippets = match lyrics.search(&query).await {
        Ok(lyric_hits) => merge_lyrics_hits(&mut hits, lyric_hits),
        Err(error) => {
            tracing::warn!(%error, "stored lyrics search unavailable");
            HashMap::new()
        }
    };
    if let Ok(user_id) = authenticated_user_id(&request) {
        let recommendation_cache = cache.clone();
        let recommendation_pool = pool.get_ref().clone();
        match tokio::task::spawn_blocking(move || {
            crate::recommendation::recommend(
                user_id,
                None,
                recommendation_cache.as_ref(),
                &recommendation_pool,
                MAX_RECOMMENDATIONS,
            )
            .map_err(|error| error.to_string())
        })
        .await
        {
            Ok(Ok(recommendations)) => apply_recommendation_boosts(&mut hits, &recommendations),
            Ok(Err(error)) => tracing::warn!(%error, "search personalization unavailable"),
            Err(error) => tracing::warn!(%error, "search personalization task failed"),
        }
    }
    let mut results = hits
        .into_iter()
        .filter_map(|hit| match hit.entity_type.as_str() {
            "artist" => {
                let artist = cache.artist(&hit.entity_id)?;
                Some(SearchResult {
                    item_type: "artist",
                    name: artist.name.clone(),
                    id: artist.id.clone(),
                    description: Some(artist.description.clone()),
                    acronym: response_acronym(&artist.name),
                    artist_object: Some(artist_summary(artist)),
                    album_object: None,
                    song_object: None,
                    relevance_score: hit.score,
                })
            }
            "album" => {
                let album = cache.album(&hit.entity_id)?;
                let artist = cache.album_owner(&hit.entity_id)?;
                Some(SearchResult {
                    item_type: "album",
                    name: album.name.clone(),
                    id: album.id.clone(),
                    description: Some(album.description.clone()),
                    acronym: response_acronym(&album.name),
                    artist_object: Some(artist_summary(artist)),
                    album_object: Some(AlbumSummary {
                        id: album.id.clone(),
                        name: album.name.clone(),
                        cover_url: album.cover_url.clone(),
                        first_release_date: album.first_release_date.clone(),
                        description: album.description.clone(),
                    }),
                    song_object: None,
                    relevance_score: hit.score,
                })
            }
            "song" => {
                let song = cache.song(&hit.entity_id)?;
                let (artist_id, album_id) = cache.song_map.get(&hit.entity_id)?;
                let artist = cache.artist(artist_id)?;
                let album = cache.album(album_id)?;
                Some(SearchResult {
                    item_type: "song",
                    name: song.name.clone(),
                    id: song.id.clone(),
                    description: lyric_snippets
                        .get(&hit.entity_id)
                        .map(|snippet| format!("Lyrics: {snippet}")),
                    acronym: response_acronym(&song.name),
                    artist_object: Some(artist_summary(artist)),
                    album_object: Some(AlbumSummary {
                        id: album.id.clone(),
                        name: album.name.clone(),
                        cover_url: album.cover_url.clone(),
                        first_release_date: album.first_release_date.clone(),
                        description: album.description.clone(),
                    }),
                    song_object: Some(SongSummary {
                        id: song.id.clone(),
                        name: song.name.clone(),
                        duration: song.duration,
                    }),
                    relevance_score: hit.score,
                })
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    deduplicate_results(&mut results);
    results.truncate(MAX_RESULTS);
    HttpResponse::Ok().json(results)
}

pub fn configure(config: &mut web::ServiceConfig) {
    config.service(web::scope("/search").service(search));
}

#[cfg(test)]
mod tests {
    use super::{
        ArtistSummary, MAX_QUERY_CHARACTERS, SearchResult, apply_recommendation_boosts,
        deduplicate_results, merge_lyrics_hits, normalize_query, response_acronym,
    };
    use crate::api::lyrics::LyricsSearchHit;
    use crate::library::search::SearchHit;
    use crate::recommendation::RankedCandidate;

    #[test]
    fn search_queries_are_trimmed_and_bounded_by_characters() {
        assert_eq!(
            normalize_query("  Signal Harbor  ").as_deref(),
            Ok("signal harbor")
        );
        assert_eq!(
            normalize_query("  N\u{f3}ra Reed  ").as_deref(),
            Ok("nora reed")
        );
        assert!(normalize_query("   ").is_err());
        assert!(normalize_query(" / (---) ").is_err());
        assert!(normalize_query(&"é".repeat(MAX_QUERY_CHARACTERS)).is_ok());
        assert!(normalize_query(&"é".repeat(MAX_QUERY_CHARACTERS + 1)).is_err());
    }

    #[test]
    fn response_acronyms_use_the_same_rules_as_search_ranking() {
        assert_eq!(response_acronym("Drift Home Through Waves"), "DHTW");
        assert_eq!(response_acronym("R&D"), "RD");
        assert_eq!(response_acronym("Solo"), "");
    }

    #[test]
    fn recommendations_break_close_ties_without_overpowering_relevance() {
        let mut hits = vec![
            SearchHit {
                entity_type: "song".into(),
                entity_id: "exact".into(),
                score: 1001.0,
                match_reason: "exact_title",
            },
            SearchHit {
                entity_type: "song".into(),
                entity_id: "recommended-generic".into(),
                score: 501.0,
                match_reason: "all_terms",
            },
            SearchHit {
                entity_type: "song".into(),
                entity_id: "ordinary-tie".into(),
                score: 501.0,
                match_reason: "all_terms",
            },
        ];
        let recommendations = vec![RankedCandidate {
            song_id: "recommended-generic".into(),
            score: 10_000.0,
            reason: "test".into(),
        }];

        apply_recommendation_boosts(&mut hits, &recommendations);

        assert_eq!(hits[0].entity_id, "exact");
        assert_eq!(hits[1].entity_id, "recommended-generic");
        assert!(hits[1].score - 501.0 <= super::MAX_RECOMMENDATION_BOOST);
    }

    #[test]
    fn duplicate_recommendations_keep_the_strongest_bounded_boost() {
        let mut hits = vec![
            SearchHit {
                entity_type: "song".into(),
                entity_id: "song".into(),
                score: 500.0,
                match_reason: "all_terms",
            },
            SearchHit {
                entity_type: "album".into(),
                entity_id: "album".into(),
                score: 500.0,
                match_reason: "all_terms",
            },
        ];
        let recommendation = |id: &str| RankedCandidate {
            song_id: id.into(),
            score: 1.0,
            reason: "test".into(),
        };

        apply_recommendation_boosts(
            &mut hits,
            &[
                recommendation("song"),
                recommendation("other"),
                recommendation("song"),
                recommendation("album"),
            ],
        );

        let song = hits.iter().find(|hit| hit.entity_id == "song").unwrap();
        let album = hits.iter().find(|hit| hit.entity_id == "album").unwrap();
        assert_eq!(song.score, 500.0 + super::MAX_RECOMMENDATION_BOOST);
        assert_eq!(album.score, 500.0);
    }

    #[test]
    fn metadata_matches_stay_above_lyrics_except_for_weak_typo_matches() {
        let mut hits = vec![
            SearchHit {
                entity_type: "album".into(),
                entity_id: "album-title".into(),
                score: 1002.0,
                match_reason: "exact_title",
            },
            SearchHit {
                entity_type: "song".into(),
                entity_id: "song-title".into(),
                score: 1001.0,
                match_reason: "exact_title",
            },
            SearchHit {
                entity_type: "song".into(),
                entity_id: "weak-typo".into(),
                score: 251.0,
                match_reason: "typo",
            },
        ];
        let snippets = merge_lyrics_hits(
            &mut hits,
            vec![
                LyricsSearchHit {
                    song_id: "strong-lyric".into(),
                    score: 334.0,
                    snippet: "an exact remembered line".into(),
                    exact_phrase: true,
                },
                LyricsSearchHit {
                    song_id: "weak-lyric".into(),
                    score: 189.0,
                    snippet: "separated matching words".into(),
                    exact_phrase: false,
                },
                LyricsSearchHit {
                    song_id: "song-title".into(),
                    score: 340.0,
                    snippet: "also happens to be in the lyrics".into(),
                    exact_phrase: true,
                },
            ],
        );

        assert_eq!(
            hits.iter()
                .map(|hit| hit.entity_id.as_str())
                .collect::<Vec<_>>(),
            [
                "album-title",
                "song-title",
                "strong-lyric",
                "weak-typo",
                "weak-lyric",
            ]
        );
        assert!(!snippets.contains_key("song-title"));
        assert_eq!(snippets["strong-lyric"], "an exact remembered line");
    }

    #[test]
    fn equivalent_display_results_are_returned_once() {
        let result = |id: &str, name: &str| SearchResult {
            item_type: "song",
            name: name.into(),
            id: id.into(),
            description: None,
            acronym: String::new(),
            artist_object: Some(ArtistSummary {
                id: "artist-avery-lane".into(),
                name: "Avery Lane".into(),
                icon_url: String::new(),
                followers: 0,
                description: String::new(),
            }),
            album_object: None,
            song_object: None,
            relevance_score: 500.0,
        };
        let mut results = vec![
            result("first-copy", "Don't Worry"),
            result("second-copy", "Dont Worry"),
        ];

        deduplicate_results(&mut results);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "first-copy");
    }
}
