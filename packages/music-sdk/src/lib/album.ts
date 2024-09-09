import { AxiosResponse } from 'axios';
import axios from './axios';
import { Album, Artist } from './types';

export type LibraryAlbum = Album & { artist_object: Artist }

/**
 * Get a random album.
 * @param {number} amount - The number of random albums to retrieve.
 * @returns {Promise<LibraryAlbum[]>} - A promise that resolves to an array of random albums.
 */
export async function getRandomAlbum(amount: number): Promise<LibraryAlbum[]> {
  const response: AxiosResponse<LibraryAlbum[]> = await axios.get(`/album/random/${amount}`)
  return response.data;
}

/**
 * Get album information by ID.
 * @param {string} id - The ID of the album.
 * @returns {Promise<LibraryAlbum>} - A promise that resolves to the album information.
 */
export async function getAlbumInfo(id: string): Promise<LibraryAlbum> {
  const response: AxiosResponse<LibraryAlbum> = await axios.get(`/album/info/${id}`);
  return response.data;
}