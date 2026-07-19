import type { LyricsResult } from "@parson/music-sdk";

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
