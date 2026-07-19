"use client";

import { getPlaybackQueue, isApiError } from "@parson/music-sdk";
import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  isCurrentTrackGeneration,
  queueIndexForPersistedPosition,
} from "./player-state";
import { readStoredQueue, storeQueue } from "./player-queue-storage";
import type { PlayerInput, QueueItem, QueueOrigin } from "./player-model";
import { persistedQueueItems } from "./player-model";
import type { Album, Artist } from "@parson/music-sdk/types";

export function useQueueRestore({
  currentOrigin,
  generation,
  index,
  persistedQueue,
  queue,
  setError,
  setQueue,
  setSong,
  userId,
}: {
  currentOrigin: MutableRefObject<QueueOrigin>;
  generation: MutableRefObject<number>;
  index: MutableRefObject<number>;
  persistedQueue: MutableRefObject<{ id: string; revision: number } | null>;
  queue: MutableRefObject<QueueItem[]>;
  setError: Dispatch<SetStateAction<string | null>>;
  setQueue: Dispatch<SetStateAction<QueueItem[]>>;
  setSong: (
    song: PlayerInput,
    artist?: Partial<Artist>,
    album?: Partial<Album>,
  ) => void;
  userId?: string;
}) {
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const queueId = readStoredQueue();
    if (!queueId) return;
    const activeGeneration = generation.current;
    void getPlaybackQueue(queueId)
      .then((saved) => {
        if (
          cancelled ||
          !isCurrentTrackGeneration(activeGeneration, generation.current)
        )
          return;
        const items = persistedQueueItems(saved.items);
        const savedIndex = queueIndexForPersistedPosition(
          items.map((item) => item.queuePosition),
          saved.current_position,
        );
        if (!items.length) return;
        queue.current = items;
        index.current = savedIndex;
        currentOrigin.current = items[savedIndex]?.origin ?? "manual";
        persistedQueue.current = { id: saved.id, revision: saved.revision };
        setQueue(items);
        const current = items[savedIndex];
        if (current) setSong(current.song, current.artist, current.album);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (isApiError(cause) && cause.response?.status === 404)
          storeQueue(null);
        else setError("Your saved queue could not be restored yet.");
      });
    return () => {
      cancelled = true;
    };
  }, [
    currentOrigin,
    generation,
    index,
    persistedQueue,
    queue,
    setError,
    setQueue,
    setSong,
    userId,
  ]);
}
