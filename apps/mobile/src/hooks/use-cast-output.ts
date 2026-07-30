import type { LibrarySong } from "@parson/music-sdk";
import { useMemo } from "react";

export type CastOutputOptions = {
  currentIndex: number;
  pauseLocal: () => void;
  queue: LibrarySong[];
  repeat: "none" | "one" | "all";
};

export function useCastOutput(_options: CastOutputOptions) {
  return useMemo(
    () => ({
      casting: false,
      currentIndex: -1,
      currentTime: 0,
      duration: 0,
      isPlaying: false,
      next: () => {},
      previous: () => {},
      seek: (_seconds: number) => {},
      toggle: () => {},
    }),
    [],
  );
}
