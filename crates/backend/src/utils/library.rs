use std::error::Error;
use std::fs::File;
use std::io::Write;
use std::sync::{Arc, Mutex};

use audiotags::Tag;
use lofty::{AudioFile, Probe};
use rayon::prelude::*;
use regex::Regex;
use walkdir::WalkDir;

use crate::structures::structures::{Album, Artist, Song};
use super::format::format_contributing_artists;
use super::hash::{hash_album, hash_artist, hash_song};

pub async fn index_library(path_to_library: &str) -> Result<Arc<Mutex<Vec<Artist>>>, Box<dyn Error>> {
  let library = Arc::new(Mutex::new(Vec::<Artist>::new()));

  let library_clone = Arc::clone(&library);

  let files: Vec<_> = WalkDir::new(&*path_to_library)
  .into_iter()
  .filter_map(|e| e.ok())
  .filter(|e| {
      e.file_type().is_file() &&
      matches!(e.path().extension().and_then(|s| s.to_str()), Some("mp3") | Some("flac") | Some("ogg") | Some("m4a"))
  })
  .collect();

files.par_iter().for_each(|entry| {
  let path = entry.path();
  let tag = match Tag::new().read_from_path(&path) {
      Ok(t) => t,
      Err(_) => return,
  };
  
  let artists = tag.artists().unwrap_or_default().iter().map(|&s| s.to_string()).collect::<Vec<String>>();
  let formatted_artists = format_contributing_artists(artists);
  
  let song_name = tag.title().unwrap_or_default().to_string();
  let artist_name = formatted_artists.get(0).map_or(String::new(), |a| a.0.clone());
  let contributing_artists = formatted_artists.get(0).map_or(Vec::new(), |a| a.1.clone());

      let album_name = tag.album_title().unwrap_or_default().to_string();
      let re = Regex::new(r"\(.*\)").unwrap();
      let album_name_without_cd = re.replace_all(&album_name, "").trim().to_string();
      let track_number = tag.track_number().unwrap_or_default();
      
      let id = hash_song(&song_name, &artist_name, &album_name, track_number);

      let tagged_file = Probe::open(path)
          .expect("ERROR: Bad path provided!")
          .read()
          .expect("ERROR: Failed to read file!");

      let duration = tagged_file.properties().duration().as_secs_f64();

      let song = Song {
            name: song_name,
            id,
            artist: artist_name.clone(),
            contributing_artists,
            track_number,
            path: path.to_str().unwrap().to_string(),
            duration,
            music_video: None,
      };
      
      let mut library = library.lock().unwrap();

      let artist_name_lowercase = artist_name.to_lowercase();
      let artist_position = library.iter().position(|a| a.name.to_lowercase() == artist_name_lowercase);

      let artist = if let Some(artist_position) = artist_position {
          &mut library[artist_position]
      } else {
          let new_artist = Artist { id: hash_artist(&artist_name), name: artist_name.clone(), albums: Vec::new(), icon_url: String::new(), followers: 0, description: String::new(), tadb_music_videos: None };
          library.push(new_artist);
          library.last_mut().unwrap()
      };

    let album_position = artist.albums.iter().position(|a| a.name == album_name_without_cd && a.id == hash_album(&album_name_without_cd.clone(), &artist_name));
    
    let album = if let Some(album_position) = album_position {
        &mut artist.albums[album_position]
    } else {
        let mut new_album = Album {
            id: hash_album(&album_name_without_cd.clone(), &artist_name),
            name: album_name_without_cd.clone(),
            songs: Vec::new(),
            cover_url: String::new(),
            primary_type: String::new(),
            description: String::new(),
            first_release_date: String::new(),
            musicbrainz_id: String::new(),
            wikidata_id: None,
            release_album: None,
            release_group_album: None,
        };
    
        new_album.songs.push(song.clone());
    
        let mut cover_found = false;
    
        if let Ok(tag) = Tag::new().read_from_path(&path) {
            if let Some(picture) = tag.album_cover() {
                let cover_art_path = path.with_extension("jpg");
                let mut file = File::create(&cover_art_path).unwrap();
                file.write_all(picture.data).unwrap();
                new_album.cover_url = cover_art_path.to_str().unwrap().to_string();
                cover_found = true;
            }
        }
    
        // If no cover art found in metadata, check the current folder
        if !cover_found {
            if let Some(parent_path) = path.parent() {
                for image_path in WalkDir::new(parent_path)
                    .max_depth(1)
                    .into_iter()
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        e.file_type().is_file()
                            && matches!(
                                e.path().extension().and_then(|s| s.to_str()),
                                Some("jpg")
                                    | Some("jpeg")
                                    | Some("png")
                                    | Some("gif")
                                    | Some("bmp")
                                    | Some("ico")
                                    | Some("tif")
                                    | Some("tiff")
                                    | Some("webp")
                            )
                    })
                {
                    new_album.cover_url = image_path.path().to_str().unwrap().to_string();
                    cover_found = true;
                    break;
                }
    
                if !cover_found
                    && parent_path.read_dir().unwrap().any(|e| {
                        if let Ok(entry) = e {
                            let path = entry.path();
                            let path_file_name = path.file_name().unwrap().to_str().unwrap();
                            path.is_dir()
                                && (path_file_name.starts_with("CD")
                                    || path_file_name.starts_with("Disc")
                                    || path.file_name().unwrap() == "Covers")
                        } else {
                            false
                        }
                    })
                {
                    if let Some(grandparent_path) = parent_path.parent() {
                        for image_path in WalkDir::new(grandparent_path)
                            .max_depth(1)
                            .into_iter()
                            .filter_map(|e| e.ok())
                            .filter(|e| {
                                e.file_type().is_file()
                                    && matches!(
                                        e.path().extension().and_then(|s| s.to_str()),
                                        Some("jpg")
                                            | Some("jpeg")
                                            | Some("png")
                                            | Some("gif")
                                            | Some("bmp")
                                            | Some("ico")
                                            | Some("tif")
                                            | Some("tiff")
                                            | Some("webp")
                                    )
                            })
                        {
                            new_album.cover_url = image_path.path().to_str().unwrap().to_string();
                            break;
                        }
                    }
                }
            }
        }
    
        artist.albums.push(new_album);
        artist.albums.sort_by(|a, b| a.name.cmp(&b.name));
        artist.albums.last_mut().unwrap()
    };
      
      album.songs.push(song);
      album.songs.sort_by(|a, b| a.track_number.cmp(&b.track_number));
  });
  
  let mut library = library.lock().unwrap();
  library.sort_by(|a, b| a.name.cmp(&b.name));

  Ok(Arc::clone(&library_clone))
}