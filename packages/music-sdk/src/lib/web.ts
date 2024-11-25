import axios from './axios';

export interface ListenAgainSong {
  song_name: string;
  song_id: string;
  song_path: string;
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_name: string;
  album_cover: string;
  album_songs_count: number;
  release_date: string;
  item_type: 'song' | 'album';
}

export interface AlbumCardProps {
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_name: string;
  album_cover: string;
  album_songs_count: number,
  first_release_date: string;
}

/**
 * Get the listen history for a user.
 * @param {number} userId - The user ID.
 * @returns {Promise<SongInfo[]>} - A promise that resolves to the list of songs or albums.
 */
export async function getListenAgain(userId: number): Promise<ListenAgainSong[]> {
  const response = await axios.get(`/web/listen_again/${userId}`);
  return response.data;
}

export type SimilarToResponse = [AlbumCardProps[], string];

/**
 * Get similar albums based on the user's listen history.
 * @param {number} userId - The user ID.
 * @returns {Promise<SimilarToResponse>} - A promise that resolves to the list of similar albums and the genre.
 */
export async function getSimilarTo(userId: number): Promise<SimilarToResponse> {
  const response = await axios.get(`/web/similar_to/${userId}`);
  return response.data;
}