use std::sync::OnceLock;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use regex::Regex;
use sha2::{Digest, Sha256};

static TRAILING_DISC_REGEX: OnceLock<Regex> = OnceLock::new();
static BRACKETED_DISC_REGEX: OnceLock<Regex> = OnceLock::new();

pub fn normalize_artist_identity(name: &str) -> String {
    let normalized = normalize_identity_text(name);
    if matches!(normalized.as_str(), "va" | "v a" | "various") {
        "various artists".to_string()
    } else {
        normalized
    }
}

pub fn normalize_album_identity(name: &str) -> String {
    let without_bracketed_disc = BRACKETED_DISC_REGEX
        .get_or_init(|| {
            Regex::new(r"(?i)\s*[\[\(]\s*(?:cd|disc|disk)\s*\d+\s*(?:of\s*\d+)?\s*[\]\)]\s*$")
                .expect("album bracketed disc regex should compile")
        })
        .replace_all(name, "");

    let without_trailing_disc = TRAILING_DISC_REGEX
        .get_or_init(|| {
            Regex::new(r"(?i)\s*(?:-|:)?\s*(?:cd|disc|disk)\s*\d+\s*(?:of\s*\d+)?\s*$")
                .expect("album trailing disc regex should compile")
        })
        .replace_all(&without_bracketed_disc, "");

    let normalized = normalize_identity_text(&without_trailing_disc);
    if normalized.is_empty() {
        // Keep packaging-only titles such as "CD1" distinct from empty titles.
        normalize_identity_text(name)
    } else {
        normalized
    }
}

pub fn normalize_song_identity(name: &str) -> String {
    normalize_identity_text(name)
}

fn normalize_identity_text(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());

    for ch in value.chars() {
        let replacement = match ch {
            '&' => " and ",
            '+' => " plus ",
            '=' => " equals ",
            '×' => " multiply ",
            '÷' => " divide ",
            '’' | '‘' | '`' | '\'' => "",
            '/' | '\\' | '-' | '_' | '.' | ',' | ':' | ';' | '!' | '?' | '(' | ')' | '[' | ']'
            | '{' | '}' | '"' => " ",
            _ if ch.is_alphanumeric() => {
                normalized.extend(ch.to_lowercase());
                continue;
            }
            _ if ch.is_whitespace() => " ",
            _ => " ",
        };
        normalized.push_str(replacement);
    }

    let normalized = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() && !value.trim().is_empty() {
        // Encode punctuation-only titles as stable code points.
        let symbols = value
            .chars()
            .filter(|character| !character.is_whitespace())
            .map(|character| format!("u{:x}", character as u32))
            .collect::<Vec<_>>()
            .join("_");
        format!("symbol_{symbols}")
    } else {
        normalized
    }
}

const ID_BYTES: usize = 12;

fn stable_id(namespace: &str, parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(namespace.as_bytes());
    for part in parts {
        hasher.update([0]);
        hasher.update(part.as_bytes());
    }
    let digest = hasher.finalize();
    URL_SAFE_NO_PAD.encode(&digest[..ID_BYTES])
}

pub fn hash_artist(name: &str) -> String {
    hash_normalized_artist(&normalize_artist_identity(name))
}

pub fn hash_normalized_artist(normalized_name: &str) -> String {
    stable_id("artist", &[normalized_name])
}

pub fn hash_song(name: &str, artist: &str, album: &str, track_number: u16) -> String {
    hash_normalized_song(
        &normalize_song_identity(name),
        &normalize_artist_identity(artist),
        &normalize_album_identity(album),
        track_number,
    )
}

pub fn hash_normalized_song(
    normalized_name: &str,
    normalized_artist: &str,
    normalized_album: &str,
    track_number: u16,
) -> String {
    let track_number = track_number.to_string();
    stable_id(
        "track",
        &[
            normalized_name,
            normalized_artist,
            normalized_album,
            &track_number,
        ],
    )
}

pub fn hash_album(name: &str, artist: &str) -> String {
    hash_normalized_album(
        &normalize_album_identity(name),
        &normalize_artist_identity(artist),
    )
}

pub fn hash_normalized_album(normalized_name: &str, normalized_artist: &str) -> String {
    stable_id("album", &[normalized_name, normalized_artist])
}

#[cfg(test)]
mod tests {
    use super::{hash_album, hash_artist, hash_song, normalize_album_identity};

    #[test]
    fn artist_hash_is_stable_for_same_name() {
        let artist = "Signal Harbor".to_string();

        assert_eq!(hash_artist(&artist), hash_artist(&artist));
        assert_eq!(hash_artist(&artist).len(), 16);
        assert!(!hash_artist(&artist).contains(':'));
    }

    #[test]
    fn artist_hash_changes_when_name_changes() {
        let signal_harbor = "Signal Harbor".to_string();
        let coast_line = "Coast Line".to_string();

        assert_ne!(hash_artist(&signal_harbor), hash_artist(&coast_line));
    }

    #[test]
    fn artist_hash_treats_va_as_various_artists() {
        let shorthand = "VA".to_string();
        let full = "Various Artists".to_string();

        assert_eq!(hash_artist(&shorthand), hash_artist(&full));
    }

    #[test]
    fn song_hash_includes_track_number() {
        let song = "Every Signal Aligned".to_string();
        let artist = "Signal Harbor".to_string();
        let album = "North Room".to_string();

        assert_ne!(
            hash_song(&song, &artist, &album, 1),
            hash_song(&song, &artist, &album, 2)
        );
    }

    #[test]
    fn song_hash_ignores_album_identity_variants() {
        let song = "Pulse".to_string();
        let artist = "Morgan Vale".to_string();
        let first_album = "Open Circuit".to_string();
        let second_album = "Open Circuit [Disc 1]".to_string();

        assert_eq!(
            hash_song(&song, &artist, &first_album, 1),
            hash_song(&song, &artist, &second_album, 1)
        );
    }

    #[test]
    fn album_hash_includes_artist_name() {
        let album = "Archive Collection".to_string();
        let first_artist = "Artist One".to_string();
        let second_artist = "Artist Two".to_string();

        assert_ne!(
            hash_album(&album, &first_artist),
            hash_album(&album, &second_artist)
        );
    }

    #[test]
    fn album_hash_ignores_slash_spacing_variants() {
        let artist = "Casey Rivers".to_string();
        let first = "Future Light / Harbor Sound".to_string();
        let second = "Future Light/Harbor Sound".to_string();

        assert_eq!(hash_album(&first, &artist), hash_album(&second, &artist));
    }

    #[test]
    fn album_identity_ignores_trailing_disc_suffixes() {
        assert_eq!(
            normalize_album_identity("Archive Past, Present and Future CD1"),
            normalize_album_identity("Archive Past, Present and Future CD2")
        );
        assert_eq!(
            normalize_album_identity("The Archive Collection [Disc 1]"),
            normalize_album_identity("The Archive Collection")
        );
    }

    #[test]
    fn symbolic_album_titles_never_share_an_empty_identity() {
        let plus = normalize_album_identity("+");
        let equals = normalize_album_identity("=");
        let divide = normalize_album_identity("÷");
        let ellipsis = normalize_album_identity("...");
        let disc_only = normalize_album_identity("CD1");

        assert_eq!(plus, "plus");
        assert_eq!(equals, "equals");
        assert_eq!(divide, "divide");
        assert_eq!(ellipsis, "symbol_u2e_u2e_u2e");
        assert_eq!(disc_only, "cd1");
        assert_eq!(
            [plus, equals, divide, ellipsis, disc_only]
                .into_iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            5
        );
    }
}
