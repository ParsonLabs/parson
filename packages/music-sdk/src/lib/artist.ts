import { AxiosResponse } from 'axios';
import axios from "./axios";
import { Artist } from './types';

/**
 * Get a random artist.
 * @param {number} amount - The number of random artists to retrieve.
 * @returns {Promise<LibraryArtist[]>} - A promise that resolves to an array of random artists.
 */
export async function getRandomArtist(amount: number): Promise<Artist[]> {
  const response: AxiosResponse<Artist[]> = await axios.get(`/artist/random/${amount}`);
  return response.data;
}

/**
 * Get artist information by ID.
 * @param {number} id - The ID of the artist.
 * @returns {Promise<LibraryArtist>} - A promise that resolves to the artist information.
 */
export async function getArtistInfo(id: string): Promise<Artist> {
  const response: AxiosResponse<Artist> = await axios.get(`/artist/info/${id}`);
  return response.data;
}