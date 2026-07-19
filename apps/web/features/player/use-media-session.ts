"use client";

import { useEffect } from "react";

type MediaSessionPlayer = {
  album: string;
  artist: string;
  artwork: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onNext: () => void;
  onPause: () => void;
  onPlay: () => void;
  onPrevious: () => void;
  onSeek: (position: number) => void;
  title: string;
};

function setMediaAction(
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Older WebKit omits optional Media Session actions.
  }
}

export function useMediaSession({
  album,
  artist,
  artwork,
  currentTime,
  duration,
  isPlaying,
  onNext,
  onPause,
  onPlay,
  onPrevious,
  onSeek,
  title,
}: MediaSessionPlayer) {
  useEffect(() => {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;

    const resolvedArtwork = new URL(artwork, window.location.href).href;
    navigator.mediaSession.metadata = new MediaMetadata({
      album,
      artist,
      artwork: [{ src: resolvedArtwork }],
      title,
    });
  }, [album, artist, artwork, title]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const seekBy = (seconds: number) =>
      onSeek(Math.max(0, Math.min(duration || 0, currentTime + seconds)));
    setMediaAction("play", onPlay);
    setMediaAction("pause", onPause);
    setMediaAction("nexttrack", onNext);
    setMediaAction("previoustrack", onPrevious);
    setMediaAction("seekbackward", (details) =>
      seekBy(-(details.seekOffset ?? 10)),
    );
    setMediaAction("seekforward", (details) =>
      seekBy(details.seekOffset ?? 10),
    );
    setMediaAction("seekto", (details) => {
      if (details.seekTime !== undefined) onSeek(details.seekTime);
    });

    return () => {
      for (const action of [
        "play",
        "pause",
        "nexttrack",
        "previoustrack",
        "seekbackward",
        "seekforward",
        "seekto",
      ] as MediaSessionAction[]) {
        setMediaAction(action, null);
      }
    };
  }, [currentTime, duration, onNext, onPause, onPlay, onPrevious, onSeek]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: 1,
      position: Math.max(0, Math.min(currentTime, duration)),
    });
  }, [currentTime, duration]);
}
