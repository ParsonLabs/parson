use std::collections::HashSet;
use regex::Regex;

pub fn format_contributing_artists(artists: Vec<String>) -> Vec<(String, Vec<String>)> {
    let delimiters = vec![
        " & ", " featuring ", " ft. ", " with ", " feat. ", " and ", " presents ", ", ", " vs. ", " x ", "X", ";", "\0"
    ];

    let mut formatted_artists = Vec::new();

    for artist in &artists {
        let mut main_artist = artist.clone();
        let mut contributing_artists = Vec::new();

        let re_parentheses = Regex::new(r"\(([^)]+)\)").unwrap();
        if let Some(captures) = re_parentheses.captures(&artist) {
            let inside_parentheses = captures.get(1).unwrap().as_str();
            main_artist = artist.replace(&format!("({})", inside_parentheses), "").trim().to_string();
            main_artist = format!("{} {}", main_artist, inside_parentheses).trim().to_string();
        }

        let mut split_artists = vec![main_artist.clone()];
        for delimiter in &delimiters {
            let re = Regex::new(&format!(r"(?i)\b{}\b", regex::escape(delimiter))).unwrap();
            let mut temp_split = Vec::new();
            for part in split_artists {
                let parts: Vec<String> = re.split(&part)
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                temp_split.extend(parts);
            }
            split_artists = temp_split;
        }

        if let Some((main_artist, additional_contributing_artists)) = split_artists.split_first() {
            let main_artist = main_artist.to_string();
            let additional_contributing_artists: Vec<String> = additional_contributing_artists.iter()
                .flat_map(|artist| {
                    delimiters.iter().fold(vec![artist.clone()], |acc, delim| {
                        let re = Regex::new(&format!(r"(?i)\b{}\b", regex::escape(delim))).unwrap();
                        acc.into_iter().flat_map(|s| re.split(&s).map(|s| s.trim().to_string()).collect::<Vec<_>>()).collect()
                    })
                })
                .filter(|artist| !artist.is_empty() && artist.to_lowercase() != main_artist.to_lowercase())
                .collect();

            contributing_artists.extend(additional_contributing_artists);

            let contributing_artists: HashSet<String> = contributing_artists.into_iter().map(|artist| {
                artist.replace("'", "").replace("  ", " ")
            }).collect();

            let contributing_artists: Vec<String> = contributing_artists.into_iter().collect();
            formatted_artists.push((main_artist, contributing_artists));
        }
    }

    formatted_artists
}