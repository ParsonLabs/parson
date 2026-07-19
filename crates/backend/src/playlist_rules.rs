pub(crate) const MAX_PLAYLISTS: i64 = 1_000;
pub(crate) const MAX_TRACKS_PER_PLAYLIST: i64 = 5_000;
pub(crate) const MAX_PLAYLIST_NAME_CHARACTERS: usize = 200;
#[cfg(feature = "server")]
pub(crate) const MAX_PLAYLIST_DESCRIPTION_CHARACTERS: usize = 5_000;
#[cfg(feature = "server")]
pub(crate) const MAX_COVER_IMAGE_CHARACTERS: usize = 2_048;
pub(crate) const MAX_SONG_ID_CHARACTERS: usize = 256;

pub(crate) fn valid_optional_text(value: Option<&str>, maximum: usize, allow_empty: bool) -> bool {
    value.is_none_or(|value| {
        (allow_empty || !value.trim().is_empty()) && value.chars().count() <= maximum
    })
}

pub(crate) fn valid_song_id(value: &str) -> bool {
    !value.is_empty() && value.chars().count() <= MAX_SONG_ID_CHARACTERS
}

#[cfg(test)]
mod tests {
    use super::{MAX_SONG_ID_CHARACTERS, valid_optional_text, valid_song_id};

    #[test]
    fn optional_text_distinguishes_absent_empty_and_blank_values() {
        assert!(valid_optional_text(None, 10, false));
        assert!(valid_optional_text(Some(""), 10, true));
        assert!(valid_optional_text(Some("   "), 10, true));
        assert!(!valid_optional_text(Some(""), 10, false));
        assert!(!valid_optional_text(Some("   "), 10, false));
    }

    #[test]
    fn optional_text_limits_unicode_by_characters_not_utf8_bytes() {
        assert!(valid_optional_text(Some("\u{00e9}\u{00e9}"), 2, false));
        assert!(!valid_optional_text(
            Some("\u{00e9}\u{00e9}\u{00e9}"),
            2,
            false
        ));
    }

    #[test]
    fn song_ids_are_nonempty_and_character_bounded() {
        assert!(!valid_song_id(""));
        assert!(valid_song_id(&"\u{00e9}".repeat(MAX_SONG_ID_CHARACTERS)));
        assert!(!valid_song_id(
            &"\u{00e9}".repeat(MAX_SONG_ID_CHARACTERS + 1)
        ));
    }
}
