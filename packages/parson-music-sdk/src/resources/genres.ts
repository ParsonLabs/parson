import api from "../core/http";
import { Album, Artist } from "../domain/types";

export interface GenrePage {
  limit?: number;
  offset?: number;
}

export async function listAllGenres(): Promise<string[]> {
  const response = await api.get("/genres");
  return response.data;
}

export async function getAlbumsByGenres(
  genres: string[],
  page: GenrePage = {},
): Promise<Album[]> {
  const genresQuery = genres.join("+");
  const response = await api.get(
    `/genres/${encodeURIComponent(genresQuery)}/albums`,
    {
      params: page,
    },
  );
  return response.data;
}

export async function getArtistsByGenres(
  genres: string[],
  page: GenrePage = {},
): Promise<Artist[]> {
  const genresQuery = genres.join("+");
  const response = await api.get(
    `/genres/${encodeURIComponent(genresQuery)}/artists`,
    {
      params: page,
    },
  );
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
}

export async function getSongsByGenres(
  genres: string[],
  page: GenrePage = {},
): Promise<LibrarySong[]> {
  const genresQuery = genres.join("+");
  const response = await api.get(
    `/genres/${encodeURIComponent(genresQuery)}/songs`,
    {
      params: page,
    },
  );
  return response.data;
}

export interface PopularGenre {
  name: string;
  song_count: number;
  cover_image?: string | null;
}

export async function getPopularGenres(): Promise<PopularGenre[]> {
  const res = await api.get(`/genres/popular`);
  return res.data as PopularGenre[];
}
