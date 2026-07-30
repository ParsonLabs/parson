import type { LyricsResult } from "@parson/music-sdk";

export function lyricsRequestFailure(error: unknown): "missing" | "failed" {
  if (!error || typeof error !== "object" || !("response" in error)) {
    return "failed";
  }
  const response = error.response;
  if (!response || typeof response !== "object" || !("data" in response)) {
    return "failed";
  }
  const data = response.data;
  return data &&
    typeof data === "object" &&
    "code" in data &&
    data.code === "lyrics_not_found"
    ? "missing"
    : "failed";
}

export function shouldRequestLyrics({
  cachedLyrics,
  completedSongId,
  open,
  songId,
}: {
  cachedLyrics?: LyricsResult;
  completedSongId: string;
  open: boolean;
  songId: string;
}) {
  return Boolean(songId && open && !cachedLyrics && completedSongId !== songId);
}

export function resolveLyricsRenderState({
  cachedLyrics,
  completedLyrics,
  completedSongId,
  localPlainLyrics,
  open,
  songId,
}: {
  cachedLyrics?: LyricsResult;
  completedLyrics: LyricsResult | null;
  completedSongId: string;
  localPlainLyrics?: string;
  open: boolean;
  songId: string;
}) {
  const lyrics =
    completedSongId === songId ? completedLyrics : (cachedLyrics ?? null);
  const hasImmediateLyrics = Boolean(
    lyrics?.plainLyrics || lyrics?.syncedLyrics || localPlainLyrics,
  );

  return {
    lyrics,
    loading:
      Boolean(songId) &&
      open &&
      completedSongId !== songId &&
      !hasImmediateLyrics,
  };
}
