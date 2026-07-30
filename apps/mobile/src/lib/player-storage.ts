import type { LibrarySong } from "@parson/music-sdk";

export const MAX_STORED_QUEUE_LENGTH = 500;

export type StoredPlayerState = {
  currentIndex: number;
  originalQueue: LibrarySong[];
  origin: "generated" | "manual";
  queue: LibrarySong[];
  repeat: "none" | "one" | "all";
  shuffle: boolean;
};

const isSong = (value: unknown): value is LibrarySong => {
  if (!value || typeof value !== "object") return false;
  const song = value as Record<string, unknown>;
  return (
    typeof song.id === "string" &&
    song.id.length > 0 &&
    typeof song.name === "string" &&
    typeof song.artist === "string"
  );
};

export function parseStoredPlayerState(
  serialized: string | null,
): StoredPlayerState | null {
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as Partial<StoredPlayerState>;
    if (
      !Array.isArray(value.queue) ||
      !Array.isArray(value.originalQueue) ||
      value.queue.length > MAX_STORED_QUEUE_LENGTH ||
      value.originalQueue.length > MAX_STORED_QUEUE_LENGTH ||
      !value.queue.every(isSong) ||
      !value.originalQueue.every(isSong) ||
      !Number.isInteger(value.currentIndex) ||
      !["none", "one", "all"].includes(String(value.repeat)) ||
      typeof value.shuffle !== "boolean"
    )
      return null;
    const currentIndex = value.queue.length
      ? Math.max(0, Math.min(value.currentIndex!, value.queue.length - 1))
      : -1;
    return {
      currentIndex,
      originalQueue: value.originalQueue,
      origin: value.origin === "generated" ? "generated" : "manual",
      queue: value.queue,
      repeat: value.repeat!,
      shuffle: value.shuffle,
    };
  } catch {
    return null;
  }
}

export function serializePlayerState(state: StoredPlayerState): string {
  return JSON.stringify({
    ...state,
    originalQueue: state.originalQueue.slice(0, MAX_STORED_QUEUE_LENGTH),
    queue: state.queue.slice(0, MAX_STORED_QUEUE_LENGTH),
  });
}
