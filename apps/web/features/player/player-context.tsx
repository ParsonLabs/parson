"use client";

import type { ReactNode } from "react";
import { PlayerContext, PlayerClockContext } from "./player-api";
import { usePlayerController } from "./player-controller";

export { audioPresets } from "./audio-presets";
export type { AudioPreset, AudioPresetId } from "./audio-presets";
export { usePlayer, usePlayerClock } from "./player-api";

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { player, currentTime } = usePlayerController();
  return (
    <PlayerContext.Provider value={player}>
      <PlayerClockContext.Provider value={currentTime}>
        {children}
      </PlayerClockContext.Provider>
    </PlayerContext.Provider>
  );
}
