import api from "../core/http";
import { Album, Artist } from "../domain/types";

export type LibraryAlbum = Album & { artist_object: Artist };

type AlbumInfoValue = LibraryAlbum | Album;
type AlbumInfoResponse = { Full?: LibraryAlbum; Bare?: Album };

const MAX_BATCH_LOOKUP_IDS = 500;
const ALBUM_INFO_CACHE_TTL_MS = 5 * 60 * 1000;
const albumInfoCache = new Map<
  string,
  { expiresAt: number; value: AlbumInfoValue }
>();
const albumInfoRequests = new Map<string, Promise<AlbumInfoValue>>();

const albumInfoCacheKey = (id: string, bare: boolean) => `${id}:${bare}`;

const unwrapAlbumInfoResponse = (data: AlbumInfoResponse): AlbumInfoValue => {
  if (data.Full) return data.Full;
  if (data.Bare) return data.Bare;
  throw new Error("Unexpected response format");
};

const readCachedAlbumInfo = (id: string, bare: boolean) => {
  const key = albumInfoCacheKey(id, bare);
  const cached = albumInfoCache.get(key);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    albumInfoCache.delete(key);
    return null;
  }

  return cached.value;
};

const writeCachedAlbumInfo = (
  id: string,
  bare: boolean,
  value: AlbumInfoValue,
) => {
  albumInfoCache.set(albumInfoCacheKey(id, bare), {
    expiresAt: Date.now() + ALBUM_INFO_CACHE_TTL_MS,
    value,
  });
};

export function replaceCachedAlbumInfo(id: string, album: LibraryAlbum) {
  albumInfoCache.delete(albumInfoCacheKey(id, true));
  writeCachedAlbumInfo(id, false, album);
}

export function clearCachedAlbumInfos() {
  albumInfoCache.clear();
}

export async function getRandomAlbum(amount: number): Promise<LibraryAlbum[]> {
  const response = await api.get<LibraryAlbum[]>(`/albums/random/${amount}`);
  return response.data;
}

export async function getAlbumInfo(
  id: string,
  bare: boolean = true,
): Promise<LibraryAlbum | Album> {
  const cached = readCachedAlbumInfo(id, bare);
  if (cached) return cached;

  const key = albumInfoCacheKey(id, bare);
  const existingRequest = albumInfoRequests.get(key);
  if (existingRequest) return existingRequest;

  const request = api
    .get<AlbumInfoResponse>(`/albums/${id}`, {
      params: { bare },
    })
    .then((response) => {
      const album = unwrapAlbumInfoResponse(response.data);
      writeCachedAlbumInfo(id, bare, album);
      return album;
    })
    .finally(() => {
      albumInfoRequests.delete(key);
    });

  albumInfoRequests.set(key, request);
  return request;
}

export async function getAlbumInfos(
  ids: string[],
  bare: boolean = true,
): Promise<Record<string, AlbumInfoValue>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const results: Record<string, AlbumInfoValue> = {};
  const missingIds: string[] = [];

  for (const id of uniqueIds) {
    const cached = readCachedAlbumInfo(id, bare);
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
    const response = await api.post<Record<string, AlbumInfoResponse>>(
      "/albums/batch",
      { ids: missingIds.slice(offset, offset + MAX_BATCH_LOOKUP_IDS), bare },
    );
    for (const [id, data] of Object.entries(response.data)) {
      const album = unwrapAlbumInfoResponse(data);
      writeCachedAlbumInfo(id, bare, album);
      results[id] = album;
    }
  }

  return results;
}
