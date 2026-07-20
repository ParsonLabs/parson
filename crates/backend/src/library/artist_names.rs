use regex::Regex;
use std::collections::HashSet;
use std::sync::OnceLock;

fn parentheses_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"\(([^)]+)\)").expect("static artist regex is valid"))
}

fn delimiter_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"(?ix)
            \s+(?:&|featuring|ft\.?|with|feat\.?|and|presents|vs\.?|x)\s+
            |,\s*
            |;
            |\x00",
        )
        .expect("static artist delimiter regex is valid")
    })
}

fn role_credit_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"(?ix)
            \s*[\(\[]?\s*
            (?:mixed|remixed|compiled|presented|hosted|curated|selected|produced)
            \s+by\b.*$",
        )
        .expect("static artist role-credit regex is valid")
    })
}

pub fn format_contributing_artists(artists: &[String]) -> Vec<(String, Vec<String>)> {
    let mut formatted_artists = Vec::with_capacity(artists.len());
    let re_parentheses = parentheses_regex();
    let re_delimiters = delimiter_regex();
    let re_role_credit = role_credit_regex();

    for artist in artists {
        // Ignore DJ/producer credits, including truncated legacy tags.
        let artist = re_role_credit.replace(artist, "");
        // Tags frequently contain repeated tabs or spaces. Keep display names
        // canonical as well as identities so one artist is not rendered with
        // several visually different spellings.
        let artist = artist.split_whitespace().collect::<Vec<_>>().join(" ");
        let artist = artist.as_str();
        let mut main_artist = artist.to_string();
        let mut contributing_artists = Vec::new();

        if let Some(captures) = re_parentheses.captures(artist)
            && let Some(capture) = captures.get(1)
        {
            let inside_parentheses = capture.as_str();
            main_artist = artist
                .replace(&format!("({})", inside_parentheses), "")
                .trim()
                .to_string();
            main_artist = format!("{} {}", main_artist, inside_parentheses)
                .trim()
                .to_string();
        }

        let split_artists = re_delimiters
            .split(&main_artist)
            .map(str::trim)
            .filter(|artist| !artist.is_empty())
            .collect::<Vec<_>>();

        if let Some((main_artist, additional_contributing_artists)) = split_artists.split_first() {
            let main_artist = (*main_artist).to_string();
            let main_artist_lower = main_artist.to_lowercase();
            let additional_contributing_artists: Vec<String> = additional_contributing_artists
                .iter()
                .filter(|artist| artist.to_lowercase() != main_artist_lower)
                .map(|artist| (*artist).to_string())
                .collect();

            contributing_artists.extend(additional_contributing_artists);

            let contributing_artists: HashSet<String> = contributing_artists
                .into_iter()
                .map(|artist| artist.replace("'", "").replace("  ", " "))
                .collect();

            let contributing_artists: Vec<String> = contributing_artists.into_iter().collect();
            formatted_artists.push((main_artist, contributing_artists));
        }
    }

    formatted_artists
}

#[cfg(test)]
mod tests {
    use super::format_contributing_artists;

    fn parsed(value: &str) -> (String, Vec<String>) {
        let mut result = format_contributing_artists(&[value.to_string()]);
        let (main, mut contributors) = result.pop().expect("one parsed artist");
        contributors.sort();
        (main, contributors)
    }

    #[test]
    fn contributor_delimiters_are_case_insensitive_and_trimmed() {
        assert_eq!(
            parsed("Main Artist feat. Guest"),
            ("Main Artist".into(), vec!["Guest".into()])
        );
        assert_eq!(
            parsed("Main Artist, Guest; Third"),
            ("Main Artist".into(), vec!["Guest".into(), "Third".into()])
        );
        assert_eq!(
            parsed("Main Artist FT. Guest"),
            ("Main Artist".into(), vec!["Guest".into()])
        );
        assert_eq!(
            parsed("River Stone vs Morgan_Vale"),
            ("River Stone".into(), vec!["Morgan_Vale".into()])
        );
        assert_eq!(
            parsed("River Stone VS. Morgan Vale"),
            ("River Stone".into(), vec!["Morgan Vale".into()])
        );
    }

    #[test]
    fn release_role_credits_do_not_create_performer_names() {
        assert_eq!(
            parsed("Morgan Vale (Mixed By Bigg"),
            ("Morgan Vale".into(), Vec::new())
        );
        assert_eq!(
            parsed("Artist [Compiled by DJ Example]"),
            ("Artist".into(), Vec::new())
        );
    }

    #[test]
    fn duplicate_main_artists_are_not_returned_as_contributors() {
        assert_eq!(
            parsed("Artist & artist & Guest"),
            ("Artist".into(), vec!["Guest".into()])
        );
    }

    #[test]
    fn apostrophes_are_normalized_in_contributor_names() {
        assert_eq!(
            parsed("Main with D'Angelo"),
            ("Main".into(), vec!["DAngelo".into()])
        );
    }

    #[test]
    fn empty_and_unsplit_inputs_have_predictable_results() {
        assert!(format_contributing_artists(&[String::new()]).is_empty());
        assert_eq!(parsed("Solo Artist"), ("Solo Artist".into(), Vec::new()));
    }

    #[test]
    fn display_names_collapse_repeated_whitespace() {
        assert_eq!(
            parsed("  Primary  \t Artist  feat.   Guest  Artist "),
            ("Primary Artist".into(), vec!["Guest Artist".into()])
        );
    }
}
