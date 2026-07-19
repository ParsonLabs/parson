use std::collections::HashSet;

use actix_web::{HttpRequest, HttpResponse, get, web};
use serde::Serialize;

use crate::domain::{Album, Artist};
use crate::library::state::{LibraryCache, LibraryLifecycle, library_unavailable_response};
use crate::persistence::connection::DbPool;

use super::album::ResponseAlbum;
use super::song::{ResponseSong, SongInfo, fetch_random_songs, fetch_song_info_from_cache};
use super::user::fetch_recommended_song_ids;

const SECTION_SIZE: usize = 18;

#[derive(Serialize)]
struct LibraryStats {
    song_count: usize,
    album_count: usize,
    artist_count: usize,
}

#[derive(Serialize)]
struct HomeResponse {
    continue_listening: Vec<ResponseSong>,
    recommended: Vec<ResponseSong>,
    shuffle: Vec<ResponseSong>,
    albums: Vec<ResponseAlbum>,
    stats: LibraryStats,
}

fn hydrate(song_ids: impl IntoIterator<Item = String>, cache: &LibraryCache) -> Vec<ResponseSong> {
    let mut seen = HashSet::new();
    song_ids
        .into_iter()
        .filter(|id| seen.insert(id.clone()))
        .filter_map(
            |id| match fetch_song_info_from_cache(&id, cache, Some(false)) {
                Ok(SongInfo::Full(song)) => Some(song),
                _ => None,
            },
        )
        .take(SECTION_SIZE)
        .collect()
}

fn has_cover(path: &str) -> bool {
    let path = path.trim().to_ascii_lowercase();
    !path.is_empty() && !path.ends_with("snf.png")
}

fn release_priority(primary_type: &str) -> u8 {
    match primary_type.trim().to_ascii_lowercase().as_str() {
        "album" => 0,
        "ep" => 1,
        "single" => 2,
        "soundtrack" => 3,
        "remix" => 4,
        "compilation" => 5,
        "live" => 6,
        "demos & rarities" => 7,
        "acapella" => 8,
        "bonus audio" => 9,
        "bootleg" => 10,
        _ => 4,
    }
}

fn prefer_album_tracks(mut songs: Vec<ResponseSong>) -> Vec<ResponseSong> {
    songs.sort_by_key(|song| {
        (
            release_priority(&song.album_object.primary_type),
            !has_cover(&song.album_object.cover_url),
        )
    });
    songs.truncate(SECTION_SIZE);
    songs
}

fn response_album(artist: &Artist, album: &Album) -> ResponseAlbum {
    ResponseAlbum {
        id: album.id.clone(),
        name: album.name.clone(),
        cover_url: album.cover_url.clone(),
        songs: album
            .songs
            .iter()
            .map(|song| crate::api::song::response_song(song, album, artist))
            .collect(),
        first_release_date: album.first_release_date.clone(),
        musicbrainz_id: album.musicbrainz_id.clone(),
        wikidata_id: album.wikidata_id.clone(),
        primary_type: album.primary_type.clone(),
        description: album.description.clone(),
        artist_object: crate::api::artist_reference(artist),
        contributing_artists: album.contributing_artists.clone(),
        contributing_artists_ids: album.contributing_artists_ids.clone(),
        release_album: album.release_album.clone(),
        release_group_album: album.release_group_album.clone(),
    }
}

fn recommended_albums(song_ids: &[String], cache: &LibraryCache) -> Vec<ResponseAlbum> {
    let mut evidence = std::collections::HashMap::<String, usize>::new();
    for song_id in song_ids {
        if let Some((_, album_id)) = cache.song_map.get(song_id) {
            *evidence.entry(album_id.clone()).or_default() += 1;
        }
    }
    let mut albums = evidence
        .into_iter()
        .filter(|(_, count)| *count >= 2)
        .filter_map(|(album_id, count)| {
            let album = cache.album(&album_id)?;
            let artist = cache.album_owner(&album_id)?;
            let album_type = album.primary_type.to_ascii_lowercase();
            if album.songs.is_empty()
                || album_type.contains("compilation")
                || album_type.contains("bootleg")
            {
                return None;
            }
            Some((count, album_id, response_album(artist, album)))
        })
        .collect::<Vec<_>>();
    albums.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
    albums
        .into_iter()
        .take(SECTION_SIZE)
        .map(|(_, _, album)| album)
        .collect()
}

fn discovery_albums(cache: &LibraryCache) -> Vec<ResponseAlbum> {
    let mut albums = cache
        .artists
        .iter()
        .filter_map(|artist| {
            artist
                .albums
                .iter()
                .filter(|album| !album.songs.is_empty())
                .min_by_key(|album| (!has_cover(&album.cover_url), album.id.as_str()))
                .map(|album| response_album(artist, album))
        })
        .collect::<Vec<_>>();
    // Digest-derived ID order provides a stable non-alphabetical shuffle.
    albums.sort_unstable_by(|left, right| {
        (!has_cover(&left.cover_url), left.id.as_str())
            .cmp(&(!has_cover(&right.cover_url), right.id.as_str()))
    });
    albums.truncate(SECTION_SIZE);
    albums
}

#[get("")]
async fn home(
    request: HttpRequest,
    lifecycle: web::Data<LibraryLifecycle>,
    pool: web::Data<DbPool>,
) -> HttpResponse {
    let cache = match lifecycle.cache().await {
        Ok(cache) => cache,
        Err(readiness) => return library_unavailable_response(readiness),
    };
    let user_id = match crate::api::auth::authenticated_user_id(&request) {
        Ok(id) => id as u32,
        Err(response) => return response,
    };

    let history =
        crate::recommendation::recent_playback_ids(user_id as i32, &pool, SECTION_SIZE as i64)
            .unwrap_or_default();
    let continue_listening = hydrate(history, &cache);

    let recommendation_ids = fetch_recommended_song_ids(user_id, None, &cache, &pool)
        .await
        .unwrap_or_default();
    let recommended = hydrate(recommendation_ids.clone(), &cache);

    let recommended_song_ids = recommended
        .iter()
        .map(|song| song.id.as_str())
        .collect::<HashSet<_>>();
    let shuffle = fetch_random_songs(SECTION_SIZE * 4, None, &cache)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|song| !recommended_song_ids.contains(song.id.as_str()))
        .collect::<Vec<_>>();

    let mut albums = recommended_albums(&recommendation_ids, &cache);
    if albums.is_empty() {
        albums = discovery_albums(&cache);
    }

    HttpResponse::Ok().json(HomeResponse {
        continue_listening,
        recommended,
        shuffle: prefer_album_tracks(shuffle),
        albums,
        stats: LibraryStats {
            song_count: cache.songs_flat.len(),
            album_count: cache.album_count(),
            artist_count: cache.artists.len(),
        },
    })
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(web::scope("/home").service(home));
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use super::{
        SECTION_SIZE, has_cover, hydrate, prefer_album_tracks, recommended_albums, release_priority,
    };
    use crate::api::song::ResponseSong;
    use crate::domain::{Album, Artist, Song};
    use crate::library::search::SearchIndex;
    use crate::library::state::LibraryCache;

    fn song(id: &str) -> Song {
        Song {
            id: id.into(),
            name: id.into(),
            artist: "Artist".into(),
            ..Song::default()
        }
    }

    fn fixture() -> LibraryCache {
        let albums = vec![
            Album {
                id: "album-a".into(),
                name: "A".into(),
                primary_type: "Album".into(),
                cover_url: "cover.jpg".into(),
                songs: vec![song("a1"), song("a2")],
                ..Album::default()
            },
            Album {
                id: "album-b".into(),
                name: "B".into(),
                primary_type: "Compilation".into(),
                songs: vec![song("b1"), song("b2")],
                ..Album::default()
            },
            Album {
                id: "album-c".into(),
                name: "C".into(),
                primary_type: "EP".into(),
                songs: vec![song("c1")],
                ..Album::default()
            },
        ];
        let artist = Artist {
            id: "artist".into(),
            name: "Artist".into(),
            albums,
            ..Artist::default()
        };
        LibraryCache {
            artists: Arc::new(vec![artist.clone()]),
            search_index: SearchIndex::build(std::slice::from_ref(&artist)).unwrap(),
            song_map: HashMap::from([
                ("a1".into(), ("artist".into(), "album-a".into())),
                ("a2".into(), ("artist".into(), "album-a".into())),
                ("b1".into(), ("artist".into(), "album-b".into())),
                ("b2".into(), ("artist".into(), "album-b".into())),
                ("c1".into(), ("artist".into(), "album-c".into())),
            ]),
            album_genres: HashMap::new(),
            artist_positions: HashMap::from([("artist".into(), 0)]),
            album_positions: HashMap::from([
                ("album-a".into(), (0, 0)),
                ("album-b".into(), (0, 1)),
                ("album-c".into(), (0, 2)),
            ]),
            song_positions: HashMap::from([
                ("a1".into(), (0, 0, 0)),
                ("a2".into(), (0, 0, 1)),
                ("b1".into(), (0, 1, 0)),
                ("b2".into(), (0, 1, 1)),
                ("c1".into(), (0, 2, 0)),
            ]),
            songs_flat: vec![
                "a1".into(),
                "a2".into(),
                "b1".into(),
                "b2".into(),
                "c1".into(),
            ],
            songs_by_artist: HashMap::new(),
            songs_by_genre: HashMap::new(),
            image_paths: Default::default(),
        }
    }

    #[test]
    fn hydration_deduplicates_unknown_ids_and_preserves_first_seen_order() {
        let cache = fixture();
        let hydrated = hydrate(
            ["a2", "missing", "a1", "a2"]
                .into_iter()
                .map(str::to_string),
            &cache,
        );
        assert_eq!(
            hydrated
                .iter()
                .map(|song| song.id.as_str())
                .collect::<Vec<_>>(),
            ["a2", "a1"]
        );
    }

    #[test]
    fn recommended_albums_require_repeated_evidence_and_exclude_low_quality_types() {
        let cache = fixture();
        let ids = ["b1", "b2", "a2", "a1", "a2", "c1"]
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();
        let albums = recommended_albums(&ids, &cache);
        assert_eq!(
            albums
                .iter()
                .map(|album| album.id.as_str())
                .collect::<Vec<_>>(),
            ["album-a"]
        );
    }

    fn response(id: &str, release_type: &str, cover: &str) -> ResponseSong {
        ResponseSong {
            id: id.into(),
            name: id.into(),
            artist: "Artist".into(),
            contributing_artists: Vec::new(),
            contributing_artist_ids: Vec::new(),
            track_number: 0,
            path: String::new(),
            duration: 0.0,
            album_object: Album {
                primary_type: release_type.into(),
                cover_url: cover.into(),
                ..Album::default()
            },
            artist_object: Artist::default(),
        }
    }

    #[test]
    fn shuffle_prefers_album_tracks_then_artwork_and_enforces_section_size() {
        let mut songs = vec![
            response("single-cover", "Single", "cover.jpg"),
            response("album-placeholder", "Album", "snf.png"),
            response("album-cover", "Album", "cover.jpg"),
        ];
        songs.extend(
            (0..SECTION_SIZE).map(|index| response(&format!("extra-{index}"), "Bootleg", "")),
        );
        let preferred = prefer_album_tracks(songs);
        assert_eq!(preferred.len(), SECTION_SIZE);
        assert_eq!(
            preferred
                .iter()
                .take(3)
                .map(|song| song.id.as_str())
                .collect::<Vec<_>>(),
            ["album-cover", "album-placeholder", "single-cover"]
        );
    }

    #[test]
    fn cover_and_release_classification_handle_whitespace_case_and_placeholders() {
        assert!(has_cover("  COVER.JPG "));
        assert!(!has_cover(""));
        assert!(!has_cover("/images/SNF.PNG"));
        assert!(release_priority(" ALBUM ") < release_priority("single"));
        assert_eq!(release_priority("unknown"), release_priority("remix"));
    }
}
