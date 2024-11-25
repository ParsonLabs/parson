import { AxiosResponse } from 'axios';
import axios from './axios';
import { Album, Artist } from './types';

export type LibraryAlbum = Album & { artist_object: Artist };

/**
 * Get a random album.
 * @param {number} amount - The number of random albums to retrieve.
 * @returns {Promise<LibraryAlbum[]>} - A promise that resolves to an array of random albums.
 */
export async function getRandomAlbum(amount: number): Promise<LibraryAlbum[]> {
  const response: AxiosResponse<LibraryAlbum[]> = await axios.get(`/album/random/${amount}`);
  return response.data;
}

/**
 * Get album information by ID.
 * @param {string} id - The ID of the album.
 * @param {boolean} [bare=false] - Whether to fetch bare album information.
 * @returns {Promise<LibraryAlbum | Album>} - A promise that resolves to the album information.
 */
export async function getAlbumInfo(id: string, bare: boolean = false): Promise<LibraryAlbum | Album> {
  const response: AxiosResponse<{ Full?: LibraryAlbum; Bare?: Album }> = await axios.get(`/album/info/${id}`, {
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
 * Add a new album.
 * @param {Album} album - The album to add.
 * @param {string} [artist_id] - The optional ID of the artist to add the album to.
 * @returns {Promise<void>} - A promise that resolves when the album is added.
 */
export async function addAlbum(album: Album, artist_id?: string): Promise<void> {
  await axios.post(`/album/add`, { album, artist_id });
}

/**
 * Delete an album by ID.
 * @param {string} album_id - The ID of the album to delete.
 * @returns {Promise<void>} - A promise that resolves when the album is deleted.
 */
export async function deleteAlbum(album_id: string): Promise<void> {
  await axios.delete(`/album/delete`, { data: { album_id } });
}