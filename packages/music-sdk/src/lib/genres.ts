import axios from './axios';
import { Album, Artist } from './types';

/**
 * Get all genres.
 * @returns {Promise<string[]>} - A promise that resolves to the list of genres.
 */
export async function listAllGenres(): Promise<string[]> {
  const response = await axios.get('/genres/list');
  return response.data;
}

/**
 * Get albums by genres.
 * @param {string[]} genres - The list of genres.
 * @returns {Promise<Album[]>} - A promise that resolves to the list of albums.
 */
export async function getAlbumsByGenres(genres: string[]): Promise<Album[]> {
  const genresQuery = genres.join('+');
  const response = await axios.get(`/genres/albums?genres=${encodeURIComponent(genresQuery)}`);
  return response.data;
}

/**
 * Get artists by genres.
 * @param {string[]} genres - The list of genres.
 * @returns {Promise<Artist[]>} - A promise that resolves to the list of artists.
 */
export async function getArtistsByGenres(genres: string[]): Promise<Artist[]> {
  const genresQuery = genres.join('+');
  const response = await axios.get(`/genres/artists?genres=${encodeURIComponent(genresQuery)}`);
  return response.data;
}

interface LibrarySong {
  id: string;
  name: string;
  artist: string;
  contributing_artists: string[];
  track_number: number;
  path: string;
  duration: number;
  music_video?: MusicVideo;
}

interface MusicVideo {
  url: string;
  thumbnail: string;
}

/**
 * Get songs by genres.
 * @param {string[]} genres - The list of genres.
 * @returns {Promise<LibrarySong[]>} - A promise that resolves to the list of songs.
 */
export async function getSongsByGenres(genres: string[]): Promise<LibrarySong[]> {
  const genresQuery = genres.join('+');
  const response = await axios.get(`/genres/songs?genres=${encodeURIComponent(genresQuery)}`);
  return response.data;
}