import { AxiosResponse } from 'axios';
import axios from './axios';
import { LibrarySong, MusicVideoSong } from './types';

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
 * @returns {Promise<LibrarySong>} - A promise that resolves to the song information.
 */
export async function getSongInfo(id: string): Promise<LibrarySong> {
  const response: AxiosResponse<LibrarySong> = await axios.get(`/song/info/${id}`);
  return response.data;
}

/**
 * Get all songs with music videos.
 * @returns {Promise<MusicVideoSong[]>} 
 */
export async function getSongsWithMusicVideos(): Promise<MusicVideoSong[]> {
  const response: AxiosResponse<MusicVideoSong[]> = await axios.get(`/song/music_videos`);
  return response.data;
}