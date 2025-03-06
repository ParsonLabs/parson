#[cfg(test)]
mod tests {
    use crate::utils::format::format_contributing_artists;

    #[test]
    fn test_single_artist() {
        let artists = vec!["Drake".to_string()];
        let result = format_contributing_artists(artists);
        assert_eq!(result, vec![("Drake".to_string(), vec![])]);
    }

    #[test]
    fn test_featuring_artist() {
        let artists = vec!["Drake featuring The Weeknd".to_string()];
        let result = format_contributing_artists(artists);
        assert_eq!(
            result,
            vec![("Drake".to_string(), vec!["The Weeknd".to_string()])]
        );
    }

    #[test]
    fn test_multiple_featuring_artists() {
        let artists = vec!["Drake featuring The Weeknd & Rihanna".to_string()];
        let result = format_contributing_artists(artists);
        assert_eq!(
            result,
            vec![(
                "Drake".to_string(),
                vec!["The Weeknd".to_string(), "Rihanna".to_string()]
            )]
        );
    }

    #[test]
    fn test_ft_abbreviation() {
        let artists = vec!["Drake ft. Lil Wayne".to_string()];
        let result = format_contributing_artists(artists);
        assert_eq!(
            result,
            vec![("Drake".to_string(), vec!["Lil Wayne".to_string()])]
        );
    }

    #[test]
    fn test_with_conjunction() {
        let artists = vec!["Drake and Future".to_string()];
        let result = format_contributing_artists(artists);
        assert_eq!(
            result,
            vec![("Drake".to_string(), vec!["Future".to_string()])]
        );
    }

    #[test]
    fn test_comma_separated() {
        let artists = vec!["Drake, 21 Savage, Travis Scott".to_string()];
        let result = format_contributing_artists(artists);
        assert_eq!(
            result,
            vec![(
                "Drake".to_string(),
                vec!["21 Savage".to_string(), "Travis Scott".to_string()]
            )]
        );
    }

    #[test]
    fn test_vs_format() {
        let artists = vec!["Eminem vs. Machine Gun Kelly".to_string()];
        let result = format_contributing_artists(artists);
        assert_eq!(
            result,
            vec![("Eminem".to_string(), vec!["Machine Gun Kelly".to_string()])]
        );
    }

    #[test]
    fn test_x_format() {
        let artists = vec!["Metro Boomin x Future".to_string()];
        let result = format_contributing_artists(artists);
        assert_eq!(
            result,
            vec![("Metro Boomin".to_string(), vec!["Future".to_string()])]
        );
    }

    #[test]
    fn test_parentheses() {
        let artists = vec!["Tyler, The Creator (featuring Frank Ocean)".to_string()];
        let result = format_contributing_artists(artists);

        let main_artist = &result[0].0;
        let contributing = &result[0].1;

        assert!(main_artist == "Tyler" || main_artist == "Tyler, The Creator");
        assert!(contributing.contains(&"Frank Ocean".to_string()));
    }

    #[test]
    fn test_multiple_artists() {
        let artists = vec![
            "Drake featuring The Weeknd".to_string(),
            "Kendrick Lamar & SZA".to_string(),
        ];
        let result = format_contributing_artists(artists);
        assert_eq!(
            result,
            vec![
                ("Drake".to_string(), vec!["The Weeknd".to_string()]),
                ("Kendrick Lamar".to_string(), vec!["SZA".to_string()]),
            ]
        );
    }
    #[test]
    fn test_complex_case() {
        let artists = vec!["DJ Khaled feat. Justin Bieber, Chance the Rapper & Quavo".to_string()];
        let result = format_contributing_artists(artists);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].0, "DJ Khaled");

        let mut expected = vec![
            "Justin Bieber".to_string(),
            "Chance the Rapper".to_string(),
            "Quavo".to_string(),
        ];
        expected.sort();

        let mut actual = result[0].1.clone();
        actual.sort();

        assert_eq!(actual, expected);
    }

    #[test]
    fn test_apostrophe_removal() {
        let artists = vec!["Destiny's Child featuring Jay-Z".to_string()];
        let result = format_contributing_artists(artists);

        let main_artist = &result[0].0;

        assert_eq!(main_artist, "Destiny's Child");
        assert_eq!(result[0].1, vec!["Jay-Z".to_string()]);
    }

    #[test]
    fn test_duplicates_removal() {
        let artists = vec!["A$AP Rocky featuring A$AP Ferg & A$AP Ferg".to_string()];
        let result = format_contributing_artists(artists);

        assert_eq!(
            result,
            vec![("A$AP Rocky".to_string(), vec!["A$AP Ferg".to_string()])]
        );
    }

    #[test]
    fn test_mixed_delimiters() {
        let artists = vec!["Travis Scott with Kanye West & Drake".to_string()];
        let result = format_contributing_artists(artists);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].0, "Travis Scott");

        let mut expected = vec!["Kanye West".to_string(), "Drake".to_string()];
        expected.sort();

        let mut actual = result[0].1.clone();
        actual.sort();

        assert_eq!(actual, expected);
    }

    #[test]
    fn test_presents_keyword() {
        let artists = vec!["Calvin Harris presents Rihanna".to_string()];
        let result = format_contributing_artists(artists);
        assert_eq!(
            result,
            vec![("Calvin Harris".to_string(), vec!["Rihanna".to_string()])]
        );
    }

    #[test]
    fn test_empty_input() {
        let artists: Vec<String> = vec![];
        let result = format_contributing_artists(artists);
        assert_eq!(result, vec![]);
    }
}
