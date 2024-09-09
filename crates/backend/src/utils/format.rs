use regex::Regex;

pub fn format_contributing_artists(artists: Vec<String>) -> Vec<(String, Vec<String>)> {
    let re = Regex::new(r"(?i)\b(&|featuring|ft\.?|with|feat\.?|and|presents|,|vs\.?|x)\b")
        .expect("Failed to compile regex");
    

    let mut formatted_artists = Vec::new();

    for artist in &artists {
        let split_artists: Vec<String> = if re.is_match(artist) {
            re.split(artist)
                .map(|s| {
                    let trimmed = s.trim().to_string();
                    trimmed
                })
                .collect()
        } else {
            artist.split(',')
                .map(|s| {
                    let trimmed = s.trim().to_string();
                    trimmed
                })
                .collect()
        };

        if let Some((main_artist, contributing_artists)) = split_artists.split_first() {
            formatted_artists.push((main_artist.to_string(), contributing_artists.to_vec()));
        }
    }

    formatted_artists
}