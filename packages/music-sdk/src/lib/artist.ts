import { AxiosResponse } from 'axios';
import axios from "./axios";
import { Artist } from './types';

/**
 * Get a random artist.
 * @param {number} amount - The number of random artists to retrieve.
 * @returns {Promise<Artist[]>} - A promise that resolves to an array of random artists.
 */
export async function getRandomArtist(amount: number): Promise<Artist[]> {
  const response: AxiosResponse<Artist[]> = await axios.get(`/artist/random/${amount}`);
  return response.data;
}

/**
 * Get artist information by ID.
 * @param {string} id - The ID of the artist.
 * @returns {Promise<Artist>} - A promise that resolves to the artist information.
 */
export async function getArtistInfo(id: string): Promise<Artist> {
  const response: AxiosResponse<Artist> = await axios.get(`/artist/info/${id}`);
  return response.data;
}

/**
 * Add a new artist.
 * @param {Artist} artist - The artist to add.
 * @returns {Promise<void>} - A promise that resolves when the artist is added.
 */
export async function addArtist(artist: Artist): Promise<void> {
  await axios.post(`/artist/add`, { artist });
}

/**
 * Delete an artist by ID.
 * @param {string} id - The ID of the artist to delete.
 * @returns {Promise<void>} - A promise that resolves when the artist is deleted.
 */
export async function deleteArtist(id: string): Promise<void> {
  await axios.delete(`/artist/delete`, { data: { artist_id: id } });
}