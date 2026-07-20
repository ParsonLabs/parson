use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

use regex::Regex;

use crate::domain::{Album, Artist};

const RELEASE_TYPES: [&str; 13] = [
    "Album",
    "Edition",
    "EP",
    "Single",
    "Remix",
    "Compilation",
    "Live",
    "Demos & Rarities",
    "Bootleg",
    "Soundtrack",
    "Promotional",
    "Acapella",
    "Bonus Audio",
];

static TRAILING_QUALIFIER: OnceLock<Regex> = OnceLock::new();
static PLAIN_VARIANT_SUFFIX: OnceLock<Regex> = OnceLock::new();
static TRAILING_RELEASE_YEAR: OnceLock<Regex> = OnceLock::new();
static TRAILING_DISC_SUFFIX: OnceLock<Regex> = OnceLock::new();

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReleaseVariantKind {
    Deluxe,
    Anniversary,
    Remaster,
    Expanded,
    Special,
    Collector,
    Limited,
    Legacy,
    Reissue,
    Regional,
    Format,
    Disc,
    Bonus,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct ReleaseTitleAnalysis {
    pub original_title: String,
    pub display_title: String,
    pub canonical_title: String,
    pub qualifiers: Vec<String>,
    pub variant_kinds: Vec<ReleaseVariantKind>,
    pub is_edition: bool,
}

pub fn edition_primary_type(analysis: &ReleaseTitleAnalysis) -> String {
    let label = [
        (ReleaseVariantKind::Deluxe, "Deluxe Edition"),
        (ReleaseVariantKind::Anniversary, "Anniversary Edition"),
        (ReleaseVariantKind::Remaster, "Remastered Edition"),
        (ReleaseVariantKind::Expanded, "Expanded Edition"),
        (ReleaseVariantKind::Special, "Special Edition"),
        (ReleaseVariantKind::Collector, "Collector's Edition"),
        (ReleaseVariantKind::Limited, "Limited Edition"),
        (ReleaseVariantKind::Legacy, "Legacy Edition"),
        (ReleaseVariantKind::Reissue, "Reissue Edition"),
        (ReleaseVariantKind::Regional, "Regional Edition"),
        (ReleaseVariantKind::Format, "Format Edition"),
        (ReleaseVariantKind::Bonus, "Bonus Edition"),
    ]
    .into_iter()
    .find(|(kind, _)| analysis.variant_kinds.contains(kind))
    .map(|(_, label)| label)
    .unwrap_or("Edition");

    label.to_string()
}

pub fn is_edition_primary_type(primary_type: &str) -> bool {
    let primary_type = primary_type.trim().to_ascii_lowercase();
    primary_type == "edition" || primary_type.ends_with(" edition")
}

#[derive(Clone, Debug, Serialize)]
pub struct ClassificationScore {
    pub release_type: String,
    pub score: i32,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReleaseClassification {
    pub primary_type: String,
    pub confidence: f32,
    pub scores: Vec<ClassificationScore>,
    pub evidence: Vec<String>,
}

pub fn analyze_release_title(title: &str) -> ReleaseTitleAnalysis {
    let original = title.trim();
    let trailing = TRAILING_QUALIFIER.get_or_init(|| {
        Regex::new(r"(?x)\s*(?:[-–—:]\s*)?[\(\[]\s*([^\(\)\[\]]+)\s*[\)\]]\s*$")
            .expect("trailing qualifier regex should compile")
    });
    let plain = PLAIN_VARIANT_SUFFIX.get_or_init(|| {
        Regex::new(r"(?ix)(?:(?P<separator>\s*[-–—:]+\s*)|\s+)(?P<qualifier>(?:the\s+)?(?:(?:\d+(?:st|nd|rd|th)\s+)?anniversary|super\s+deluxe|digital\s+deluxe|deluxe|expanded|(?:\d{4}\s+)?(?:mono\s+|stereo\s+)?remaster(?:ed)?|special|collector'?s?|limited|legacy|definitive|tour|international|japanese|japan|uk|us|mono|stereo|reissue)(?:\s+(?:edition|version|release|remaster))?)\s*$")
            .expect("plain variant suffix regex should compile")
    });
    let disc_suffix = TRAILING_DISC_SUFFIX.get_or_init(|| {
        Regex::new(
            r"(?ix)\s*(?:[-:]\s*)?(?:[\(\[]\s*)?((?:cd|disc|disk)\s*\d+(?:\s*(?:of|/)\s*\d+)?)(?:\s*[\)\]])?\s*$",
        )
        .expect("trailing disc suffix regex should compile")
    });
    let mut display = original.to_string();
    let mut qualifiers = Vec::new();
    let mut kinds = Vec::new();

    while let Some(captures) = disc_suffix.captures(&display) {
        let whole = captures.get(0).expect("whole disc suffix capture");
        if whole.start() == 0 {
            break;
        }
        let qualifier = captures
            .get(1)
            .map(|value| value.as_str().trim())
            .unwrap_or_default();
        qualifiers.insert(0, qualifier.to_string());
        if !kinds.contains(&ReleaseVariantKind::Disc) {
            kinds.insert(0, ReleaseVariantKind::Disc);
        }
        display.truncate(whole.start());
        display = trim_title_separator(&display).to_string();
    }

    let mut base = display.clone();

    while let Some(captures) = trailing.captures(&base) {
        let qualifier = captures
            .get(1)
            .map(|value| value.as_str().trim())
            .unwrap_or_default();
        let detected = variant_kinds(qualifier);
        if detected.is_empty() {
            break;
        }
        let whole = captures.get(0).expect("whole qualifier capture");
        qualifiers.insert(0, qualifier.to_string());
        for kind in detected.into_iter().rev() {
            if !kinds.contains(&kind) {
                kinds.insert(0, kind);
            }
        }
        base.truncate(whole.start());
        base = trim_title_separator(&base).to_string();
    }

    if kinds
        .iter()
        .all(|kind| matches!(kind, ReleaseVariantKind::Disc))
        && let Some(captures) = plain.captures(&base)
    {
        let qualifier = captures
            .name("qualifier")
            .map(|value| value.as_str().trim())
            .unwrap_or_default();
        let detected = variant_kinds(qualifier);
        let explicitly_separated = captures.name("separator").is_some();
        if !detected.is_empty() && (explicitly_separated || is_unambiguous_plain_variant(qualifier))
        {
            let whole = captures.get(0).expect("whole plain qualifier capture");
            qualifiers.insert(0, qualifier.to_string());
            for kind in detected {
                if !kinds.contains(&kind) {
                    kinds.push(kind);
                }
            }
            base.truncate(whole.start());
            base = trim_title_separator(&base).to_string();
            base = strip_trailing_release_year(&base).to_string();
        }
    }

    ReleaseTitleAnalysis {
        original_title: original.to_string(),
        display_title: if display.is_empty() {
            original.to_string()
        } else {
            display
        },
        canonical_title: if base.is_empty() {
            original.to_string()
        } else {
            base
        },
        qualifiers,
        is_edition: kinds
            .iter()
            .any(|kind| !matches!(kind, ReleaseVariantKind::Disc)),
        variant_kinds: kinds,
    }
}

fn is_unambiguous_plain_variant(value: &str) -> bool {
    let value = searchable(value);
    [
        "anniversary",
        "deluxe",
        "edition",
        "expanded",
        "reissue",
        "release",
        "remaster",
        "remastered",
        "version",
    ]
    .iter()
    .any(|marker| value.split_whitespace().any(|word| word == *marker))
}

fn strip_trailing_release_year(value: &str) -> &str {
    let pattern = TRAILING_RELEASE_YEAR.get_or_init(|| {
        Regex::new(r"(?x)\s*[-:]\s*(?:19|20)\d{2}\s*$")
            .expect("trailing release year regex should compile")
    });
    pattern
        .find(value)
        .filter(|matched| matched.start() > 0)
        .map_or(value, |matched| value[..matched.start()].trim())
}

fn trim_title_separator(value: &str) -> &str {
    value.trim().trim_end_matches(['-', '–', '—', ':']).trim()
}

fn variant_kinds(value: &str) -> Vec<ReleaseVariantKind> {
    let text = searchable(value);
    let rules: &[(ReleaseVariantKind, &[&str])] = &[
        (ReleaseVariantKind::Deluxe, &["deluxe", "super deluxe"]),
        (ReleaseVariantKind::Anniversary, &["anniversary"]),
        (ReleaseVariantKind::Remaster, &["remaster", "remastered"]),
        (
            ReleaseVariantKind::Expanded,
            &["expanded", "extended edition"],
        ),
        (
            ReleaseVariantKind::Special,
            &["special edition", "definitive edition"],
        ),
        (
            ReleaseVariantKind::Collector,
            &[
                "collector edition",
                "collectors edition",
                "collector s edition",
            ],
        ),
        (ReleaseVariantKind::Limited, &["limited edition"]),
        (ReleaseVariantKind::Legacy, &["legacy edition"]),
        (
            ReleaseVariantKind::Reissue,
            &[
                "reissue",
                "re release",
                "press",
                "pressed",
                "pressing",
                "first press",
                "original press",
            ],
        ),
        (
            ReleaseVariantKind::Regional,
            &[
                "japanese edition",
                "japan edition",
                "uk edition",
                "us edition",
                "international edition",
                "japanese",
                "japan",
                "uk",
                "us",
                "eu",
                "european",
                "german",
                "germany",
            ],
        ),
        (
            ReleaseVariantKind::Format,
            &[
                "mono",
                "stereo",
                "vinyl edition",
                "digital edition",
                "hd version",
            ],
        ),
        (
            ReleaseVariantKind::Disc,
            &["disc 1", "disc 2", "cd 1", "cd 2", "disk 1", "disk 2"],
        ),
        (
            ReleaseVariantKind::Bonus,
            &[
                "bonus track",
                "bonus tracks",
                "bonus edition",
                "tour edition",
            ],
        ),
    ];
    rules
        .iter()
        .filter(|(_, terms)| matches_phrase(&text, terms))
        .map(|(kind, _)| kind.clone())
        .collect()
}

#[cfg(test)]
pub(crate) fn edition_base_title(title: &str) -> Option<String> {
    let analysis = analyze_release_title(title);
    analysis.is_edition.then_some(analysis.canonical_title)
}

pub struct ReleaseEvidence<'a> {
    pub album_name: &'a str,
    pub album_artist: &'a str,
    pub paths: &'a [String],
    pub track_titles: &'a [String],
    pub track_durations: &'a [f64],
    pub genres: &'a [String],
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct LibraryIndexWarning {
    pub path: String,
    pub message: String,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct LibraryIndexReport {
    pub scanned_files: usize,
    pub indexed_files: usize,
    pub skipped_files: usize,
    /// Total warnings observed. `warnings` only retains a bounded sample.
    pub warning_count: usize,
    pub warnings: Vec<LibraryIndexWarning>,
    pub timing: LibraryIndexTiming,
}

#[derive(Clone, Copy, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LibraryIndexRunKind {
    Cold,
    #[default]
    Warm,
    Incremental,
}

impl LibraryIndexRunKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cold => "cold",
            Self::Warm => "warm",
            Self::Incremental => "incremental",
        }
    }

    pub(crate) fn for_scan(had_snapshots: bool, indexed_files: usize) -> Self {
        if !had_snapshots {
            Self::Cold
        } else if indexed_files == 0 {
            Self::Warm
        } else {
            Self::Incremental
        }
    }
}

/// Wall-clock library scan timings in microseconds.
#[derive(Clone, Debug, Default, Serialize)]
pub struct LibraryIndexTiming {
    pub run_kind: LibraryIndexRunKind,
    pub enumeration_us: u64,
    /// Metadata parsing wall time.
    pub parsing_wall_us: u64,
    pub parsing_enumeration_overlap_us: u64,
    pub parsing_enumeration_overlap_percent: u8,
    pub parsing_database_overlap_us: u64,
    pub parsing_database_overlap_percent: u8,
    pub bytes_read: u64,
    pub bytes_read_p50: u64,
    pub bytes_read_p95: u64,
    pub file_opens: u64,
    pub metadata_operations: u64,
    pub read_calls: u64,
    pub seeks: u64,
    pub parser_fallbacks: u64,
    pub parser_threads: usize,
    pub storage_queue_depth: usize,
    pub cpu_time_us: u64,
    pub cpu_utilization_percent: f64,
    pub unchanged_detection_us: u64,
    pub cover_discovery_us: u64,
    pub tag_parsing_us: u64,
    pub duration_us: u64,
    pub files_requiring_frame_scans: usize,
    pub database_staging_us: u64,
    pub database_commit_us: u64,
    pub normalization_inference_us: u64,
    pub full_library_export_us: u64,
    /// Asynchronous snapshot duration emitted by the database worker.
    pub snapshot_integrity_us: Option<u64>,
    pub explained_wall_us: u64,
    pub explained_wall_percent: f64,
    pub unattributed_wall_us: u64,
    pub total_us: u64,
}

/// Keeps the API read model deterministic after it is projected from the normalized graph.
pub fn normalize_library_data(library: &mut Vec<Artist>) {
    library.sort_by_key(|left| left.name.to_lowercase());

    for artist in library {
        for album in &mut artist.albums {
            let title = analyze_release_title(&album.name);
            album.name = title.display_title.clone();
            if title.is_edition && album.primary_type.eq_ignore_ascii_case("edition") {
                album.primary_type = edition_primary_type(&title);
            }
            dedupe_and_sort_album_songs(album);
            if album.primary_type.trim().is_empty() {
                album.primary_type = classify_release_type(album);
            }
        }
        artist.albums.sort_by_key(|left| left.name.to_lowercase());
    }
}

pub fn dedupe_and_sort_album_songs(album: &mut Album) {
    album.songs.sort_by(|left, right| {
        left.track_number
            .cmp(&right.track_number)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    album.songs.dedup_by(|left, right| left.id == right.id);
}

pub fn classify_release_type(album: &Album) -> String {
    let paths = album
        .songs
        .iter()
        .map(|song| song.path.clone())
        .collect::<Vec<_>>();
    let track_titles = album
        .songs
        .iter()
        .map(|song| song.name.clone())
        .collect::<Vec<_>>();
    classify_release(&ReleaseEvidence {
        album_name: &album.name,
        album_artist: "",
        paths: &paths,
        track_titles: &track_titles,
        track_durations: &album
            .songs
            .iter()
            .map(|song| song.duration)
            .collect::<Vec<_>>(),
        genres: &[],
    })
}

pub fn classify_release(evidence: &ReleaseEvidence<'_>) -> String {
    classify_release_details(evidence).primary_type
}

pub fn classify_release_details(evidence: &ReleaseEvidence<'_>) -> ReleaseClassification {
    let mut scores = [0_i32; RELEASE_TYPES.len()];
    let mut reasons = Vec::new();
    // Packaging-only disc suffixes are not semantic release evidence. Classify the
    // user-facing title that remains after those suffixes are removed.
    let album = searchable(&analyze_release_title(evidence.album_name).display_title);
    let artist = searchable(evidence.album_artist);
    let path = evidence
        .paths
        .iter()
        .map(|value| searchable(value))
        .collect::<Vec<_>>()
        .join(" ");
    let track_count = evidence.track_titles.len();
    let total_duration = evidence
        .track_durations
        .iter()
        .copied()
        .filter(|duration| duration.is_finite() && *duration > 0.0)
        .sum::<f64>();
    let has_complete_duration = track_count > 0
        && evidence
            .track_durations
            .iter()
            .filter(|duration| duration.is_finite() && **duration > 0.0)
            .count()
            == track_count;
    let genres = evidence
        .genres
        .iter()
        .map(|value| searchable(value))
        .collect::<Vec<_>>()
        .join(" ");

    score_path_categories(&path, &mut scores);
    score_album_name(&album, &mut scores);

    if matches_phrase(&genres, &["soundtrack", "film score", "original score"]) {
        add(&mut scores, "Soundtrack", 220);
        reasons.push("embedded genre tags identify a soundtrack".to_string());
    }

    score_release_folder_markers(evidence.paths, &mut scores, &mut reasons);

    for (release_type, phrases) in [
        ("Soundtrack", &["soundtrack albums", "soundtracks"][..]),
        ("Compilation", &["compilation albums", "compilations"][..]),
        ("Remix", &["remix albums", "remixes"][..]),
        ("Live", &["live albums", "live recordings"][..]),
        ("Single", &["single albums", "singles"][..]),
        ("Bootleg", &["bootleg albums", "bootlegs", "mixtapes"][..]),
        ("Acapella", &["acapella", "acapellas", "a cappella"][..]),
        ("Bonus Audio", &["bonus audio", "instrumentals"][..]),
        ("EP", &["eps", "extended plays"][..]),
        ("Album", &["studio albums"][..]),
    ] {
        if matches_phrase(&path, phrases) {
            reasons.push(format!("folder hierarchy identifies {release_type}"));
        }
    }

    if matches_phrase(&artist, &["various artists", "various", "va"]) {
        add(&mut scores, "Compilation", 70);
        reasons.push("album artist indicates a multi-artist release".to_string());
    }

    let remix_tracks = matching_tracks(evidence.track_titles, REMIX_TERMS);
    let live_tracks = matching_tracks(evidence.track_titles, LIVE_TERMS);
    let rarity_tracks = matching_tracks(evidence.track_titles, RARITY_TERMS);
    let acapella_tracks = matching_tracks(evidence.track_titles, ACAPELLA_TERMS);
    let bonus_tracks = matching_tracks(evidence.track_titles, BONUS_TERMS);
    score_track_share(&mut scores, "Remix", remix_tracks, track_count, 150);
    score_track_share(&mut scores, "Live", live_tracks, track_count, 55);
    score_track_share(
        &mut scores,
        "Demos & Rarities",
        rarity_tracks,
        track_count,
        60,
    );
    score_track_share(&mut scores, "Acapella", acapella_tracks, track_count, 60);
    score_track_share(&mut scores, "Bonus Audio", bonus_tracks, track_count, 300);
    for (release_type, count) in [
        ("remix", remix_tracks),
        ("live", live_tracks),
        ("rarity", rarity_tracks),
        ("acapella", acapella_tracks),
        ("bonus-audio", bonus_tracks),
    ] {
        if count > 0 {
            reasons.push(format!(
                "{count}/{track_count} track titles contain {release_type} markers"
            ));
        }
    }

    if track_count > 0 && track_count <= 3 {
        let has_non_single_evidence = title_implies_non_single(&album)
            || score_for(&scores, "Soundtrack") >= 200
            || score_for(&scores, "Promotional") >= 150
            || score_for(&scores, "Bootleg") >= 150;
        if has_complete_duration && total_duration >= 1_800.0 {
            add(&mut scores, "Album", 180);
            reasons.push("runtime exceeds thirty minutes despite a short track list".to_string());
        } else {
            add(
                &mut scores,
                "Single",
                if has_non_single_evidence { 30 } else { 280 },
            );
        }
    } else if track_count > 0 && track_count <= 7 {
        if has_complete_duration {
            if total_duration >= 1_800.0 {
                add(&mut scores, "Album", 180);
                reasons.push("runtime exceeds thirty minutes".to_string());
            } else {
                add(&mut scores, "EP", 90);
                reasons.push("four-to-seven tracks run for less than thirty minutes".to_string());
            }
        } else {
            add(&mut scores, "EP", 12);
        }
        let sole_base_title = sole_base_track_title(evidence.track_titles);
        if sole_base_title.as_deref() == Some(album.as_str()) && remix_tracks * 2 <= track_count {
            add(&mut scores, "Single", 300);
            reasons.push("all tracks are versions of the title recording".to_string());
        } else if remix_tracks * 2 >= track_count && sole_base_title.is_some() {
            // Several mixes of one lead recording are still a single release.
            add(&mut scores, "Single", 120);
            reasons.push("all short-release variants share one lead recording".to_string());
        } else if evidence
            .track_titles
            .iter()
            .any(|title| base_track_title(title) == album)
        {
            add(&mut scores, "Single", 120);
            reasons.push("a compact release is named for its lead recording".to_string());
        }
    } else {
        add(&mut scores, "Album", 40);
    }
    if track_count > 24 && score_for(&scores, "Single") >= 100 {
        add(&mut scores, "Compilation", 130);
    }

    let mut ranked = RELEASE_TYPES
        .iter()
        .enumerate()
        .map(|(index, release_type)| ClassificationScore {
            release_type: (*release_type).to_string(),
            score: scores[index],
        })
        .collect::<Vec<_>>();
    ranked.sort_by_key(|entry| std::cmp::Reverse(entry.score));
    let winner = ranked.first().cloned().unwrap_or(ClassificationScore {
        release_type: "Album".to_string(),
        score: 0,
    });
    let runner_up = ranked.get(1).map(|score| score.score).unwrap_or_default();
    let margin = (winner.score - runner_up).max(0) as f32;
    let support = winner.score.max(0) as f32;
    let confidence = ((margin / 100.0) * 0.65 + (support / 240.0) * 0.35).clamp(0.05, 1.0);
    ReleaseClassification {
        primary_type: winner.release_type,
        confidence,
        scores: ranked,
        evidence: reasons,
    }
}

const REMIX_TERMS: &[&str] = &[
    "remix",
    "remixed",
    "remixes",
    "mix",
    "club mix",
    "dance mix",
    "dub",
    "rework",
    "mashup",
];
const REMIX_TITLE_TERMS: &[&str] = &[
    "remix",
    "remixed",
    "remixes",
    "mix",
    "mixed masters",
    "mixed by",
    "megamix",
    "mashup",
    "rework",
];
const LIVE_TERMS: &[&str] = &["live", "concert", "unplugged", "live at", "live in"];
const RARITY_TERMS: &[&str] = &[
    "demo",
    "demos",
    "rarity",
    "rarities",
    "rarites",
    "raritaten",
    "raritäten",
    "unreleased",
    "alternate",
    "outtake",
];
const ACAPELLA_TERMS: &[&str] = &["acapella", "acapellas", "a cappella"];
const BONUS_TERMS: &[&str] = &["instrumental", "karaoke", "slowed", "reverb", "sped up"];

fn score_path_categories(path: &str, scores: &mut [i32; RELEASE_TYPES.len()]) {
    let categories = [
        ("Soundtrack", &["soundtrack albums", "soundtracks"][..]),
        ("Compilation", &["compilation albums", "compilations"][..]),
        ("Remix", &["remix albums", "remixes", "remix"][..]),
        ("Live", &["live albums", "live recordings"][..]),
        ("Single", &["single albums", "singles"][..]),
        ("Bootleg", &["bootleg albums", "bootlegs", "mixtapes"][..]),
        ("Demos & Rarities", &["demos and rarities", "rarities"][..]),
        ("Acapella", &["acapella", "acapellas", "a cappella"][..]),
        ("Bonus Audio", &["bonus audio", "instrumentals"][..]),
        ("EP", &["eps", "extended plays"][..]),
        ("Album", &["studio albums"][..]),
    ];
    for (release_type, phrases) in categories {
        if matches_phrase(path, phrases) {
            add(
                scores,
                release_type,
                if release_type == "Bootleg" { 180 } else { 120 },
            );
        }
    }
    if matches_phrase(
        path,
        &[
            "deluxe edition",
            "deluxe version",
            "special edition",
            "anniversary edition",
        ],
    ) {
        add(scores, "Album", 50);
    }
}

fn score_release_folder_markers(
    paths: &[String],
    scores: &mut [i32; RELEASE_TYPES.len()],
    reasons: &mut Vec<String>,
) {
    let release_folders = paths
        .iter()
        .filter_map(|path| {
            let path = std::path::Path::new(path);
            let is_audio_file = path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    ["mp3", "flac", "ogg", "m4a", "opus", "wav", "aac", "aiff"]
                        .contains(&extension.to_ascii_lowercase().as_str())
                });
            let directory = if is_audio_file {
                path.parent().unwrap_or(path)
            } else {
                path
            };
            directory.file_name()
        })
        .filter_map(|name| name.to_str())
        .map(searchable)
        .collect::<Vec<_>>()
        .join(" ");
    if matches_phrase(
        &release_folders,
        &["bootleg", "mixtape", "unofficial release"],
    ) {
        add(scores, "Bootleg", 190);
        reasons.push("the release folder explicitly identifies unofficial media".to_string());
    }
    if looks_like_presentation_disc(&release_folders)
        || matches_phrase(&release_folders, &["promotional sampler", "promo sampler"])
    {
        add(scores, "Promotional", 190);
        reasons.push("the release folder identifies promotional media".to_string());
    }
    if matches_phrase(&release_folders, &["ep", "extended play"]) {
        add(scores, "EP", 180);
        reasons.push("the release folder explicitly identifies an EP".to_string());
    }
    for (release_type, markers) in [
        ("Live", &["live", "concert"] as &[_]),
        ("Remix", &["remix", "remixes"] as &[_]),
        (
            "Soundtrack",
            &["soundtrack", "ost", "original score"] as &[_],
        ),
        (
            "Demos & Rarities",
            &["demo", "demos", "rarities", "outtakes"] as &[_],
        ),
        ("Single", &["single", "cd single", "maxi single"] as &[_]),
        ("Compilation", &["compilation", "anthology"] as &[_]),
    ] {
        if matches_phrase(&release_folders, markers) {
            add(scores, release_type, 180);
            reasons.push(format!(
                "the release folder explicitly identifies {release_type}"
            ));
        }
    }
}

fn score_album_name(album: &str, scores: &mut [i32; RELEASE_TYPES.len()]) {
    let rules = [
        (
            "Soundtrack",
            &[
                "soundtrack",
                "motion picture",
                "original score",
                "music from and inspired by",
                "ost",
            ][..],
            220,
        ),
        (
            "Compilation",
            &[
                "greatest hits",
                "best of",
                "anthology",
                "singles collection",
                "collection",
                "essential",
                "tribute",
                "retrospective",
            ][..],
            160,
        ),
        (
            "Compilation",
            &[
                "promo only",
                "various artists compilation",
                "dj compilation",
            ][..],
            500,
        ),
        (
            "Promotional",
            &["presentation disc", "promotional sampler", "promo sampler"][..],
            190,
        ),
        (
            "EP",
            &["dvd bonus audio", "dvd companion", "companion ep"][..],
            300,
        ),
        ("Live", LIVE_TERMS, 230),
        ("Remix", REMIX_TITLE_TERMS, 220),
        ("Demos & Rarities", RARITY_TERMS, 220),
        ("Acapella", ACAPELLA_TERMS, 75),
        (
            "Bootleg",
            &["bootleg", "mixtape", "unofficial release"][..],
            80,
        ),
        ("Bonus Audio", BONUS_TERMS, 75),
        ("Single", &["single", "maxi single", "cd single"][..], 180),
        ("EP", &["ep", "extended play"][..], 65),
    ];
    for (release_type, terms, score) in rules {
        if matches_phrase(album, terms) {
            add(scores, release_type, score);
        }
    }
    if looks_like_presentation_disc(album) {
        add(scores, "Promotional", 190);
    }
}

fn looks_like_presentation_disc(value: &str) -> bool {
    matches_phrase(value, &["presentation disc"])
        || (matches_phrase(value, &["disc"])
            && value
                .split_whitespace()
                .any(|word| one_edit_apart(word, "presentation")))
}

fn one_edit_apart(left: &str, right: &str) -> bool {
    let left = left.chars().collect::<Vec<_>>();
    let right = right.chars().collect::<Vec<_>>();
    if left.len().abs_diff(right.len()) > 1 {
        return false;
    }
    let (shorter, longer) = if left.len() <= right.len() {
        (&left, &right)
    } else {
        (&right, &left)
    };
    let mut short_index = 0;
    let mut long_index = 0;
    let mut edits = 0;
    while short_index < shorter.len() && long_index < longer.len() {
        if shorter[short_index] == longer[long_index] {
            short_index += 1;
            long_index += 1;
        } else {
            edits += 1;
            if edits > 1 {
                return false;
            }
            if shorter.len() == longer.len() {
                short_index += 1;
            }
            long_index += 1;
        }
    }
    edits + usize::from(long_index < longer.len()) <= 1
}

fn title_implies_non_single(album: &str) -> bool {
    matches_phrase(album, REMIX_TITLE_TERMS)
        || matches_phrase(album, LIVE_TERMS)
        || matches_phrase(album, RARITY_TERMS)
        || matches_phrase(album, ACAPELLA_TERMS)
        || matches_phrase(
            album,
            &[
                "soundtrack",
                "motion picture",
                "original score",
                "music from and inspired by",
                "ost",
            ],
        )
        || matches_phrase(
            album,
            &[
                "greatest hits",
                "best of",
                "anthology",
                "singles collection",
                "collection",
                "essential",
                "tribute",
                "retrospective",
                "promo only",
                "various artists compilation",
                "dj compilation",
            ],
        )
        || matches_phrase(
            album,
            &[
                "bootleg",
                "mixtape",
                "unofficial release",
                "presentation disc",
                "promotional sampler",
                "promo sampler",
            ],
        )
}

fn matching_tracks(titles: &[String], terms: &[&str]) -> usize {
    titles
        .iter()
        .filter(|title| matches_phrase(&searchable(title), terms))
        .count()
}

fn sole_base_track_title(titles: &[String]) -> Option<String> {
    let titles = titles
        .iter()
        .map(|title| base_track_title(title))
        .collect::<std::collections::HashSet<_>>();
    (titles.len() == 1).then(|| titles.into_iter().next().unwrap_or_default())
}

fn base_track_title(title: &str) -> String {
    let before_qualifier = title.split(['(', '[']).next().unwrap_or(title).trim();
    searchable(before_qualifier)
}

fn score_track_share(
    scores: &mut [i32; RELEASE_TYPES.len()],
    release_type: &str,
    matching: usize,
    total: usize,
    maximum: i32,
) {
    if total == 0 || matching == 0 {
        return;
    }
    let share = matching as f64 / total as f64;
    if share >= 0.5 {
        add(scores, release_type, maximum);
    } else if matching >= 3 && share >= 0.25 {
        add(scores, release_type, maximum / 2);
    }
}

fn searchable(value: &str) -> String {
    let normalized = value
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>();
    format!(
        " {} ",
        normalized.split_whitespace().collect::<Vec<_>>().join(" ")
    )
}

fn matches_phrase(value: &str, phrases: &[&str]) -> bool {
    phrases
        .iter()
        .any(|phrase| value.contains(&searchable(phrase)))
}

fn add(scores: &mut [i32; RELEASE_TYPES.len()], release_type: &str, score: i32) {
    if let Some(index) = RELEASE_TYPES
        .iter()
        .position(|candidate| *candidate == release_type)
    {
        scores[index] += score;
    }
}

fn score_for(scores: &[i32; RELEASE_TYPES.len()], release_type: &str) -> i32 {
    RELEASE_TYPES
        .iter()
        .position(|candidate| *candidate == release_type)
        .map(|index| scores[index])
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use crate::domain::{Album, Artist};

    use super::{
        LibraryIndexRunKind, LibraryIndexTiming, ReleaseEvidence, ReleaseVariantKind,
        analyze_release_title, classify_release, edition_base_title, edition_primary_type,
        is_edition_primary_type, normalize_library_data,
    };

    #[test]
    fn scan_timing_serializes_stable_production_field_names() {
        let timing = LibraryIndexTiming {
            run_kind: LibraryIndexRunKind::Incremental,
            enumeration_us: 11,
            files_requiring_frame_scans: 2,
            total_us: 99,
            ..LibraryIndexTiming::default()
        };
        let value = serde_json::to_value(timing).expect("serialize scan timing");
        assert_eq!(value["run_kind"], "incremental");
        assert_eq!(value["enumeration_us"], 11);
        assert_eq!(value["files_requiring_frame_scans"], 2);
        assert_eq!(value["total_us"], 99);
        assert!(value.get("database_commit_us").is_some());
        assert!(value.get("snapshot_integrity_us").is_some());
    }

    #[test]
    fn scan_run_kind_distinguishes_cold_warm_and_incremental_runs() {
        assert_eq!(
            LibraryIndexRunKind::for_scan(false, 10),
            LibraryIndexRunKind::Cold
        );
        assert_eq!(
            LibraryIndexRunKind::for_scan(true, 0),
            LibraryIndexRunKind::Warm
        );
        assert_eq!(
            LibraryIndexRunKind::for_scan(true, 1),
            LibraryIndexRunKind::Incremental
        );
    }

    #[test]
    fn extracts_common_edition_suffixes_without_touching_normal_titles() {
        assert_eq!(
            edition_base_title("Night Signal (Deluxe Version)").as_deref(),
            Some("Night Signal")
        );
        assert_eq!(
            edition_base_title("Second Wind - (Special Edition)").as_deref(),
            Some("Second Wind")
        );
        assert_eq!(
            edition_base_title("First Light [25th Anniversary Edition]").as_deref(),
            Some("First Light")
        );
        assert_eq!(edition_base_title("Within the Harbor"), None);
    }

    #[test]
    fn preserves_release_variants_but_removes_disc_packaging_from_display() {
        let deluxe = analyze_release_title("Night Signal (Deluxe Version)");
        assert_eq!(deluxe.display_title, "Night Signal (Deluxe Version)");
        assert_eq!(deluxe.canonical_title, "Night Signal");
        assert!(deluxe.is_edition);

        let multidisc = analyze_release_title(
            "Archive Past, Present and Future (Volume I) (Uncut Release) CD1",
        );
        assert_eq!(
            multidisc.display_title,
            "Archive Past, Present and Future (Volume I) (Uncut Release)"
        );
        assert_eq!(multidisc.canonical_title, multidisc.display_title);
        assert!(!multidisc.is_edition);
        assert_eq!(multidisc.variant_kinds, vec![ReleaseVariantKind::Disc]);

        let stacked = analyze_release_title("Night Signal (Deluxe Version) [Disc 2 of 2]");
        assert_eq!(stacked.display_title, "Night Signal (Deluxe Version)");
        assert_eq!(stacked.canonical_title, "Night Signal");
        assert!(stacked.is_edition);
        assert!(stacked.variant_kinds.contains(&ReleaseVariantKind::Deluxe));
        assert!(stacked.variant_kinds.contains(&ReleaseVariantKind::Disc));
    }

    #[test]
    fn edition_types_keep_the_useful_variant_name() {
        assert_eq!(
            edition_primary_type(&analyze_release_title("Night Signal (Deluxe Version)")),
            "Deluxe Edition"
        );
        assert_eq!(
            edition_primary_type(&analyze_release_title("Open Circuit (Special Edition)")),
            "Special Edition"
        );
        assert_eq!(
            edition_primary_type(&analyze_release_title(
                "First Light [25th Anniversary Edition]"
            )),
            "Anniversary Edition"
        );
        assert!(is_edition_primary_type("Collector's Edition"));
        assert!(!is_edition_primary_type("Album"));
    }

    #[test]
    fn extracts_pressing_qualifiers_found_in_real_libraries() {
        assert_eq!(
            edition_base_title("Harbor Echoes [1st Press UK]").as_deref(),
            Some("Harbor Echoes")
        );
        assert_eq!(
            edition_base_title("Coastal Letters [1st Press UK]").as_deref(),
            Some("Coastal Letters")
        );
        assert_eq!(
            edition_base_title("Long Promise [1st pressed US Mastered by Harbor Sound]").as_deref(),
            Some("Long Promise")
        );
    }

    #[test]
    fn library_presentation_keeps_release_variant_titles_visible() {
        let mut library = vec![Artist {
            name: "Rowan Miles".into(),
            albums: vec![
                Album {
                    name: "Harbor Echoes [1st Press UK]".into(),
                    ..Album::default()
                },
                Album {
                    name: "Night Signal (Deluxe Version)".into(),
                    ..Album::default()
                },
                Album {
                    name: "Within the Harbor".into(),
                    ..Album::default()
                },
            ],
            ..Artist::default()
        }];

        normalize_library_data(&mut library);

        let names = library[0]
            .albums
            .iter()
            .map(|album| album.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            [
                "Harbor Echoes [1st Press UK]",
                "Night Signal (Deluxe Version)",
                "Within the Harbor"
            ]
        );
    }

    #[test]
    fn parses_broad_and_stacked_release_qualifiers() {
        let cases = [
            (
                "Harbor Stories (Super Deluxe Edition)",
                "Harbor Stories",
                ReleaseVariantKind::Deluxe,
            ),
            (
                "Azure Line [40th Anniversary Remaster]",
                "Azure Line",
                ReleaseVariantKind::Anniversary,
            ),
            (
                "A Kind of Azure - Legacy Edition",
                "A Kind of Azure",
                ReleaseVariantKind::Legacy,
            ),
            (
                "Homestead (Japanese Edition) (Bonus Tracks)",
                "Homestead",
                ReleaseVariantKind::Regional,
            ),
            (
                "Coastal Sounds: 2016 Stereo Remaster",
                "Coastal Sounds",
                ReleaseVariantKind::Remaster,
            ),
            (
                "The Harbor Is Quiet (Collector's Edition)",
                "The Harbor Is Quiet",
                ReleaseVariantKind::Collector,
            ),
            (
                "Violet Weather [Expanded Edition]",
                "Violet Weather",
                ReleaseVariantKind::Expanded,
            ),
            (
                "Night Signal Digital Deluxe Version",
                "Night Signal",
                ReleaseVariantKind::Deluxe,
            ),
        ];
        for (title, expected_base, expected_kind) in cases {
            let parsed = analyze_release_title(title);
            assert_eq!(parsed.canonical_title, expected_base, "{title}");
            assert!(parsed.is_edition, "{title}");
            assert!(
                parsed.variant_kinds.contains(&expected_kind),
                "{title}: {:?}",
                parsed.variant_kinds
            );
        }
    }

    #[test]
    fn preserves_semantic_parentheticals_and_incidental_words() {
        for title in [
            "Songs in the Key of Dawn",
            "Live Beyond This",
            "The Remix",
            "In the District",
            "The Gallery (Original Motion Picture Soundtrack)",
            "Selected Ambient Studies 85-92",
            "Open Circuit",
            "Focus",
            "Collector",
            "Special",
        ] {
            let parsed = analyze_release_title(title);
            assert_eq!(parsed.canonical_title, title, "{title}");
            assert!(!parsed.is_edition, "{title}");
        }
    }

    #[test]
    fn bare_region_words_in_real_titles_are_not_mistaken_for_editions() {
        for title in [
            "Made at Dawn",
            "Maiden Voyage",
            "Unleashed at Dusk - Live Session",
            "This Window Is Too Small for Both of Us",
            "Winter Is Coming for Us",
            "The Season Is Here",
        ] {
            let parsed = analyze_release_title(title);
            assert_eq!(parsed.display_title, title, "{title}");
            assert_eq!(parsed.canonical_title, title, "{title}");
            assert!(!parsed.is_edition, "{title}");
        }
    }

    #[test]
    fn article_prefixed_remasters_keep_the_complete_display_title() {
        let parsed = analyze_release_title("Ready for Dawn: The Remaster");
        assert_eq!(parsed.display_title, "Ready for Dawn: The Remaster");
        assert_eq!(parsed.canonical_title, "Ready for Dawn");
        assert_eq!(parsed.qualifiers, ["The Remaster"]);
        assert!(parsed.is_edition);
        assert!(parsed.variant_kinds.contains(&ReleaseVariantKind::Remaster));
    }

    fn classify(album: &str, artist: &str, path: &str, tracks: &[&str]) -> String {
        classify_with_genres(album, artist, path, tracks, &[])
    }

    fn classify_with_genres(
        album: &str,
        artist: &str,
        path: &str,
        tracks: &[&str],
        genres: &[&str],
    ) -> String {
        let paths = tracks.iter().map(|_| path.to_string()).collect::<Vec<_>>();
        let titles = tracks
            .iter()
            .map(|title| (*title).to_string())
            .collect::<Vec<_>>();
        let genres = genres
            .iter()
            .map(|genre| (*genre).to_string())
            .collect::<Vec<_>>();
        classify_release(&ReleaseEvidence {
            album_name: album,
            album_artist: artist,
            paths: &paths,
            track_titles: &titles,
            track_durations: &[],
            genres: &genres,
        })
    }

    fn classify_with_durations(album: &str, durations: &[f64]) -> String {
        let titles = (1..=durations.len())
            .map(|index| format!("Track {index}"))
            .collect::<Vec<_>>();
        classify_release(&ReleaseEvidence {
            album_name: album,
            album_artist: "Example Artist",
            paths: &[],
            track_titles: &titles,
            track_durations: durations,
            genres: &[],
        })
    }

    #[test]
    fn runtime_disambiguates_short_track_lists_without_catalog_exceptions() {
        assert_eq!(
            classify_with_durations("Long Form Work", &[620.0, 590.0, 610.0, 605.0]),
            "Album"
        );
        assert_eq!(
            classify_with_durations("Compact Release", &[210.0, 205.0, 220.0, 215.0]),
            "EP"
        );
        assert_eq!(
            classify_with_durations("Two Part Suite", &[920.0, 910.0]),
            "Album"
        );
    }

    #[test]
    fn categorical_folder_context_is_authoritative() {
        assert_eq!(
            classify(
                "Avery Lane Collection",
                "Avery Lane",
                "C:/Music/Avery Lane/02. Compilation Albums/(2005) Avery Lane Collection/01.mp3",
                &["First Signal", "Try Once More", "Northern Light"],
            ),
            "Compilation"
        );
        assert_eq!(
            classify(
                "Live Archive Tour",
                "Morgan Vale",
                "C:/Music/Morgan Vale/4 Live albums/Live Archive Tour/01.mp3",
                &["Pulse", "Morning Line", "Keep Time"],
            ),
            "Live"
        );
    }

    #[test]
    fn a_few_bonus_remixes_do_not_reclassify_a_deluxe_album() {
        let mut tracks = vec!["Harbor Lights"; 12];
        tracks.extend(["Harbor Lights (Club Mix)", "Harbor Lights (Vocal Remix)"]);
        assert_eq!(
            classify(
                "Twin Horizons (Deluxe)",
                "Casey Rivers",
                "C:/Music/Twin Horizons Deluxe/01.mp3",
                &tracks,
            ),
            "Album"
        );
    }

    #[test]
    fn track_makeup_identifies_remix_collections_without_folder_help() {
        assert_eq!(
            classify(
                "Shifting Tides",
                "Jordan Hale",
                "C:/Music/Shifting Tides/01.flac",
                &[
                    "Shifting Tides (Club Mix)",
                    "Shifting Tides (Dub)",
                    "Shifting Tides (Radio Remix)",
                    "Shifting Tides (Rework)",
                ],
            ),
            "Remix"
        );
    }

    #[test]
    fn explicit_demo_title_beats_a_misleading_compilation_folder() {
        assert_eq!(
            classify(
                "Archive Sessions (Demo Version)",
                "Example Artist",
                "C:/Music/Example Artist/2 Compilation albums/Archive Sessions Demo/01.mp3",
                &[
                    "Prototype One",
                    "Prototype Two",
                    "Prototype Three (Alternate Version)",
                    "Prototype Four",
                    "Prototype Five",
                    "Prototype Six",
                    "Prototype Seven",
                    "Prototype Eight",
                ],
            ),
            "Demos & Rarities"
        );
    }

    #[test]
    fn explicit_remix_content_beats_a_bootleg_storage_folder() {
        assert_eq!(
            classify(
                "Synthetic Remix Collection",
                "Example Artist",
                "C:/Music/Example Artist/6 Bootleg albums/Synthetic Remix Collection/01.mp3",
                &[
                    "Example One (Extended Remix)",
                    "Example Two (Remix)",
                    "Example Three (Extended Dance Remix)",
                    "Example Four (Club Remix)",
                    "Example Five (House Mix)",
                    "Example Six (Radio Remix)",
                    "Example Seven (Late Mix)",
                    "Example Eight (Club Mix)",
                ],
            ),
            "Remix"
        );
    }

    #[test]
    fn release_specific_evidence_beats_a_broad_parent_folder() {
        assert_eq!(
            classify(
                "Unauthorized Club Session",
                "Artist",
                "C:/Music/Artist/3 Remix/Unauthorized Club Session (Bootleg)/01.mp3",
                &["First Hit", "Second Hit", "Third Hit", "Fourth Hit"],
            ),
            "Bootleg"
        );
        assert_eq!(
            classify(
                "Archive (Special pesentation disc)",
                "Artist",
                "C:/Music/Artist/3 Remix/Archive (Promo. Special pesentation disc)/01.mp3",
                &["Album Track", "Radio Edit", "Video Version"],
            ),
            "Promotional"
        );
    }

    #[test]
    fn embedded_soundtrack_genre_beats_a_compilation_storage_folder() {
        assert_eq!(
            classify_with_genres(
                "Imaginary Planet Story",
                "Narrator",
                "C:/Music/Narrator/2 Compilation albums/Story Record/01.mp3",
                &["Opening Theme", "Landing and Discovery", "Closing Theme"],
                &["Soundtrack"],
            ),
            "Soundtrack"
        );
    }

    #[test]
    fn explicit_release_semantics_override_misfiled_parent_categories() {
        assert_eq!(
            classify(
                "The Artist MixDisc 2",
                "Artist",
                "C:/Music/Artist/5 Single albums/The Artist Mix/01.mp3",
                &["Dance Mix 1", "Dance Mix 2"],
            ),
            "Remix"
        );
        assert_eq!(
            classify(
                "Artist Mixed Masters",
                "Artist",
                "C:/Music/Artist/5 Single albums/Artist Mixed Masters/01.mp3",
                &["Song (Long Version)", "Another Song (Part 1)"],
            ),
            "Remix"
        );
        assert_eq!(
            classify(
                "Promo Only Club Beats - November 07",
                "Artist",
                "C:/Music/Artist/3 Remix/Unofficial Remix/01.mp3",
                &["Hit Song (Club Remix)"],
            ),
            "Compilation"
        );
        assert_eq!(
            classify(
                "Tour Souvenir CD Single",
                "Artist",
                "C:/Music/Artist/2 Compilation albums/Tour Souvenir Pack/01.mp3",
                &["Track"; 17],
            ),
            "Single"
        );
    }

    #[test]
    fn short_plain_releases_remain_singles_but_mix_bundles_use_track_makeup() {
        assert_eq!(
            classify(
                "Lead Song",
                "Artist",
                "C:/Music/Artist/3 Remix/Lead Song Remix/01.mp3",
                &["Lead Song (Club Remix)"],
            ),
            "Remix"
        );
        assert_eq!(
            classify(
                "Downtown Sessions",
                "Artist",
                "C:/Music/Artist/5 Single albums/Downtown Sessions/01.mp3",
                &[
                    "Lead Song (Radio Edit)",
                    "Lead Song (Jazzy Mix)",
                    "Lead Song (Video Mix)",
                    "Second Song (Sub Mix)",
                ],
            ),
            "Remix"
        );
        assert_eq!(
            classify(
                "Lead Song",
                "Artist",
                "C:/Music/Artist/5 Single albums/Lead Song/01.mp3",
                &[
                    "Lead Song (Album Version)",
                    "Lead Song (Club Mix)",
                    "Lead Song (Radio Remix)",
                    "Lead Song (Dub Mix)",
                    "Lead Song (Extended Mix)",
                ],
            ),
            "Single"
        );
    }

    #[test]
    fn title_version_packages_are_singles_and_dvd_companions_are_eps() {
        assert_eq!(
            classify(
                "Lead Song",
                "Artist",
                "C:/Music/Artist/Lead Song/01.flac",
                &[
                    "Lead Song",
                    "Lead Song",
                    "Lead Song (Guest Remix Radio Edit)",
                    "Lead Song (Club Radio Edit)",
                    "Lead Song (Extended Version)",
                ],
            ),
            "Single"
        );
        assert_eq!(
            classify(
                "Tour Film DVD Bonus Audio",
                "Artist",
                "C:/Music/Artist/Tour Film DVD Bonus Audio/01.flac",
                &["New Song", "Second Song", "Live Extra"],
            ),
            "EP"
        );
    }

    #[test]
    fn short_mix_bundle_is_recognized_from_track_titles() {
        assert_eq!(
            classify(
                "Crystal Current",
                "Aster Vale",
                "C:/Music/Aster Vale/Crystal Current/01.flac",
                &[
                    "Crystal Current (Radio Edit)",
                    "Crystal Current (Extended Version)",
                    "Northbound (Harbor Rhythm Mix)",
                    "Northbound (Main Mix)",
                ],
            ),
            "Remix"
        );
    }

    #[test]
    fn acapella_collection_has_its_own_category_without_folder_help() {
        let tracks = (0..44)
            .map(|index| format!("Archive Track {index} (Acapella)"))
            .collect::<Vec<_>>();
        let track_refs = tracks.iter().map(String::as_str).collect::<Vec<_>>();

        assert_eq!(
            classify(
                "The Vocal Archive",
                "Aster Vale",
                "C:/Music/Aster Vale/The Vocal Archive/01.flac",
                &track_refs,
            ),
            "Acapella"
        );
    }

    #[test]
    fn instrumental_collection_remains_bonus_audio() {
        assert_eq!(
            classify(
                "Studio Extras",
                "Aster Vale",
                "C:/Music/Aster Vale/Studio Extras/01.flac",
                &[
                    "Crystal Current (Instrumental)",
                    "Northbound (Instrumental)",
                    "Coastal Light (Instrumental)",
                ],
            ),
            "Bonus Audio"
        );
    }

    #[test]
    fn boundaries_prevent_incidental_substring_matches() {
        assert_eq!(
            classify(
                "Mixed Emotions",
                "Artist",
                "C:/Music/Mixed Emotions/01.flac",
                &[
                    "Mixture",
                    "Livewire",
                    "Singlehanded",
                    "Demolition",
                    "Album Track 5"
                ],
            ),
            "EP"
        );
    }

    #[test]
    fn short_releases_fall_back_to_single_then_ep() {
        assert_eq!(
            classify("Release", "Artist", "C:/Music/Release/01.flac", &["A", "B"]),
            "Single"
        );
        assert_eq!(
            classify(
                "Release",
                "Artist",
                "C:/Music/Release/01.flac",
                &["A", "B", "C", "D", "E"],
            ),
            "EP"
        );
    }
}
