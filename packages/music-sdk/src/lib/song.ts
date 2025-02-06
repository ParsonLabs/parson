import { AxiosResponse } from 'axios';
import axios from './axios';
import { LibrarySong, BareSong, MusicVideoSong } from './types';

export type SongInfo = 
  | { Full: LibrarySong }
  | { Bare: BareSong };

/**
 * Get a random song.
 * @param {number} amount - The number of random songs to retrieve.
 * @param {string} [genre] - The optional genre to filter the songs by.
 * @returns {Promise<LibrarySong[]>} - A promise that resolves to an array of random songs.
 */
export async function getRandomSong(amount: number, genre?: string): Promise<LibrarySong[]> {
  const params = genre ? { genre } : {};
  const response: AxiosResponse<LibrarySong[]> = await axios.get(`/song/random/${amount}`, { params });
  return response.data;
}

/**
 * Get song information by ID.
 * @param {string} id - The ID of the song.
 * @param {boolean} [bare=false] - Whether to fetch bare song information.
 * @returns {Promise<LibrarySong | BareSong>} - A promise that resolves to the song information.
 */
export async function getSongInfo(id: string, bare: boolean = true): Promise<LibrarySong | BareSong> {
  const response: AxiosResponse<{ Full?: LibrarySong; Bare?: BareSong }> = await axios.get(`/song/info/${id}`, {
    params: { bare }
  });

  if (response.data.Full) {
    return response.data.Full;
  } else if (response.data.Bare) {
    return response.data.Bare;
  } else {
    throw new Error('Unexpected response format');
  }
}

/**
 * Get all songs with music videos.
 * @returns {Promise<MusicVideoSong[]>} 
 */
export async function getSongsWithMusicVideos(): Promise<MusicVideoSong[]> {
  const response: AxiosResponse<MusicVideoSong[]> = await axios.get(`/song/music_videos`);
  return response.data;
}

/**
 * Add a new song.
 * @param {LibrarySong} song - The song to add.
 * @param {string} [artist_id] - The optional ID of the artist to add the song to.
 * @param {string} [album_id] - The optional ID of the album to add the song to.
 * @returns {Promise<void>} - A promise that resolves when the song is added.
 */
export async function addSong(song: LibrarySong, artist_id?: string, album_id?: string): Promise<void> {
  await axios.post(`/song/add`, { song, artist_id, album_id });
}

/**
 * Delete a song by ID.
 * @param {string} song_id - The ID of the song to delete.
 * @returns {Promise<void>} - A promise that resolves when the song is deleted.
 */
export async function deleteSong(song_id: string): Promise<void> {
  await axios.delete(`/song/delete`, { data: { song_id } });
}

/**
 * Edit song metadata.
 * @param {LibrarySong | BareSong} song - The song with updated metadata.
 * @returns {Promise<void>} - A promise that resolves when the song metadata is updated.
 */
export async function editSongMetadata(song: LibrarySong | BareSong): Promise<void> {
  await axios.post(`/song/edit/${song.id}`, song);
}