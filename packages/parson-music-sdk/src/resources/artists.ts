import api from "../core/http";
import { Artist } from "../domain/types";

const MAX_BATCH_LOOKUP_IDS = 500;
const ARTIST_INFO_CACHE_TTL_MS = 5 * 60 * 1000;
const artistInfoCache = new Map<string, { expiresAt: number; value: Artist }>();
const artistInfoRequests = new Map<string, Promise<Artist>>();

const readCachedArtistInfo = (id: string) => {
  const cached = artistInfoCache.get(id);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    artistInfoCache.delete(id);
    return null;
  }

  return cached.value;
};

const writeCachedArtistInfo = (id: string, value: Artist) => {
  artistInfoCache.set(id, {
    expiresAt: Date.now() + ARTIST_INFO_CACHE_TTL_MS,
    value,
  });
};

export function replaceCachedArtistInfo(id: string, artist: Artist) {
  writeCachedArtistInfo(id, artist);
}

export async function getRandomArtist(amount: number): Promise<Artist[]> {
  const response = await api.get<Artist[]>(`/artists/random/${amount}`);
  return response.data;
}

export async function getArtistInfo(id: string): Promise<Artist> {
  const cached = readCachedArtistInfo(id);
  if (cached) return cached;

  const existingRequest = artistInfoRequests.get(id);
  if (existingRequest) return existingRequest;

  const request = api
    .get<Artist>(`/artists/${id}`)
    .then((response) => {
      writeCachedArtistInfo(id, response.data);
      return response.data;
    })
    .finally(() => {
      artistInfoRequests.delete(id);
    });

  artistInfoRequests.set(id, request);
  return request;
}

export async function getArtistInfos(
  ids: string[],
): Promise<Record<string, Artist>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const results: Record<string, Artist> = {};
  const missingIds: string[] = [];

  for (const id of uniqueIds) {
    const cached = readCachedArtistInfo(id);
    if (cached) {
      results[id] = cached;
    } else {
      missingIds.push(id);
    }
  }

  if (missingIds.length === 0) return results;

  for (
    let offset = 0;
    offset < missingIds.length;
    offset += MAX_BATCH_LOOKUP_IDS
  ) {
    const response = await api.post<Record<string, Artist>>("/artists/batch", {
      ids: missingIds.slice(offset, offset + MAX_BATCH_LOOKUP_IDS),
    });
    for (const [id, artist] of Object.entries(response.data)) {
      writeCachedArtistInfo(id, artist);
      results[id] = artist;
    }
  }

  return results;
}
