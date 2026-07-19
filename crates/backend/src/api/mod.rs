pub mod album;
pub mod artist;
pub mod auth;
pub mod cast;
pub mod error;
pub mod filesystem;
pub mod genres;
pub mod home;
pub mod image;
pub mod library;
pub mod lyrics;
pub mod metadata;
pub mod playback;
pub mod playlist;
pub mod search;
pub mod setup;
pub mod song;
pub mod user;

use crate::domain::{Album, Artist};

/// Converts entities to bounded nested references.
pub(crate) fn artist_reference(artist: &Artist) -> Artist {
    Artist {
        id: artist.id.clone(),
        name: artist.name.clone(),
        icon_url: artist.icon_url.clone(),
        followers: artist.followers,
        albums: Vec::new(),
        featured_on_album_ids: artist.featured_on_album_ids.clone(),
        description: artist.description.clone(),
    }
}

pub(crate) fn album_reference(album: &Album) -> Album {
    Album {
        id: album.id.clone(),
        name: album.name.clone(),
        cover_url: album.cover_url.clone(),
        songs: Vec::new(),
        first_release_date: album.first_release_date.clone(),
        musicbrainz_id: album.musicbrainz_id.clone(),
        wikidata_id: album.wikidata_id.clone(),
        primary_type: album.primary_type.clone(),
        description: album.description.clone(),
        contributing_artists: album.contributing_artists.clone(),
        contributing_artists_ids: album.contributing_artists_ids.clone(),
        release_album: album.release_album.clone(),
        release_group_album: album.release_group_album.clone(),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LookupError;

impl std::fmt::Display for LookupError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("library entity not found")
    }
}

impl std::error::Error for LookupError {}
