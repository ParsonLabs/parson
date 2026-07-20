use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};
use std::convert::Infallible;
use std::num::TryFromIntError;
use std::ops::Bound::{Included, Unbounded};

use serde::{Deserialize, Serialize};
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

use crate::domain::Artist;
use crate::library::normalize::is_edition_primary_type;

// Keep prefix scans wider than the candidate cap.
const MAX_PREFIX_TERMS: usize = 4_096;
const MAX_FUZZY_TERMS: usize = 256;
const MAX_CANDIDATES: usize = 1_500;

/// Compact in-memory metadata search index.
#[derive(Serialize, Deserialize)]
pub struct SearchIndex {
    documents: Vec<SearchDocument>,
    postings: BTreeMap<Box<str>, Vec<u32>>,
    reverse_postings: BTreeMap<Box<str>, Vec<u32>>,
}

#[derive(Clone, Serialize, Deserialize)]
struct SearchDocument {
    entity_type: SearchEntityType,
    entity_id: Box<str>,
    title: Box<str>,
    artist: Box<str>,
    album: Box<str>,
    acronym: Box<str>,
    compact_title: Box<str>,
    compact_title_without_article: Option<Box<str>>,
    release_boost: f32,
}

#[derive(Clone, Copy, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
enum SearchEntityType {
    Artist,
    Album,
    Song,
}

impl SearchEntityType {
    fn from_name(value: &str) -> Self {
        match value {
            "artist" => Self::Artist,
            "album" => Self::Album,
            "song" => Self::Song,
            _ => unreachable!("search documents use a closed entity type set"),
        }
    }

    const fn as_str(self) -> &'static str {
        match self {
            Self::Artist => "artist",
            Self::Album => "album",
            Self::Song => "song",
        }
    }
}

#[derive(Debug, PartialEq)]
pub struct SearchHit {
    pub entity_type: String,
    pub entity_id: String,
    pub score: f32,
    pub match_reason: &'static str,
}

impl SearchIndex {
    pub fn build(artists: &[Artist]) -> Result<Self, TryFromIntError> {
        let estimated = artists.len()
            + artists
                .iter()
                .map(|artist| artist.albums.len())
                .sum::<usize>()
            + artists
                .iter()
                .flat_map(|artist| &artist.albums)
                .map(|album| album.songs.len())
                .sum::<usize>();
        let mut documents = Vec::with_capacity(estimated);
        let mut indexed_entities = BTreeMap::new();

        for artist in artists {
            let canonical_album_titles = artist
                .albums
                .iter()
                .filter(|album| is_edition_primary_type(&album.primary_type))
                .map(|album| normalize(&album.name))
                .collect::<BTreeSet<_>>();
            upsert_document(
                &mut documents,
                &mut indexed_entities,
                SearchDocument::new("artist", &artist.id, &artist.name, "", "", 0.0),
            );
            for album in &artist.albums {
                let release_boost = release_context_boost(
                    &album.primary_type,
                    canonical_album_titles.contains(&normalize(&album.name)),
                );
                upsert_document(
                    &mut documents,
                    &mut indexed_entities,
                    SearchDocument::new(
                        "album",
                        &album.id,
                        &album.name,
                        &artist.name,
                        "",
                        release_boost,
                    ),
                );
                for song in &album.songs {
                    upsert_document(
                        &mut documents,
                        &mut indexed_entities,
                        SearchDocument::new(
                            "song",
                            &song.id,
                            &song.name,
                            &song.artist,
                            &album.name,
                            release_boost,
                        ),
                    );
                }
            }
        }

        let mut postings = BTreeMap::<Box<str>, Vec<u32>>::new();
        for (document_id, document) in documents.iter().enumerate() {
            let document_id = u32::try_from(document_id)?;
            let unique_tokens = document
                .title
                .split_whitespace()
                .chain(document.artist.split_whitespace())
                .chain(document.album.split_whitespace())
                .chain(std::iter::once(document.acronym.as_ref()))
                .chain(std::iter::once(document.compact_title.as_ref()))
                .chain(document.compact_title_without_article.as_deref())
                .filter(|token| !token.is_empty())
                .collect::<BTreeSet<_>>();
            for token in unique_tokens {
                postings.entry(token.into()).or_default().push(document_id);
            }
        }
        let reverse_postings = postings
            .iter()
            .filter(|(token, _)| token.len() >= 4 && token.chars().all(char::is_alphabetic))
            .map(|(token, ids)| {
                (
                    token.chars().rev().collect::<String>().into_boxed_str(),
                    ids.iter().take(MAX_CANDIDATES).copied().collect(),
                )
            })
            .collect();

        Ok(Self {
            documents,
            postings,
            reverse_postings,
        })
    }

    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>, Infallible> {
        let normalized = normalize(query);
        let mut query_tokens = normalized.split_whitespace().collect::<Vec<_>>();
        if query_tokens.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        // Treat "and" as "&" only in multi-word token matching.
        if query_tokens.len() > 1 && query_tokens.iter().any(|token| *token != "and") {
            query_tokens.retain(|token| *token != "and");
        }

        let mut retrieval_tokens = query_tokens.clone();
        retrieval_tokens
            .sort_by_key(|token| self.postings.get(*token).map_or(usize::MAX, Vec::len));
        let mut candidates: Option<BTreeSet<u32>> = None;
        for token in retrieval_tokens {
            if let Some(existing) = candidates.as_mut() {
                existing.retain(|id| {
                    self.documents
                        .get(*id as usize)
                        .is_some_and(|document| document_matches_token(document, token))
                });
                if existing.is_empty() {
                    break;
                }
                continue;
            }
            let mut term_candidates = BTreeSet::new();
            self.add_exact_and_prefix_candidates(token, &mut term_candidates);
            // An unrelated exact prefix must not hide typo candidates.
            self.add_fuzzy_candidates(token, &mut term_candidates);
            candidates = Some(term_candidates);
            if candidates.as_ref().is_some_and(BTreeSet::is_empty) {
                break;
            }
        }
        let candidates = candidates.unwrap_or_default();

        let mut ranked = candidates
            .into_iter()
            .filter_map(|id| {
                let document = self.documents.get(id as usize)?;
                score(document, &normalized, &query_tokens).map(|(score, reason)| SearchHit {
                    entity_type: document.entity_type.as_str().to_string(),
                    entity_id: document.entity_id.to_string(),
                    score,
                    match_reason: reason,
                })
            })
            .collect::<Vec<_>>();

        sort_hits(&mut ranked);
        ranked.truncate(limit);
        Ok(ranked)
    }

    fn add_exact_and_prefix_candidates(&self, token: &str, candidates: &mut BTreeSet<u32>) {
        if let Some(ids) = self.postings.get(token) {
            extend_bounded(candidates, ids);
        }
        if candidates.len() >= MAX_CANDIDATES {
            return;
        }
        for (_, ids) in self
            .postings
            .range::<str, _>((Included(token), Unbounded))
            .take_while(|(term, _)| term.starts_with(token))
            .take(MAX_PREFIX_TERMS)
        {
            extend_bounded(candidates, ids);
            if candidates.len() >= MAX_CANDIDATES {
                break;
            }
        }
    }

    fn add_fuzzy_candidates(&self, token: &str, candidates: &mut BTreeSet<u32>) {
        if token.chars().count() < 4 {
            return;
        }
        let first = token.chars().next().unwrap_or_default().to_string();
        for (term, ids) in self
            .postings
            .range::<str, _>((Included(first.as_str()), Unbounded))
            .take_while(|(term, _)| term.starts_with(&first))
            .take(MAX_FUZZY_TERMS)
        {
            if edit_distance_at_most_one(token, term) {
                extend_bounded(candidates, ids);
            }
        }
        if candidates.len() >= MAX_CANDIDATES {
            return;
        }
        let reversed = token.chars().rev().collect::<String>();
        let reverse_first = reversed.chars().next().unwrap_or_default().to_string();
        for (term, ids) in self
            .reverse_postings
            .range::<str, _>((Included(reverse_first.as_str()), Unbounded))
            .take_while(|(term, _)| term.starts_with(&reverse_first))
            .take(MAX_FUZZY_TERMS)
        {
            if edit_distance_at_most_one(&reversed, term) {
                extend_bounded(candidates, ids);
            }
        }
    }
}

fn upsert_document(
    documents: &mut Vec<SearchDocument>,
    indexed_entities: &mut BTreeMap<(SearchEntityType, String), usize>,
    document: SearchDocument,
) {
    let key = (document.entity_type, document.entity_id.to_string());
    if let Some(index) = indexed_entities.get(&key) {
        // Select the best release occurrence for duplicate song IDs.
        if document.release_boost >= documents[*index].release_boost {
            documents[*index] = document;
        }
    } else {
        indexed_entities.insert(key, documents.len());
        documents.push(document);
    }
}

impl SearchDocument {
    fn new(
        entity_type: &'static str,
        entity_id: &str,
        title: &str,
        artist: &str,
        album: &str,
        release_boost: f32,
    ) -> Self {
        let normalized_title = normalize(title);
        let compact_title = compact(&normalized_title);
        let articleless = compact(title_without_leading_article(&normalized_title));
        let compact_title_without_article =
            (articleless != compact_title).then(|| articleless.into_boxed_str());
        Self {
            entity_type: SearchEntityType::from_name(entity_type),
            entity_id: entity_id.into(),
            title: normalized_title.into(),
            artist: normalize(artist).into(),
            album: normalize(album).into(),
            acronym: acronym(title).into(),
            compact_title: compact_title.into(),
            compact_title_without_article,
            release_boost,
        }
    }
}

pub(crate) fn normalize(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut previous_space = true;
    for character in value
        .nfkd()
        .filter(|character| !is_combining_mark(*character))
    {
        // Preserve apostrophes inside contractions.
        if matches!(character, '\'' | '’' | '‘' | 'ʼ') {
            continue;
        }
        for lower in character.to_lowercase() {
            let ascii_fold = match lower {
                'æ' => Some("ae"),
                'œ' => Some("oe"),
                'ß' => Some("ss"),
                'ø' => Some("o"),
                'ð' => Some("d"),
                'þ' => Some("th"),
                'ł' => Some("l"),
                _ => None,
            };
            if let Some(replacement) = ascii_fold {
                normalized.push_str(replacement);
                previous_space = false;
            } else if lower.is_alphanumeric() {
                normalized.push(lower);
                previous_space = false;
            } else if !previous_space {
                normalized.push(' ');
                previous_space = true;
            }
        }
    }
    normalized.trim().to_string()
}

fn compact(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn score(
    document: &SearchDocument,
    query: &str,
    query_tokens: &[&str],
) -> Option<(f32, &'static str)> {
    let context_boost = type_boost(document.entity_type.as_str()) + document.release_boost;
    if document.title.as_ref() == query {
        return Some((1000.0 + context_boost, "exact_title"));
    }
    if document.acronym.as_ref() == query {
        return Some((900.0 + context_boost, "acronym"));
    }
    if query.chars().count() >= 2 && !query.contains(' ') && document.acronym.starts_with(query) {
        let coverage = query.chars().count() as f32 / document.acronym.chars().count() as f32;
        return Some((850.0 + coverage * 25.0 + context_boost, "acronym_prefix"));
    }

    let searchable_title = title_without_leading_article(&document.title);
    if searchable_title == query {
        return Some((950.0 + context_boost, "exact_title"));
    }
    if !query.contains(' ')
        && (document.compact_title.as_ref() == query
            || document.compact_title_without_article.as_deref() == Some(query))
    {
        return Some((925.0 + context_boost, "compact_title"));
    }
    if document.title.starts_with(query) || searchable_title.starts_with(query) {
        let title_terms = searchable_title.split_whitespace().count().max(1) as f32;
        let coverage = query_tokens.len() as f32 / title_terms;
        return Some((
            800.0 + coverage.min(1.0) * 25.0 + context_boost,
            "title_prefix",
        ));
    }
    if !query.contains(' ')
        && query.chars().count() >= 3
        && (document.compact_title.starts_with(query)
            || document
                .compact_title_without_article
                .as_deref()
                .is_some_and(|title| title.starts_with(query)))
    {
        let coverage = query.chars().count() as f32
            / document
                .compact_title_without_article
                .as_deref()
                .unwrap_or(&document.compact_title)
                .chars()
                .count()
                .max(1) as f32;
        return Some((
            775.0 + coverage.min(1.0) * 25.0 + context_boost,
            "compact_title_prefix",
        ));
    }
    if contains_phrase(&document.title, query) {
        return Some((700.0 + context_boost, "title_phrase"));
    }

    let all_tokens = || {
        document
            .title
            .split_whitespace()
            .chain(document.artist.split_whitespace())
            .chain(document.album.split_whitespace())
            .chain(std::iter::once(document.acronym.as_ref()))
            .chain(std::iter::once(document.compact_title.as_ref()))
            .chain(document.compact_title_without_article.as_deref())
    };
    let document_tokens = all_tokens().collect::<Vec<_>>();
    let token_prefix_matches =
        |query: &str, token: &str| token == query || token.starts_with(query);
    let has_repeated_terms = query_tokens
        .iter()
        .enumerate()
        .any(|(index, token)| query_tokens[..index].contains(token));
    let every_term_matches = if has_repeated_terms {
        // Repeated terms must match repeated occurrences.
        [&document.title, &document.artist, &document.album]
            .into_iter()
            .any(|field| {
                terms_match_distinct(
                    query_tokens,
                    &field.split_whitespace().collect::<Vec<_>>(),
                    token_prefix_matches,
                )
            })
    } else {
        terms_match_distinct(query_tokens, &document_tokens, token_prefix_matches)
    };
    if every_term_matches {
        let title_tokens = document.title.split_whitespace().collect::<Vec<_>>();
        let title_matches = distinct_match_count(query_tokens, &title_tokens, |query, token| {
            token == query || token.starts_with(query)
        }) as f32;
        let context_phrase = document.artist.contains(query) || document.album.contains(query);
        // Prefer an exact title plus context over longer title variants.
        let canonical_title_with_context = exact_title_with_context(document, query_tokens);
        return Some((
            500.0
                + title_matches * 40.0
                + if context_phrase { 20.0 } else { 0.0 }
                + if canonical_title_with_context {
                    140.0
                } else {
                    0.0
                }
                + context_boost,
            "all_terms",
        ));
    }

    let fuzzy_matches = |query: &str, token: &str| {
        token == query
            || token.starts_with(query)
            || (query.chars().count() >= 4 && edit_distance_at_most_one(query, token))
    };
    let fuzzy_terms_match = if has_repeated_terms {
        [&document.title, &document.artist, &document.album]
            .into_iter()
            .any(|field| {
                terms_match_distinct(
                    query_tokens,
                    &field.split_whitespace().collect::<Vec<_>>(),
                    fuzzy_matches,
                )
            })
    } else {
        terms_match_distinct(query_tokens, &document_tokens, fuzzy_matches)
    };
    if fuzzy_terms_match {
        return Some((250.0 + context_boost, "typo"));
    }
    None
}

fn exact_title_with_context(document: &SearchDocument, query_tokens: &[&str]) -> bool {
    let title_tokens = title_without_leading_article(&document.title)
        .split_whitespace()
        .collect::<Vec<_>>();
    if title_tokens.is_empty() || title_tokens.len() >= query_tokens.len() {
        return false;
    }

    let title_is_covered =
        terms_match_distinct(&title_tokens, query_tokens, |title, query| title == query);
    let title_has_no_extra_terms =
        terms_match_distinct(query_tokens, &title_tokens, |query, title| {
            query == title
                || document
                    .artist
                    .split_whitespace()
                    .any(|artist| artist == query)
        });

    title_is_covered && title_has_no_extra_terms
}

fn title_without_leading_article(title: &str) -> &str {
    let Some((first, rest)) = title.split_once(' ') else {
        return title;
    };
    if matches!(first, "a" | "an" | "the") {
        rest
    } else {
        title
    }
}

fn contains_phrase(value: &str, phrase: &str) -> bool {
    value == phrase
        || value.starts_with(&format!("{phrase} "))
        || value.ends_with(&format!(" {phrase}"))
        || value.contains(&format!(" {phrase} "))
}

fn terms_match_distinct<F>(query_tokens: &[&str], document_tokens: &[&str], matches: F) -> bool
where
    F: Fn(&str, &str) -> bool,
{
    distinct_match_count(query_tokens, document_tokens, matches) == query_tokens.len()
}

fn distinct_match_count<F>(query_tokens: &[&str], document_tokens: &[&str], matches: F) -> usize
where
    F: Fn(&str, &str) -> bool,
{
    fn augment<F>(
        query_index: usize,
        query_tokens: &[&str],
        document_tokens: &[&str],
        matches: &F,
        visited: &mut [bool],
        assigned_queries: &mut [Option<usize>],
    ) -> bool
    where
        F: Fn(&str, &str) -> bool,
    {
        for (document_index, document_token) in document_tokens.iter().enumerate() {
            if visited[document_index] || !matches(query_tokens[query_index], document_token) {
                continue;
            }
            visited[document_index] = true;
            if assigned_queries[document_index].is_none_or(|assigned| {
                augment(
                    assigned,
                    query_tokens,
                    document_tokens,
                    matches,
                    visited,
                    assigned_queries,
                )
            }) {
                assigned_queries[document_index] = Some(query_index);
                return true;
            }
        }
        false
    }

    let mut assigned_queries = vec![None; document_tokens.len()];
    (0..query_tokens.len())
        .filter(|query_index| {
            augment(
                *query_index,
                query_tokens,
                document_tokens,
                &matches,
                &mut vec![false; document_tokens.len()],
                &mut assigned_queries,
            )
        })
        .count()
}

fn document_matches_token(document: &SearchDocument, query_token: &str) -> bool {
    document
        .title
        .split_whitespace()
        .chain(document.artist.split_whitespace())
        .chain(document.album.split_whitespace())
        .chain(std::iter::once(document.acronym.as_ref()))
        .chain(std::iter::once(document.compact_title.as_ref()))
        .chain(document.compact_title_without_article.as_deref())
        .any(|token| {
            token == query_token
                || token.starts_with(query_token)
                || (query_token.chars().count() >= 4
                    && edit_distance_at_most_one(query_token, token))
        })
}

pub(crate) fn acronym(value: &str) -> String {
    let normalized = normalize(value);
    let words = normalized.split_whitespace().collect::<Vec<_>>();
    if words.len() < 2 {
        return String::new();
    }
    let value = words
        .iter()
        .filter_map(|word| {
            word.chars()
                .next()
                .filter(|character| character.is_alphabetic())
        })
        .collect::<String>();
    if value.chars().count() >= 2 {
        value
    } else {
        String::new()
    }
}

fn type_boost(entity_type: &str) -> f32 {
    match entity_type {
        "artist" => 3.0,
        "album" => 2.0,
        _ => 1.0,
    }
}

/// Scores release context without overriding stronger textual matches.
pub(crate) fn release_context_boost(primary_type: &str, has_matching_edition: bool) -> f32 {
    if is_edition_primary_type(primary_type) {
        return 6.0;
    }
    let boost = match primary_type.trim().to_ascii_lowercase().as_str() {
        "album" => 8.0,
        "ep" => 4.0,
        "single" => 3.0,
        "soundtrack" => 2.0,
        "compilation" => 1.0,
        _ => 0.0,
    };
    boost + f32::from(has_matching_edition && primary_type.eq_ignore_ascii_case("album")) * 2.0
}

fn entity_priority(entity_type: &str) -> u8 {
    match entity_type {
        "artist" => 0,
        "album" => 1,
        _ => 2,
    }
}

pub(crate) fn sort_hits(hits: &mut [SearchHit]) {
    hits.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| {
                entity_priority(&left.entity_type).cmp(&entity_priority(&right.entity_type))
            })
            .then_with(|| left.entity_id.cmp(&right.entity_id))
    });
}

fn extend_bounded(target: &mut BTreeSet<u32>, values: &[u32]) {
    for value in values {
        if target.len() >= MAX_CANDIDATES {
            break;
        }
        target.insert(*value);
    }
}

fn edit_distance_at_most_one(left: &str, right: &str) -> bool {
    if left == right {
        return true;
    }
    let left = left.chars().collect::<Vec<_>>();
    let right = right.chars().collect::<Vec<_>>();
    if left.len().abs_diff(right.len()) > 1 {
        return false;
    }
    let (mut i, mut j, mut edits) = (0, 0, 0);
    while i < left.len() && j < right.len() {
        if left[i] == right[j] {
            i += 1;
            j += 1;
            continue;
        }
        edits += 1;
        if edits > 1 {
            return false;
        }
        if left.len() == right.len()
            && i + 1 < left.len()
            && j + 1 < right.len()
            && left[i] == right[j + 1]
            && left[i + 1] == right[j]
        {
            i += 2;
            j += 2;
            continue;
        }
        match left.len().cmp(&right.len()) {
            Ordering::Greater => i += 1,
            Ordering::Less => j += 1,
            Ordering::Equal => {
                i += 1;
                j += 1;
            }
        }
    }
    edits + usize::from(i < left.len() || j < right.len()) <= 1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Album, Song};

    fn index() -> SearchIndex {
        let artists = vec![
            Artist {
                id: "artist-signal-harbor".into(),
                name: "Signal Harbor".into(),
                albums: vec![Album {
                    id: "album-color-study".into(),
                    name: "Color Study".into(),
                    songs: vec![Song {
                        id: "song-silver-current".into(),
                        name: "Silver Current / Arcs".into(),
                        artist: "Signal Harbor".into(),
                        ..Default::default()
                    }],
                    ..Default::default()
                }],
                ..Default::default()
            },
            Artist {
                id: "artist-casey-rivers".into(),
                name: "Casey Rivers".into(),
                ..Default::default()
            },
            Artist {
                id: "artist-nora-reed".into(),
                name: "Nóra Reed".into(),
                ..Default::default()
            },
            Artist {
                id: "artist-morgan-vale".into(),
                name: "Morgan Vale".into(),
                albums: vec![Album {
                    id: "album-second-wind".into(),
                    name: "Second Wind".into(),
                    songs: vec![Song {
                        id: "song-make-it-clear".into(),
                        name: "Make It Clear".into(),
                        artist: "Morgan Vale".into(),
                        ..Default::default()
                    }],
                    ..Default::default()
                }],
                ..Default::default()
            },
        ];
        SearchIndex::build(&artists).unwrap()
    }

    #[test]
    fn exact_title_beats_context_matches() {
        let hits = index().search("signal harbor", 10).unwrap();
        assert_eq!(hits[0].entity_id, "artist-signal-harbor");
        assert_eq!(hits[0].match_reason, "exact_title");
    }

    #[test]
    fn supports_multi_term_prefixes_and_punctuation() {
        let hits = index().search("silver curr", 10).unwrap();
        assert_eq!(hits[0].entity_id, "song-silver-current");
        assert_eq!(hits[0].match_reason, "title_prefix");
    }

    #[test]
    fn recovers_one_character_typo() {
        let hits = index().search("signal harbr", 10).unwrap();
        assert_eq!(hits[0].entity_id, "artist-signal-harbor");
        assert_eq!(hits[0].match_reason, "typo");
    }

    #[test]
    fn finds_artist_by_initials() {
        let hits = index().search("cr", 10).unwrap();
        assert_eq!(hits[0].entity_id, "artist-casey-rivers");
        assert_eq!(hits[0].match_reason, "acronym");
    }

    #[test]
    fn finds_track_by_full_title_initials() {
        let hits = index().search("mic", 10).unwrap();
        assert_eq!(hits[0].entity_id, "song-make-it-clear");
        assert_eq!(hits[0].match_reason, "acronym");
    }

    #[test]
    fn supports_partial_initials() {
        let hits = index().search("mi", 10).unwrap();
        assert_eq!(hits[0].entity_id, "song-make-it-clear");
    }

    #[test]
    fn ordinary_album_copies_win_close_ties_without_overriding_text_relevance() {
        let song = |id: &str| Song {
            id: id.into(),
            name: "Make It Clear".into(),
            artist: "Morgan Vale".into(),
            ..Default::default()
        };
        let album = |id: &str, name: &str, primary_type: &str, song_id: &str| Album {
            id: id.into(),
            name: name.into(),
            primary_type: primary_type.into(),
            songs: vec![song(song_id)],
            ..Default::default()
        };
        let index = SearchIndex::build(&[Artist {
            id: "artist-morgan".into(),
            name: "Morgan Vale".into(),
            albums: vec![
                album("dance", "Dance Collection", "Compilation", "song-dance"),
                album("first-album", "First Light", "Album", "song-first"),
                album("anchor-point", "Anchor Point", "Album", "song-anchor"),
                album(
                    "anchor-point-edition",
                    "Anchor Point (Special Edition)",
                    "Special Edition",
                    "song-anchor-edition",
                ),
            ],
            ..Default::default()
        }])
        .unwrap();

        for query in ["mic", "make it clear"] {
            let hits = index.search(query, 20).unwrap();
            let songs = hits
                .iter()
                .filter(|hit| hit.entity_type == "song")
                .map(|hit| hit.entity_id.as_str())
                .collect::<Vec<_>>();
            assert_eq!(songs[0], "song-anchor", "query {query}");
            assert!(
                songs.iter().position(|id| *id == "song-dance")
                    > songs.iter().position(|id| *id == "song-first")
            );
        }
    }

    #[test]
    fn duplicate_recordings_use_the_best_release_context_regardless_of_catalog_order() {
        let release = |id: &str, name: &str, primary_type: &str| Album {
            id: id.into(),
            name: name.into(),
            primary_type: primary_type.into(),
            songs: vec![Song {
                id: "shared-recording".into(),
                name: "Crystal Current".into(),
                artist: "Aster Vale".into(),
                ..Default::default()
            }],
            ..Default::default()
        };

        for (alternate_type, alternate_title) in [
            ("Remix", "Crystal Current: Club Reworks"),
            ("Compilation", "Collected Currents"),
            ("Live", "Crystal Current: On Stage"),
            ("Single", "Crystal Current: Single"),
        ] {
            for canonical_first in [true, false] {
                let canonical = release("canonical", "Northbound", "Album");
                let alternate = release("alternate", alternate_title, alternate_type);
                let albums = if canonical_first {
                    vec![canonical, alternate]
                } else {
                    vec![alternate, canonical]
                };
                let index = SearchIndex::build(&[Artist {
                    id: "aster-vale".into(),
                    name: "Aster Vale".into(),
                    albums,
                    ..Default::default()
                }])
                .unwrap();

                let selected = index
                    .documents
                    .iter()
                    .find(|document| document.entity_id.as_ref() == "shared-recording")
                    .unwrap();
                assert_eq!(selected.album.as_ref(), "northbound", "{alternate_type}");

                let hits = index.search("crystal current", 10).unwrap();
                let recording = hits
                    .iter()
                    .find(|hit| hit.entity_id == "shared-recording")
                    .unwrap();
                assert_eq!(recording.match_reason, "exact_title");
            }
        }
    }

    #[test]
    fn canonical_recording_beats_a_distinct_remix_release_copy() {
        let song = |id: &str| Song {
            id: id.into(),
            name: "Crystal Current".into(),
            artist: "Aster Vale".into(),
            ..Default::default()
        };
        let index = SearchIndex::build(&[Artist {
            id: "aster-vale".into(),
            name: "Aster Vale".into(),
            albums: vec![
                Album {
                    id: "club-reworks".into(),
                    name: "Crystal Current: Club Reworks".into(),
                    primary_type: "Remix".into(),
                    songs: vec![song("remix-copy")],
                    ..Default::default()
                },
                Album {
                    id: "northbound".into(),
                    name: "Northbound".into(),
                    primary_type: "Album".into(),
                    songs: vec![song("canonical-copy")],
                    ..Default::default()
                },
            ],
            ..Default::default()
        }])
        .unwrap();

        let hits = index.search("crystal current", 10).unwrap();
        let songs = hits
            .iter()
            .filter(|hit| hit.entity_type == "song")
            .map(|hit| hit.entity_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(songs[..2], ["canonical-copy", "remix-copy"]);
    }

    #[test]
    fn canonical_album_song_is_first_for_break_the_ice() {
        let song = |id: &str, name: &str, duration: f64| Song {
            id: id.into(),
            name: name.into(),
            artist: "Britney Spears".into(),
            duration,
            ..Default::default()
        };
        let index = SearchIndex::build(&[Artist {
            id: "britney-spears".into(),
            name: "Britney Spears".into(),
            albums: vec![
                Album {
                    id: "dance-remixes".into(),
                    name: "Break The Ice: Dance Remixes".into(),
                    primary_type: "Remix".into(),
                    songs: vec![
                        song("remix-619", "Break The Ice", 379.0),
                        song("remix-657", "Break The Ice", 417.0),
                        song(
                            "mike-rizzo",
                            "Break The Ice (Mike Rizzo Funk Generation Club)",
                            401.0,
                        ),
                        song("remix-715", "Break The Ice", 435.0),
                        song("remix-850", "Break The Ice", 530.0),
                        song("tracy-young", "Break The Ice (Tracy Young Dub)", 508.0),
                    ],
                    ..Default::default()
                },
                Album {
                    id: "blackout".into(),
                    name: "Blackout".into(),
                    primary_type: "Album".into(),
                    songs: vec![song("blackout-original", "Break the Ice", 196.0)],
                    ..Default::default()
                },
            ],
            ..Default::default()
        }])
        .unwrap();

        let hits = index.search("Break the Ice", 20).unwrap();
        assert_eq!(hits[0].entity_id, "blackout-original");
        assert_eq!(hits[0].match_reason, "exact_title");
        assert!(
            hits.iter()
                .position(|hit| hit.entity_id == "blackout-original")
                < hits.iter().position(|hit| hit.entity_id == "dance-remixes")
        );
    }

    #[test]
    fn plain_release_titles_beat_remixes_and_live_variants_when_artist_qualifies_query() {
        let song = |id: &str, name: &str| Song {
            id: id.into(),
            name: name.into(),
            artist: "Rowan Miles".into(),
            ..Default::default()
        };
        let album = |id: &str, name: &str, primary_type: &str, song: Song| Album {
            id: id.into(),
            name: name.into(),
            primary_type: primary_type.into(),
            songs: vec![song],
            ..Default::default()
        };
        let index = SearchIndex::build(&[Artist {
            id: "amy".into(),
            name: "Rowan Miles".into(),
            albums: vec![
                album(
                    "return-to-blue",
                    "Return to Blue",
                    "Album",
                    song("return-to-blue-song", "Return to Blue"),
                ),
                album(
                    "singles-remixes",
                    "Return to Blue - The Singles Remixes",
                    "Compilation",
                    song("shoreline", "Return to Blue (Harbor Remix)"),
                ),
                album(
                    "live",
                    "Return to Blue (Live)",
                    "Live",
                    song("live", "Return to Blue (Live at Harbor Hall)"),
                ),
            ],
            ..Default::default()
        }])
        .unwrap();

        let hits = index.search("return to blue rowan", 20).unwrap();
        assert_eq!(hits[0].entity_id, "return-to-blue");
        assert!(
            hits.iter()
                .position(|hit| hit.entity_id == "return-to-blue-song")
                < hits.iter().position(|hit| hit.entity_id == "shoreline")
        );
        assert!(
            hits.iter()
                .position(|hit| hit.entity_id == "return-to-blue")
                < hits.iter().position(|hit| hit.entity_id == "live")
        );
    }

    #[test]
    fn partial_and_complete_title_initials_are_strong_matches() {
        let artists = vec![Artist {
            id: "artist-justin".into(),
            name: "Casey Rivers".into(),
            albums: vec![Album {
                id: "album-2020".into(),
                name: "Twin Horizons".into(),
                songs: vec![
                    Song {
                        id: "song-hold-wall".into(),
                        name: "Drift Home Through Waves".into(),
                        artist: "Casey Rivers".into(),
                        ..Default::default()
                    },
                    Song {
                        id: "song-dont-worry".into(),
                        name: "Don't Worry".into(),
                        artist: "Avery Lane".into(),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }],
            ..Default::default()
        }];
        let index = SearchIndex::build(&artists).unwrap();

        for query in ["dht", "dhtw"] {
            let hits = index.search(query, 10).unwrap();
            assert_eq!(hits[0].entity_id, "song-hold-wall", "query {query}");
            assert!(matches!(hits[0].match_reason, "acronym" | "acronym_prefix"));
            assert!(hits.iter().all(|hit| hit.entity_id != "song-dont-worry"));
        }
    }

    #[test]
    fn acronym_prefix_recall_is_not_limited_to_the_first_few_vocabulary_terms() {
        let mut artists = (0..100)
            .map(|index| {
                let first = char::from(b'a' + (index / 26) as u8);
                let second = char::from(b'a' + (index % 26) as u8);
                Artist {
                    id: format!("artist-{index:03}"),
                    name: format!("Delta Hotel Tango {first} {second}"),
                    ..Default::default()
                }
            })
            .collect::<Vec<_>>();
        artists.push(Artist {
            id: "artist-target".into(),
            name: "Delta Hotel Tango Zulu Zebra".into(),
            ..Default::default()
        });
        let hits = SearchIndex::build(&artists)
            .unwrap()
            .search("dht", 200)
            .unwrap();

        assert!(hits.iter().any(|hit| hit.entity_id == "artist-target"));
    }

    #[test]
    fn repeated_numeric_terms_need_distinct_evidence() {
        let artists = vec![Artist {
            id: "artist-justin".into(),
            name: "Casey Rivers".into(),
            albums: vec![
                Album {
                    id: "album-3030".into(),
                    name: "The 30/30 Survey".into(),
                    ..Default::default()
                },
                Album {
                    id: "album-3030-part-two".into(),
                    name: "The 30/30 Survey 2 of 2".into(),
                    ..Default::default()
                },
                Album {
                    id: "album-2008".into(),
                    name: "The Signal Is Mine 2008 (with Guest Artist) (CDS)".into(),
                    songs: vec![Song {
                        id: "song-2009".into(),
                        name: "Take Another Step (Studio Mix - 2009 Remaster)".into(),
                        artist: "Jordan Hale".into(),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            ],
            ..Default::default()
        }];
        let index = SearchIndex::build(&artists).unwrap();
        let hits = index.search("30/30", 10).unwrap();

        assert_eq!(hits[0].entity_id, "album-3030");
        assert_eq!(hits[1].entity_id, "album-3030-part-two");
        assert!(hits.iter().all(|hit| hit.entity_id != "album-2008"));
        assert!(hits.iter().all(|hit| hit.entity_id != "song-2009"));
    }

    #[test]
    fn duplicate_entity_ids_are_indexed_once() {
        let duplicate = Song {
            id: "same-recording".into(),
            name: "Duplicate Song".into(),
            artist: "Local Artist".into(),
            ..Default::default()
        };
        let artists = vec![Artist {
            id: "artist-local".into(),
            name: "Local Artist".into(),
            albums: vec![
                Album {
                    id: "album-one".into(),
                    name: "One".into(),
                    songs: vec![duplicate.clone()],
                    ..Default::default()
                },
                Album {
                    id: "album-two".into(),
                    name: "Two".into(),
                    songs: vec![duplicate],
                    ..Default::default()
                },
            ],
            ..Default::default()
        }];
        let hits = SearchIndex::build(&artists)
            .unwrap()
            .search("duplicate song", 10)
            .unwrap();

        assert_eq!(
            hits.iter()
                .filter(|hit| hit.entity_id == "same-recording")
                .count(),
            1
        );
    }

    #[test]
    fn duplicate_ids_index_the_same_last_value_used_by_the_library_cache() {
        let song = |name: &str| Song {
            id: "same-recording".into(),
            name: name.into(),
            artist: "Local Artist".into(),
            ..Default::default()
        };
        let index = SearchIndex::build(&[Artist {
            id: "artist-local".into(),
            name: "Local Artist".into(),
            albums: vec![
                Album {
                    id: "album-one".into(),
                    name: "One".into(),
                    songs: vec![song("Stale Metadata")],
                    ..Default::default()
                },
                Album {
                    id: "album-two".into(),
                    name: "Two".into(),
                    songs: vec![song("Current Metadata")],
                    ..Default::default()
                },
            ],
            ..Default::default()
        }])
        .unwrap();

        assert!(index.search("stale metadata", 10).unwrap().is_empty());
        assert_eq!(
            index.search("current metadata", 10).unwrap()[0].entity_id,
            "same-recording"
        );
    }

    #[test]
    fn normalization_is_unicode_compatible_ascii_friendly_and_idempotent() {
        let cases = [
            ("N\u{f3}ra Reed", "nora reed"),
            (
                "\u{c6}ther \u{d8}resund Stra\u{df}e C\u{153}ur \u{141}\u{f3}d\u{17a}",
                "aether oresund strasse coeur lodz",
            ),
            ("\u{ff21}\u{ff23}\u{ff0f}\u{ff24}\u{ff23}", "ac dc"),
            ("Don\u{2019}t Don\u{2018}t Don\u{2bc}t", "dont dont dont"),
        ];
        for (input, expected) in cases {
            let normalized = normalize(input);
            assert_eq!(normalized, expected, "input {input}");
            assert_eq!(normalize(&normalized), normalized, "input {input}");
        }
    }

    #[test]
    fn compact_punctuation_variants_match_titles() {
        let artists = vec![Artist {
            id: "artist-abcd".into(),
            name: "AB/CD".into(),
            albums: vec![Album {
                id: "album-twin-horizons".into(),
                name: "The 30/30 Horizon".into(),
                songs: vec![Song {
                    id: "song-still-again".into(),
                    name: "Still / Again".into(),
                    artist: "Morgan Vale".into(),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }];
        let index = SearchIndex::build(&artists).unwrap();

        for (query, expected) in [
            ("abcd", "artist-abcd"),
            ("3030horizon", "album-twin-horizons"),
            ("stillag", "song-still-again"),
        ] {
            assert_eq!(index.search(query, 10).unwrap()[0].entity_id, expected);
        }
    }

    #[test]
    fn written_and_matches_ampersand_titles() {
        let index = SearchIndex::build(&[Artist {
            id: "artist-stone-tide-sky".into(),
            name: "Stone, Tide & Sky".into(),
            ..Default::default()
        }])
        .unwrap();

        assert_eq!(
            index.search("stone tide and sky", 10).unwrap()[0].entity_id,
            "artist-stone-tide-sky"
        );
    }

    #[test]
    fn exact_prefix_candidates_do_not_hide_valid_typo_candidates() {
        let index = SearchIndex::build(&[
            Artist {
                id: "artist-distractor".into(),
                name: "Signal Harbridge".into(),
                ..Default::default()
            },
            Artist {
                id: "artist-signal-harbor".into(),
                name: "Signal Harbor".into(),
                ..Default::default()
            },
        ])
        .unwrap();
        let hits = index.search("signal harbr", 10).unwrap();

        assert_eq!(hits[0].entity_id, "artist-distractor");
        assert!(
            hits.iter().any(|hit| {
                hit.entity_id == "artist-signal-harbor" && hit.match_reason == "typo"
            })
        );
    }

    #[test]
    fn typo_matching_combines_with_exact_and_prefix_terms() {
        let index = SearchIndex::build(&[Artist {
            id: "artist-signal-harbor".into(),
            name: "Signal Harbor".into(),
            albums: vec![Album {
                id: "album-color-study".into(),
                name: "Color Study".into(),
                songs: vec![Song {
                    id: "song-silver-current".into(),
                    name: "Silver Current / Arcs".into(),
                    artist: "Signal Harbor".into(),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }])
        .unwrap();

        let hits = index.search("silver curent arcs", 10).unwrap();
        assert_eq!(hits[0].entity_id, "song-silver-current");
        assert_eq!(hits[0].match_reason, "typo");
    }

    #[test]
    fn typo_matching_supports_adjacent_transpositions_but_not_short_noise() {
        let index = index();
        assert_eq!(
            index.search("signla harbor", 10).unwrap()[0].entity_id,
            "artist-signal-harbor"
        );
        assert!(index.search("zz", 10).unwrap().is_empty());
    }

    #[test]
    fn distinct_term_assignment_finds_a_complete_non_greedy_matching() {
        let queries = ["q1", "q2", "q3", "q4"];
        let documents = ["d1", "d2", "d3", "d4"];
        let edges = [
            ("q1", "d1"),
            ("q1", "d2"),
            ("q2", "d1"),
            ("q2", "d3"),
            ("q3", "d3"),
            ("q3", "d4"),
            ("q4", "d3"),
            ("q4", "d4"),
        ];

        assert_eq!(
            distinct_match_count(&queries, &documents, |query, document| {
                edges.contains(&(query, document))
            }),
            4
        );
    }

    #[test]
    fn punctuation_only_queries_and_zero_limits_are_empty() {
        let index = index();
        assert!(index.search(" / -- ( ) ", 10).unwrap().is_empty());
        assert!(index.search("signal harbor", 0).unwrap().is_empty());
    }

    #[test]
    fn ignores_accents_and_supports_out_of_order_terms() {
        assert_eq!(
            index().search("nora", 10).unwrap()[0].entity_id,
            "artist-nora-reed"
        );
        assert_eq!(
            index().search("clear make", 10).unwrap()[0].entity_id,
            "song-make-it-clear"
        );
    }

    #[test]
    fn typo_recovery_handles_wrong_first_character() {
        let hits = index().search("bignal harbor", 10).unwrap();
        assert_eq!(hits[0].entity_id, "artist-signal-harbor");
        assert_eq!(hits[0].match_reason, "typo");
    }

    #[test]
    fn results_are_deterministic() {
        let index = index();
        assert_eq!(
            index.search("radio", 10).unwrap(),
            index.search("radio", 10).unwrap()
        );
    }

    #[test]
    fn five_thousand_tracks_index_and_search_quickly() {
        use std::time::{Duration, Instant};

        let songs = (0..5_000)
            .map(|number| Song {
                id: format!("song-{number}"),
                name: format!("Track Number {number}"),
                artist: "Local Artist".into(),
                ..Default::default()
            })
            .collect();
        let artists = vec![Artist {
            id: "artist-local".into(),
            name: "Local Artist".into(),
            albums: vec![Album {
                id: "album-local".into(),
                name: "Local Album".into(),
                songs,
                ..Default::default()
            }],
            ..Default::default()
        }];

        let started = Instant::now();
        let index = SearchIndex::build(&artists).unwrap();
        let build_elapsed = started.elapsed();
        let started = Instant::now();
        for _ in 0..100 {
            assert!(!index.search("track number 4999", 50).unwrap().is_empty());
        }
        let search_elapsed = started.elapsed();

        assert!(
            build_elapsed < Duration::from_secs(2),
            "build took {build_elapsed:?}"
        );
        assert!(
            search_elapsed < Duration::from_secs(1),
            "100 searches took {search_elapsed:?}"
        );
    }

    /// Run explicitly with:
    /// cargo test -p parson-music million_track_benchmark -- --ignored --nocapture
    #[test]
    #[ignore = "one-million-track stress benchmark"]
    fn million_track_benchmark() {
        use std::time::Instant;

        const TRACKS: usize = 1_000_000;
        const QUERIES: usize = 1_000;
        let songs = (0..TRACKS)
            .map(|number| Song {
                id: format!("song-{number}"),
                name: format!("Track Number {number}"),
                artist: format!("Artist {}", number / 100),
                ..Default::default()
            })
            .collect();
        let artists = vec![Artist {
            id: "stress-artist".into(),
            name: "Stress Artist".into(),
            albums: vec![Album {
                id: "stress-album".into(),
                name: "Stress Album".into(),
                songs,
                ..Default::default()
            }],
            ..Default::default()
        }];

        let started = Instant::now();
        let index = SearchIndex::build(&artists).unwrap();
        let build_elapsed = started.elapsed();

        let started = Instant::now();
        for number in 0..QUERIES {
            let target = (number * 997) % TRACKS;
            let hits = index.search(&format!("track number {target}"), 50).unwrap();
            assert_eq!(
                hits.first().map(|hit| hit.entity_id.as_str()),
                Some(format!("song-{target}")).as_deref()
            );
        }
        let search_elapsed = started.elapsed();

        println!(
            "SEARCH_BENCH tracks={TRACKS} build_ms={} queries={QUERIES} total_query_ms={} mean_query_us={}",
            build_elapsed.as_millis(),
            search_elapsed.as_millis(),
            search_elapsed.as_micros() / QUERIES as u128,
        );
    }
}
