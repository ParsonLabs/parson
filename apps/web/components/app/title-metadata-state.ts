export const TITLE_TRANSITION_DELAY = 5_000;

export type MetadataTitleMode = "page" | "playback";

export function titleModeAfterPlaybackDelay(
  isPlaying: boolean,
): MetadataTitleMode {
  return isPlaying ? "playback" : "page";
}

export function resolveMetadataTitle({
  artistName,
  mode,
  pageTitle,
  songName,
}: {
  artistName: string;
  mode: MetadataTitleMode;
  pageTitle: string;
  songName: string;
}) {
  const playbackTitle = songName
    ? [songName, artistName].filter(Boolean).join(" - ")
    : null;
  return mode === "playback" && playbackTitle ? playbackTitle : pageTitle;
}
