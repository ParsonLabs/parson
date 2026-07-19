use std::io::Write;

use actix_multipart::Multipart;
use actix_web::{HttpResponse, post, put, web};
use bytes::BytesMut;
use diesel::prelude::*;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::api::album::ResponseAlbum;
use crate::api::error::{bad_request, internal_server_error, not_found};
use crate::api::song::ResponseSong;
use crate::domain::{Album, Artist};
use crate::library::storage::{fetch_library, get_cover_art_path, refresh_cache};
use crate::persistence::connection::DbPool;

#[derive(Deserialize)]
pub struct SongMetadataPatch {
    pub name: Option<String>,
    pub artist: Option<String>,
    pub contributing_artists: Option<Vec<String>>,
    pub contributing_artist_ids: Option<Vec<String>>,
    pub track_number: Option<u16>,
    pub path: Option<String>,
    pub duration: Option<f64>,
}

#[derive(Deserialize)]
pub struct AlbumMetadataPatch {
    pub name: Option<String>,
    pub cover_url: Option<String>,
    pub first_release_date: Option<String>,
    pub musicbrainz_id: Option<String>,
    pub wikidata_id: Option<Option<String>>,
    pub primary_type: Option<String>,
    pub description: Option<String>,
    pub contributing_artists: Option<Vec<String>>,
    pub contributing_artists_ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
pub struct ArtistMetadataPatch {
    pub name: Option<String>,
    pub icon_url: Option<String>,
    pub followers: Option<u64>,
    pub description: Option<String>,
    pub featured_on_album_ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
pub struct LibraryMetadataPatch {
    pub song: Option<SongMetadataPatch>,
    pub album: Option<AlbumMetadataPatch>,
    pub artist: Option<ArtistMetadataPatch>,
}

const MAX_METADATA_TEXT: usize = 512;
const MAX_METADATA_URL: usize = 8 * 1024;
const MAX_METADATA_PATH: usize = 32 * 1024;
const MAX_METADATA_DESCRIPTION: usize = 50 * 1024;
const MAX_METADATA_LIST_ITEMS: usize = 256;
const MAX_ALBUM_COVER_BYTES: usize = 10 * 1024 * 1024;

fn bounded(value: Option<&String>, maximum: usize, allow_empty: bool) -> bool {
    value.is_none_or(|value| value.len() <= maximum && (allow_empty || !value.trim().is_empty()))
}

fn bounded_list(value: Option<&Vec<String>>) -> bool {
    value.is_none_or(|values| {
        values.len() <= MAX_METADATA_LIST_ITEMS
            && values.iter().all(|value| value.len() <= MAX_METADATA_TEXT)
    })
}

fn validate_patch(patch: &LibraryMetadataPatch) -> bool {
    let song_valid = patch.song.as_ref().is_none_or(|song| {
        bounded(song.name.as_ref(), MAX_METADATA_TEXT, false)
            && bounded(song.artist.as_ref(), MAX_METADATA_TEXT, true)
            && bounded(song.path.as_ref(), MAX_METADATA_PATH, false)
            && bounded_list(song.contributing_artists.as_ref())
            && bounded_list(song.contributing_artist_ids.as_ref())
            && song
                .duration
                .is_none_or(|duration| duration.is_finite() && duration >= 0.0)
    });
    let album_valid = patch.album.as_ref().is_none_or(|album| {
        bounded(album.name.as_ref(), MAX_METADATA_TEXT, false)
            && bounded(album.cover_url.as_ref(), MAX_METADATA_URL, true)
            && bounded(album.first_release_date.as_ref(), MAX_METADATA_TEXT, true)
            && bounded(album.musicbrainz_id.as_ref(), MAX_METADATA_TEXT, true)
            && bounded(
                album.wikidata_id.as_ref().and_then(Option::as_ref),
                MAX_METADATA_TEXT,
                true,
            )
            && bounded(album.primary_type.as_ref(), MAX_METADATA_TEXT, true)
            && bounded(album.description.as_ref(), MAX_METADATA_DESCRIPTION, true)
            && bounded_list(album.contributing_artists.as_ref())
            && bounded_list(album.contributing_artists_ids.as_ref())
    });
    let artist_valid = patch.artist.as_ref().is_none_or(|artist| {
        bounded(artist.name.as_ref(), MAX_METADATA_TEXT, false)
            && bounded(artist.icon_url.as_ref(), MAX_METADATA_URL, true)
            && bounded(artist.description.as_ref(), MAX_METADATA_DESCRIPTION, true)
            && bounded_list(artist.featured_on_album_ids.as_ref())
    });
    song_valid && album_valid && artist_valid
}

#[derive(Serialize)]
pub struct LibraryMetadataResponse {
    pub song: ResponseSong,
    pub album: ResponseAlbum,
    pub artist: Artist,
}

#[derive(Serialize)]
pub struct AlbumMetadataResponse {
    pub album: ResponseAlbum,
    pub artist: Artist,
}

#[derive(Serialize)]
pub struct AlbumCoverUploadResponse {
    pub cover_url: String,
}

struct OverrideWrite {
    entity_type: &'static str,
    entity_id: String,
    field_name: &'static str,
    value_json: String,
}

struct SearchTitleWrite {
    entity_type: &'static str,
    entity_id: String,
    title: String,
}

fn add_override<T: Serialize>(
    writes: &mut Vec<OverrideWrite>,
    entity_type: &'static str,
    entity_id: &str,
    field_name: &'static str,
    value: T,
) -> Result<(), serde_json::Error> {
    writes.push(OverrideWrite {
        entity_type,
        entity_id: entity_id.to_string(),
        field_name,
        value_json: serde_json::to_string(&value)?,
    });
    Ok(())
}

fn prepare_writes(
    patch: LibraryMetadataPatch,
    song_id: &str,
    album_id: &str,
    artist_id: &str,
) -> Result<(Vec<OverrideWrite>, Vec<SearchTitleWrite>), serde_json::Error> {
    let mut writes = Vec::new();
    let mut titles = Vec::new();
    macro_rules! add {
        ($kind:literal, $id:expr, $field:literal, $value:expr) => {
            if let Some(value) = $value {
                add_override(&mut writes, $kind, $id, $field, value)?;
            }
        };
    }

    if let Some(artist) = patch.artist {
        if let Some(name) = artist.name {
            add_override(&mut writes, "artist", artist_id, "name", &name)?;
            titles.push(SearchTitleWrite {
                entity_type: "artist",
                entity_id: artist_id.to_string(),
                title: name,
            });
        }
        add!("artist", artist_id, "icon_url", artist.icon_url);
        add!("artist", artist_id, "description", artist.description);
        add!("artist", artist_id, "followers", artist.followers);
        add!(
            "artist",
            artist_id,
            "featured_on_album_ids",
            artist.featured_on_album_ids
        );
    }
    if let Some(album) = patch.album {
        if let Some(name) = album.name {
            add_override(&mut writes, "album", album_id, "name", &name)?;
            titles.push(SearchTitleWrite {
                entity_type: "album",
                entity_id: album_id.to_string(),
                title: name,
            });
        }
        add!("album", album_id, "cover_url", album.cover_url);
        add!(
            "album",
            album_id,
            "first_release_date",
            album.first_release_date
        );
        add!("album", album_id, "musicbrainz_id", album.musicbrainz_id);
        add!("album", album_id, "wikidata_id", album.wikidata_id);
        add!("album", album_id, "primary_type", album.primary_type);
        add!("album", album_id, "description", album.description);
        add!(
            "album",
            album_id,
            "contributing_artists",
            album.contributing_artists
        );
        add!(
            "album",
            album_id,
            "contributing_artists_ids",
            album.contributing_artists_ids
        );
    }
    if let Some(song) = patch.song {
        if let Some(name) = song.name {
            add_override(&mut writes, "track", song_id, "name", &name)?;
            titles.push(SearchTitleWrite {
                entity_type: "song",
                entity_id: song_id.to_string(),
                title: name,
            });
        }
        add!("track", song_id, "artist", song.artist);
        add!(
            "track",
            song_id,
            "contributing_artists",
            song.contributing_artists
        );
        add!(
            "track",
            song_id,
            "contributing_artist_ids",
            song.contributing_artist_ids
        );
        add!("track", song_id, "track_number", song.track_number);
        add!("track", song_id, "path", song.path);
        add!("track", song_id, "duration", song.duration);
    }
    Ok((writes, titles))
}

fn persist_writes(
    connection: &mut diesel::sqlite::SqliteConnection,
    writes: &[OverrideWrite],
    titles: &[SearchTitleWrite],
) -> Result<(), diesel::result::Error> {
    connection.transaction(|connection| {
        for write in writes {
            diesel::sql_query(
                "INSERT INTO metadata_override
                 (entity_type, entity_id, field_name, value_json, updated_at)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(entity_type, entity_id, field_name) DO UPDATE SET
                    value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP",
            )
            .bind::<diesel::sql_types::Text, _>(write.entity_type)
            .bind::<diesel::sql_types::Text, _>(&write.entity_id)
            .bind::<diesel::sql_types::Text, _>(write.field_name)
            .bind::<diesel::sql_types::Text, _>(&write.value_json)
            .execute(connection)?;
        }
        for title in titles {
            diesel::sql_query(
                "UPDATE library_search_document
                 SET title = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE entity_type = ? AND entity_id = ?",
            )
            .bind::<diesel::sql_types::Text, _>(&title.title)
            .bind::<diesel::sql_types::Text, _>(title.entity_type)
            .bind::<diesel::sql_types::Text, _>(&title.entity_id)
            .execute(connection)?;
        }
        Ok(())
    })
}

fn response_album(album: &Album, artist: &Artist) -> ResponseAlbum {
    ResponseAlbum {
        id: album.id.clone(),
        name: album.name.clone(),
        cover_url: album.cover_url.clone(),
        songs: album
            .songs
            .iter()
            .map(|song| response_song(song, album, artist))
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

fn response_song(song: &crate::domain::Song, album: &Album, artist: &Artist) -> ResponseSong {
    ResponseSong {
        id: song.id.clone(),
        name: song.name.clone(),
        artist: song.artist.clone(),
        contributing_artists: song.contributing_artists.clone(),
        contributing_artist_ids: song.contributing_artist_ids.clone(),
        track_number: song.track_number,
        path: song.path.clone(),
        duration: song.duration,
        album_object: crate::api::album_reference(album),
        artist_object: crate::api::artist_reference(artist),
    }
}

fn locate_song(library: &[Artist], song_id: &str) -> Option<(usize, usize, usize)> {
    library
        .iter()
        .enumerate()
        .find_map(|(artist_index, artist)| {
            artist
                .albums
                .iter()
                .enumerate()
                .find_map(|(album_index, album)| {
                    album
                        .songs
                        .iter()
                        .position(|song| song.id == song_id)
                        .map(|song_index| (artist_index, album_index, song_index))
                })
        })
}

fn locate_album(library: &[Artist], album_id: &str) -> Option<(usize, usize)> {
    library
        .iter()
        .enumerate()
        .find_map(|(artist_index, artist)| {
            artist
                .albums
                .iter()
                .position(|album| album.id == album_id)
                .map(|album_index| (artist_index, album_index))
        })
}

async fn commit_metadata_writes(
    pool: &DbPool,
    writes: Vec<OverrideWrite>,
    titles: Vec<SearchTitleWrite>,
) -> Result<(), String> {
    let write_pool = pool.clone();
    web::block(move || -> Result<(), String> {
        let mut connection = write_pool.get().map_err(|error| error.to_string())?;
        persist_writes(&mut connection, &writes, &titles).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn album_cover_destination(album_id: &str) -> std::path::PathBuf {
    let digest = Sha256::digest(album_id.as_bytes());
    let digest = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    get_cover_art_path().join(format!("uploaded-{digest}.jpg"))
}

fn normalized_path(path: &std::path::Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[put("/album/{id}/cover")]
pub async fn upload_album_cover(id: web::Path<String>, mut payload: Multipart) -> HttpResponse {
    let album_id = id.into_inner();
    let library = match fetch_library().await {
        Ok(library) => library,
        Err(error) => return internal_server_error(error.to_string(), "library_load_failed"),
    };
    if locate_album(&library, &album_id).is_none() {
        return not_found("Album not found.", "album_not_found");
    }

    let mut uploaded = None;
    while let Some(item) = payload.next().await {
        let mut field = match item {
            Ok(field) => field,
            Err(_) => return bad_request("The cover upload is invalid.", "album_cover_invalid"),
        };
        if uploaded.is_some() {
            return bad_request("Upload exactly one image.", "album_cover_multiple_files");
        }
        let mut bytes = BytesMut::new();
        while let Some(chunk) = field.next().await {
            let data = match chunk {
                Ok(data) => data,
                Err(_) => {
                    return bad_request("The cover upload is invalid.", "album_cover_invalid");
                }
            };
            if bytes.len().saturating_add(data.len()) > MAX_ALBUM_COVER_BYTES {
                return HttpResponse::PayloadTooLarge().json(serde_json::json!({
                    "error": "album_cover_too_large",
                    "message": "Album covers must be 10 MB or smaller."
                }));
            }
            bytes.extend_from_slice(&data);
        }
        uploaded = Some(bytes.freeze());
    }
    let Some(uploaded) = uploaded else {
        return bad_request("No album cover was provided.", "album_cover_missing");
    };

    let destination = album_cover_destination(&album_id);
    let write_destination = destination.clone();
    let result = web::block(move || -> Result<(), String> {
        let cursor = std::io::Cursor::new(uploaded);
        let mut reader = image::ImageReader::new(cursor)
            .with_guessed_format()
            .map_err(|error| error.to_string())?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(8192);
        limits.max_image_height = Some(8192);
        limits.max_alloc = Some(128 * 1024 * 1024);
        reader.limits(limits);
        let image = reader
            .decode()
            .map_err(|_| "The selected file is not a supported image.".to_string())?
            .thumbnail(1600, 1600);
        let mut encoded = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, 90)
            .encode_image(&image)
            .map_err(|error| error.to_string())?;
        let parent = write_destination
            .parent()
            .ok_or_else(|| "Album cover destination has no parent directory.".to_string())?;
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let temporary =
            write_destination.with_extension(format!("jpg.{}.tmp", uuid::Uuid::new_v4()));
        let backup = write_destination.with_extension("jpg.bak");
        let write_result = (|| -> Result<(), std::io::Error> {
            let mut file = std::fs::File::create(&temporary)?;
            file.write_all(&encoded)?;
            file.sync_all()?;
            if write_destination.exists() {
                let _ = std::fs::remove_file(&backup);
                std::fs::rename(&write_destination, &backup)?;
            }
            if let Err(error) = std::fs::rename(&temporary, &write_destination) {
                if backup.exists() {
                    let _ = std::fs::rename(&backup, &write_destination);
                }
                return Err(error);
            }
            let _ = std::fs::remove_file(&backup);
            Ok(())
        })();
        if write_result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        write_result.map_err(|error| error.to_string())
    })
    .await;

    match result {
        Ok(Ok(())) => HttpResponse::Ok().json(AlbumCoverUploadResponse {
            cover_url: normalized_path(&destination),
        }),
        Ok(Err(error)) if error == "The selected file is not a supported image." => {
            bad_request(error, "album_cover_unsupported")
        }
        Ok(Err(error)) => {
            tracing::error!(%error, album_id, "album cover write failed");
            internal_server_error(
                "Could not store the album cover.",
                "album_cover_write_failed",
            )
        }
        Err(error) => {
            tracing::error!(%error, album_id, "album cover processing failed");
            internal_server_error(
                "Could not process the album cover.",
                "album_cover_process_failed",
            )
        }
    }
}

#[post("/song/{id}")]
pub async fn edit_library_metadata(
    id: web::Path<String>,
    form: web::Json<LibraryMetadataPatch>,
    lifecycle: web::Data<crate::library::state::LibraryLifecycle>,
    pool: web::Data<DbPool>,
) -> HttpResponse {
    let song_id = id.into_inner();
    if !validate_patch(&form) {
        return bad_request(
            "Metadata contains an empty, invalid, or oversized field.",
            "invalid_metadata",
        );
    }
    let library = match fetch_library().await {
        Ok(library) => library,
        Err(error) => return internal_server_error(error.to_string(), "library_load_failed"),
    };
    let Some((artist_index, album_index, _)) = locate_song(&library, &song_id) else {
        return not_found("Song not found.", "song_not_found");
    };
    let artist_id = library[artist_index].id.clone();
    let album_id = library[artist_index].albums[album_index].id.clone();
    let (writes, titles) = match prepare_writes(form.into_inner(), &song_id, &album_id, &artist_id)
    {
        Ok(writes) => writes,
        Err(error) => return internal_server_error(error.to_string(), "metadata_encode_failed"),
    };
    if let Err(error) = commit_metadata_writes(pool.get_ref(), writes, titles).await {
        tracing::error!(%error, "metadata transaction failed");
        return internal_server_error("Metadata update failed.", "metadata_override_failed");
    }

    refresh_cache().await;
    let fresh_cache = match crate::library::state::LibraryCache::new().await {
        Ok(cache) => cache,
        Err(error) => return internal_server_error(error.to_string(), "cache_refresh_failed"),
    };
    lifecycle.set_ready_and_persist(fresh_cache).await;
    let library = match fetch_library().await {
        Ok(library) => library,
        Err(error) => return internal_server_error(error.to_string(), "library_load_failed"),
    };
    let Some((artist_index, album_index, song_index)) = locate_song(&library, &song_id) else {
        return not_found("Song not found.", "song_not_found");
    };
    let artist = &library[artist_index];
    let album = &artist.albums[album_index];
    HttpResponse::Ok().json(LibraryMetadataResponse {
        song: response_song(&album.songs[song_index], album, artist),
        album: response_album(album, artist),
        artist: artist.clone(),
    })
}

#[post("/album/{id}")]
pub async fn edit_album_metadata(
    id: web::Path<String>,
    form: web::Json<LibraryMetadataPatch>,
    lifecycle: web::Data<crate::library::state::LibraryLifecycle>,
    pool: web::Data<DbPool>,
) -> HttpResponse {
    let album_id = id.into_inner();
    if form.song.is_some() || !validate_patch(&form) {
        return bad_request(
            "Album metadata contains an invalid or song-specific field.",
            "invalid_album_metadata",
        );
    }
    let library = match fetch_library().await {
        Ok(library) => library,
        Err(error) => return internal_server_error(error.to_string(), "library_load_failed"),
    };
    let Some((artist_index, album_index)) = locate_album(&library, &album_id) else {
        return not_found("Album not found.", "album_not_found");
    };
    let artist_id = library[artist_index].id.clone();
    let canonical_album_id = library[artist_index].albums[album_index].id.clone();
    let (writes, titles) =
        match prepare_writes(form.into_inner(), "", &canonical_album_id, &artist_id) {
            Ok(writes) => writes,
            Err(error) => {
                return internal_server_error(error.to_string(), "metadata_encode_failed");
            }
        };
    if let Err(error) = commit_metadata_writes(pool.get_ref(), writes, titles).await {
        tracing::error!(%error, "album metadata transaction failed");
        return internal_server_error("Metadata update failed.", "metadata_override_failed");
    }

    refresh_cache().await;
    let fresh_cache = match crate::library::state::LibraryCache::new().await {
        Ok(cache) => cache,
        Err(error) => return internal_server_error(error.to_string(), "cache_refresh_failed"),
    };
    lifecycle.set_ready_and_persist(fresh_cache).await;
    let library = match fetch_library().await {
        Ok(library) => library,
        Err(error) => return internal_server_error(error.to_string(), "library_load_failed"),
    };
    let Some((artist_index, album_index)) = locate_album(&library, &canonical_album_id) else {
        return not_found("Album not found.", "album_not_found");
    };
    let artist = &library[artist_index];
    let album = &artist.albums[album_index];
    HttpResponse::Ok().json(AlbumMetadataResponse {
        album: response_album(album, artist),
        artist: artist.clone(),
    })
}

#[cfg(test)]
mod tests {
    use diesel::connection::SimpleConnection;
    use diesel::{Connection, RunQueryDsl};

    use super::{
        AlbumMetadataPatch, LibraryMetadataPatch, MAX_METADATA_TEXT, OverrideWrite,
        SearchTitleWrite, SongMetadataPatch, album_cover_destination, persist_writes,
        prepare_writes, validate_patch,
    };

    fn song_patch(name: String, duration: f64) -> LibraryMetadataPatch {
        LibraryMetadataPatch {
            song: Some(SongMetadataPatch {
                name: Some(name),
                artist: None,
                contributing_artists: None,
                contributing_artist_ids: None,
                track_number: None,
                path: None,
                duration: Some(duration),
            }),
            album: None,
            artist: None,
        }
    }

    #[test]
    fn metadata_is_bounded_before_database_and_cache_updates() {
        assert!(validate_patch(&song_patch("Track".into(), 180.0)));
        assert!(!validate_patch(&song_patch(" ".into(), 180.0)));
        assert!(!validate_patch(&song_patch(
            "x".repeat(MAX_METADATA_TEXT + 1),
            180.0,
        )));
        assert!(!validate_patch(&song_patch("Track".into(), f64::NAN)));
        assert!(!validate_patch(&song_patch("Track".into(), -1.0)));
    }

    #[test]
    fn album_metadata_writes_target_the_album_without_touching_a_track() {
        let patch = LibraryMetadataPatch {
            song: None,
            album: Some(AlbumMetadataPatch {
                name: Some("New album name".into()),
                cover_url: Some("Folder.jpg".into()),
                first_release_date: None,
                musicbrainz_id: None,
                wikidata_id: None,
                primary_type: None,
                description: None,
                contributing_artists: None,
                contributing_artists_ids: None,
            }),
            artist: None,
        };
        let (writes, titles) =
            prepare_writes(patch, "", "album-1", "artist-1").expect("album writes");

        assert!(writes.iter().all(|write| write.entity_type != "track"));
        assert!(writes.iter().all(|write| write.entity_id == "album-1"));
        assert_eq!(titles.len(), 1);
        assert_eq!(titles[0].entity_type, "album");
        assert_eq!(titles[0].entity_id, "album-1");
    }

    #[test]
    fn uploaded_cover_destination_cannot_escape_managed_storage() {
        let destination = album_cover_destination("../../another/album");
        assert_eq!(
            destination.parent(),
            Some(crate::library::storage::get_cover_art_path().as_path())
        );
        assert_eq!(
            destination.extension().and_then(|value| value.to_str()),
            Some("jpg")
        );
    }

    #[test]
    fn metadata_writes_roll_back_when_search_update_fails() {
        let mut connection =
            diesel::sqlite::SqliteConnection::establish(":memory:").expect("in-memory sqlite");
        connection
            .batch_execute(
                "CREATE TABLE metadata_override (
               entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, field_name TEXT NOT NULL,
               value_json TEXT NOT NULL, updated_at TEXT,
               UNIQUE(entity_type, entity_id, field_name)
             );",
            )
            .expect("metadata table");
        let writes = vec![OverrideWrite {
            entity_type: "track",
            entity_id: "song-1".into(),
            field_name: "name",
            value_json: "\"New name\"".into(),
        }];
        let titles = vec![SearchTitleWrite {
            entity_type: "song",
            entity_id: "song-1".into(),
            title: "New name".into(),
        }];

        assert!(persist_writes(&mut connection, &writes, &titles).is_err());
        let count: i64 = diesel::sql_query("SELECT COUNT(*) AS count FROM metadata_override")
            .load::<CountRow>(&mut connection)
            .expect("count query")[0]
            .count;
        assert_eq!(count, 0);
    }

    #[derive(diesel::deserialize::QueryableByName)]
    struct CountRow {
        #[diesel(sql_type = diesel::sql_types::BigInt)]
        count: i64,
    }
}
