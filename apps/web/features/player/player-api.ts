"use client";

import type { Album, Artist, LibrarySong } from "@parson/music-sdk/types";
import { createContext, useContext } from "react";
import type { AudioPreset, AudioPresetId } from "./audio-presets";
import type { PlayerInput, QueueInput, QueueItem } from "./player-model";

export type Player = {
  song: LibrarySong;
  album: Album;
  artist: Artist;
  imageSrc: string;
  queue: QueueItem[];
  isPlaying: boolean;
  error: string | null;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  slowedReverb: boolean;
  audioPreset: AudioPresetId;
  audioPresets: readonly AudioPreset[];
  looping: boolean;
  setSongCallback: (
    song: PlayerInput,
    artist?: Partial<Artist>,
    album?: Partial<Album>,
  ) => void;
  setQueue: (queue: QueueInput[]) => void;
  addNextToQueue: (items: QueueInput[]) => void;
  addToQueue: (items: QueueInput[]) => void;
  setCurrentSongIndex: (index: number) => void;
  playAudioSource: () => void;
  togglePlayPause: () => void;
  playNextSong: () => void;
  playPreviousSong: () => void;
  playQueueItem: (index: number) => void;
  handleTimeChange: (value: number | string) => void;
  setAudioVolume: (value: number | string) => void;
  toggleMute: () => void;
  toggleSlowedReverb: () => void;
  setAudioPreset: (preset: AudioPresetId) => void;
  toggleLoop: () => void;
};

export const PlayerContext = createContext<Player | null>(null);

export function usePlayer() {
  const player = useContext(PlayerContext);
  if (!player) throw new Error("usePlayer must be used inside PlayerProvider");
  return player;
}
