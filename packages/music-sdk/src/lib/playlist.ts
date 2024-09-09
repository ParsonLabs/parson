import axios from './axios';

/**
 * Represents a playlist response.
 */
interface PlaylistResponse {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
  updated_at: string;
  song_infos: SongInfo[];
  user_ids: number[];
}

interface SongInfo {
  song_id: string;
  date_added: string;
}

/**
 * Represents a response for multiple playlists.
 */
export interface PlaylistsResponse {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
  updated_at: string;
}[];

/**
 * Add a song to a playlist.
 * @param {number} playlist_id - The ID of the playlist.
 * @param {number} song_id - The ID of the song.
 * @returns {Promise<string>} - A promise that resolves to a success message.
 */
export async function addSongToPlaylist(playlist_id: number, song_id: string): Promise<string> {
  const response = await axios.post('/playlist/add_song', { playlist_id, song_id });
  return response.data;
}

/**
 * Create a new playlist.
 * @param {number} user_id - The ID of the user.
 * @param {string} name - The name of the playlist.
 * @returns {Promise<string>} - A promise that resolves to a success message.
 */
export async function createPlaylist(user_id: number, name: string): Promise<string> {
  const response = await axios.post('/playlist/create', { user_id, name });
  return response.data;
}

/**
 * Delete a playlist.
 * @param {number} playlist_id - The ID of the playlist.
 * @returns {Promise<string>} - A promise that resolves to a success message.
 */
export async function deletePlaylist(playlist_id: number): Promise<string> {
  const response = await axios.delete('/playlist/delete', {
    data: { playlist_id },
  });
  return response.data;
}

/**
 * Get playlist info including song IDs.
 * @param {number} playlist_id - The ID of the playlist.
 * @returns {Promise<PlaylistResponse>} - A promise that resolves to the playlist info.
 */
export async function getPlaylist(playlist_id: number): Promise<PlaylistResponse> {
  const response = await axios.get(`/playlist/info/${playlist_id}`);
  return response.data;
}

/**
 * Get playlists by user ID.
 * @param {number} user_id - The ID of the user.
 * @returns {Promise<PlaylistsResponse[]>} - A promise that resolves to the list of playlists.
 */
export async function getPlaylists(user_id: number): Promise<PlaylistsResponse[]> {
  const response = await axios.get(`/playlist/list/${user_id}`);
  return response.data;
}