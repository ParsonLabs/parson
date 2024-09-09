use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rayon::iter::IntoParallelRefIterator;
use rayon::prelude::*;

use crate::structures::structures::{Album, Artist, Song};
use crate::utils::config::get_config;

fn flatten_data(library: &[Artist]) -> (HashMap<String, Song>, HashMap<String, ModifiedAlbum>, HashMap<String, Artist>) {
  let flat_songs = Arc::new(Mutex::new(HashMap::new()));
  let flat_albums = Arc::new(Mutex::new(HashMap::new()));
  let flat_artists = Arc::new(Mutex::new(HashMap::new()));

  library.par_iter().for_each(|artist| {
      let mut artists = flat_artists.lock().unwrap();
      artists.insert(artist.id.clone(), artist.clone());
      drop(artists);
      for album in &artist.albums {
          let mut albums = flat_albums.lock().unwrap();
          albums.insert(album.id.clone(), ModifiedAlbum{
              album: album.clone(),
              artist_name: artist.name.clone(),
              artist_id: artist.id.clone()
          });
          drop(albums);
          for song in &album.songs {
              let mut songs = flat_songs.lock().unwrap();
              songs.insert(song.id.clone(), song.clone());
              drop(songs);
          }
      }
  });

  let songs_clone = flat_songs.lock().unwrap().clone();
  let albums_clone = flat_albums.lock().unwrap().clone();
  let artists_clone = flat_artists.lock().unwrap().clone();

  (songs_clone, albums_clone, artists_clone)
}

fn find_new_artist_entries(
  current_artists: &HashMap<String, Artist>, 
  new_artists: &HashMap<String, Artist>,
) -> Vec<Artist> {
  new_artists
    .iter()
    .filter(|(id, _)| !current_artists.contains_key(*id))
    .map(|(_, artist)| artist.clone())
    .collect()
}

fn find_new_album_entries(
  current_albums: &HashMap<String, ModifiedAlbum>, 
  new_albums: &HashMap<String, ModifiedAlbum>,
) -> Vec<ModifiedAlbum> {
  new_albums
    .iter()
    .filter(|(id, _)| !current_albums.contains_key(*id))
    .map(|(_, album)| album.clone())
    .collect()
}

fn find_new_song_entries(
  current_songs: &HashMap<String, Song>, 
  new_songs: &HashMap<String, Song>,
) -> Vec<Song> {
  new_songs
    .iter()
    .filter(|(id, _)| !current_songs.contains_key(*id))
    .map(|(_, song)| song.clone())
    .collect()
}

#[derive(Clone)]
pub struct ModifiedAlbum {
  pub album: Album,
  pub artist_name: String,
  pub artist_id: String
}

pub async fn compare(library: &Arc<Mutex<Vec<Artist>>>) -> Result<(Vec<Artist>, Vec<ModifiedAlbum>, Vec<Song>), &'static str> {
  let current_library = match get_config().await {
    Ok(config) => config,
    Err(_) => return Err("Failed to get config because there's no config"),
  };


  let current_library: Vec<Artist> = match serde_json::from_str(&current_library) {
    Ok(library) => library,
    Err(_) => return Err("Failed to parse config"),
  };


  let library_guard = library.lock().unwrap();

  let new_library: Vec<Artist> = (*library_guard.to_owned()).to_vec();

  let (current_songs, current_albums, current_artists) = flatten_data(&current_library);
  let (new_songs, new_albums, new_artists) = flatten_data(&new_library);

  let new_artist_entries = find_new_artist_entries(&current_artists, &new_artists);
  let new_album_entries = find_new_album_entries(&current_albums, &new_albums);
  let new_song_entries = find_new_song_entries(&current_songs, &new_songs);

  Ok((new_artist_entries, new_album_entries, new_song_entries))
}