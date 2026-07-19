import api from "../core/http";

const LYRICS_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_LYRICS_CACHE_ENTRIES = 256;
const lyricsCache = new Map<
  string,
  { expiresAt: number; value: LyricsResult }
>();
const lyricsRequests = new Map<string, Promise<LyricsResult>>();

export type LyricsResult = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
};

export function getCachedLyrics(songId: string): LyricsResult | undefined {
  const cached = lyricsCache.get(songId);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    lyricsCache.delete(songId);
    return undefined;
  }

  return cached.value;
}

export async function findLyrics(songId: string): Promise<LyricsResult> {
  const cached = getCachedLyrics(songId);
  if (cached) return cached;

  const pending = lyricsRequests.get(songId);
  if (pending) return pending;

  const request = api
    .get<LyricsResult>(
      `/lyrics/${encodeURIComponent(songId)}`,
      // Allow LRCLIB more time than the backend's 25-second provider timeout.
      { timeout: 30000 },
    )
    .then((response) => {
      if (lyricsCache.size >= MAX_LYRICS_CACHE_ENTRIES) {
        const oldest = lyricsCache.keys().next().value;
        if (oldest !== undefined) lyricsCache.delete(oldest);
      }
      lyricsCache.set(songId, {
        expiresAt: Date.now() + LYRICS_CACHE_TTL_MS,
        value: response.data,
      });
      return response.data;
    })
    .finally(() => lyricsRequests.delete(songId));
  lyricsRequests.set(songId, request);
  return request;
}
