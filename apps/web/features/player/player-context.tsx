"use client";

import type { ReactNode } from "react";
import { PlayerContext } from "./player-api";
import { usePlayerController } from "./player-controller";

export { audioPresets } from "./audio-presets";
export type { AudioPreset, AudioPresetId } from "./audio-presets";
export { usePlayer } from "./player-api";

export function PlayerProvider({ children }: { children: ReactNode }) {
  const player = usePlayerController();
  return (
    <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>
  );
}
