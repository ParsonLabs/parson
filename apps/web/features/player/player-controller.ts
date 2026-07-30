"use client";

import { createPlaybackQueue } from "@parson/music-sdk";
import type { Album, Artist, LibrarySong } from "@parson/music-sdk/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/features/account/session-provider";
import { defaultCover } from "@/lib/images/default-cover";
import getBaseURL from "@/lib/api/server-url";
import streamUrl from "@/lib/api/stream-url";
import { isCurrentTrackGeneration, setMediaPosition } from "./player-state";
import { audioPresets } from "./audio-presets";
import {
  blankAlbum,
  blankArtist,
  blankSong,
  manualQueueItems,
  normalizeSong,
  persistedQueueItems,
  type PlayerInput,
  type QueueInput,
  type QueueItem,
  type QueueOrigin,
} from "./player-model";
import {
  useAudioEvents,
  useAudioLifecycle,
  useTransientPlayerError,
} from "./player-effects";
import { useAudioEngine } from "./use-audio-engine";
import type { Player } from "./player-api";
import { usePlaybackTelemetry } from "./player-telemetry";
import { storeQueue, storeQueueSnapshot } from "./player-queue-storage";
import { useQueueRestore } from "./use-queue-restore";
import {
  shouldAdvancePastFailedTrack,
  shouldRetryWithCompatibilityStream,
} from "./playback-recovery";
import { syncQueuePosition } from "./queue-position-sync";
import {
  activeQueueIndexAfterMove,
  moveQueueItem,
} from "./player-queue-reorder";
const cover = (path?: string) =>
  path
    ? `${getBaseURL()}/media/images/${encodeURIComponent(path)}`
    : defaultCover;

export function usePlayerController() {
  const {
    audio,
    audioPreset,
    audioVersion,
    backgroundWasPlaying,
    error,
    graph,
    isPlaying,
    muted,
    playAudioSource,
    preloadAudioSource,
    resumeOnReconnect,
    setAudioPreset,
    setAudioSource,
    setAudioVolume,
    setError,
    setIsPlaying,
    slowedReverb,
    source,
    toggleMute,
    toggleSlowedReverb,
    volume,
  } = useAudioEngine();
  const index = useRef(0);
  const queueRef = useRef<QueueItem[]>([]);
  const activeSong = useRef<LibrarySong>(blankSong());
  const currentOrigin = useRef<QueueOrigin>("manual");
  const persistedQueue = useRef<{ id: string; revision: number } | null>(null);
  const { session } = useSession();
  const [song, setSongState] = useState<LibrarySong>(blankSong);
  const [album, setAlbumState] = useState<Album>(blankAlbum);
  const [artist, setArtistState] = useState<Artist>(blankArtist);
  const [imageSrc, setImageSrc] = useState(defaultCover);
  const [queue, setQueueState] = useState<QueueItem[]>([]);
  const playbackGeneration = useRef(0);
  const radioRequest = useRef(0);
  const compatibilityRetry = useRef(false);
  const queuePositionSync = useRef<Promise<void>>(Promise.resolve());
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const loopingRef = useRef(false);
  const [looping, setLooping] = useState(false);
  const { sendPlaybackEvent, telemetry } = usePlaybackTelemetry({
    activeSong,
    audio,
    currentOrigin,
    persistedQueue,
    userId: session?.sub,
  });

  const setSongCallback = useCallback(
    (
      next: PlayerInput,
      nextArtist?: Partial<Artist>,
      nextAlbum?: Partial<Album>,
    ) => {
      const normalized = normalizeSong(next, nextArtist, nextAlbum);
      const generation = ++playbackGeneration.current;
      compatibilityRetry.current = false;
      activeSong.current = normalized;
      telemetry.current = {
        started: false,
        qualified: false,
        completed: false,
        listenedSeconds: 0,
        lastPosition: 0,
        lastUpdateMs:
          typeof performance === "undefined" ? 0 : performance.now(),
        seeking: false,
      };
      setSongState(normalized);
      setArtistState(normalized.artist_object);
      setAlbumState(normalized.album_object);
      setImageSrc(cover(normalized.album_object.cover_url));
      setAudioSource(streamUrl(normalized.id, session?.bitrate ?? 0));
      if (
        currentOrigin.current === "manual" &&
        !persistedQueue.current &&
        queueRef.current.length
      ) {
        const explicitSongIds = queueRef.current
          .slice(index.current)
          .map((item) => item.song.id)
          .filter(Boolean);
        void createPlaybackQueue({
          seed_song_id: normalized.id,
          explicit_song_ids: explicitSongIds,
          exclude_song_ids: queueRef.current.map((item) => item.song.id),
          generated_items: 20,
          source: "manual_selection",
        })
          .then((created) => {
            if (
              !isCurrentTrackGeneration(
                generation,
                playbackGeneration.current,
                normalized.id,
                activeSong.current.id,
              ) ||
              !created.items.length
            )
              return;
            const items = persistedQueueItems(created.items);
            persistedQueue.current = {
              id: created.id,
              revision: created.revision,
            };
            queueRef.current = items;
            index.current = 0;
            currentOrigin.current = items[0]?.origin ?? "manual";
            storeQueue(created.id);
            storeQueueSnapshot(session?.sub, items, 0);
            setQueueState(items);
          })
          .catch(() => {});
      }
    },
    [session?.bitrate, session?.sub, setAudioSource],
  );
  const setQueue = useCallback(
    (items: QueueInput[]) => {
      playbackGeneration.current += 1;
      const normalized = manualQueueItems(items);
      queueRef.current = normalized;
      currentOrigin.current = "manual";
      persistedQueue.current = null;
      storeQueue(null);
      index.current = 0;
      storeQueueSnapshot(session?.sub, normalized, 0);
      setQueueState(normalized);
    },
    [session?.sub],
  );
  const addToQueue = useCallback(
    (items: QueueInput[]) => {
      if (!items.length) return;
      const additions = manualQueueItems(items);
      const next = [...queueRef.current, ...additions];
      queueRef.current = next;
      persistedQueue.current = null;
      storeQueue(null);
      storeQueueSnapshot(session?.sub, next, index.current);
      setQueueState(next);
    },
    [session?.sub],
  );
  const addNextToQueue = useCallback(
    (items: QueueInput[]) => {
      if (!items.length) return;
      const additions = manualQueueItems(items);
      const insertionIndex = Math.min(
        index.current + 1,
        queueRef.current.length,
      );
      const next = [
        ...queueRef.current.slice(0, insertionIndex),
        ...additions,
        ...queueRef.current.slice(insertionIndex),
      ];
      queueRef.current = next;
      persistedQueue.current = null;
      storeQueue(null);
      storeQueueSnapshot(session?.sub, next, index.current);
      setQueueState(next);
    },
    [session?.sub],
  );
  const reorderQueue = useCallback(
    (from: number, to: number) => {
      if (!Number.isFinite(from) || !Number.isFinite(to)) return;
      const sourceIndex = Math.trunc(from);
      const destinationIndex = Math.trunc(to);
      const items = queueRef.current;
      if (
        sourceIndex === destinationIndex ||
        sourceIndex < 0 ||
        destinationIndex < 0 ||
        sourceIndex >= items.length ||
        destinationIndex >= items.length
      )
        return;

      const next = moveQueueItem(items, sourceIndex, destinationIndex);
      const nextActiveIndex = activeQueueIndexAfterMove(
        index.current,
        sourceIndex,
        destinationIndex,
      );
      queueRef.current = next;
      index.current = nextActiveIndex;
      currentOrigin.current =
        next[nextActiveIndex]?.origin ?? currentOrigin.current;
      persistedQueue.current = null;
      storeQueue(null);
      storeQueueSnapshot(session?.sub, next, nextActiveIndex);
      setQueueState(next);
    },
    [session?.sub],
  );
  const persistQueuePosition = useCallback((position: number | null) => {
    if (position === null || !persistedQueue.current) return;
    const queueId = persistedQueue.current.id;
    queuePositionSync.current = queuePositionSync.current
      .then(async () => {
        const active = persistedQueue.current;
        if (!active || active.id !== queueId) return;
        const saved = await syncQueuePosition(active, position);
        if (persistedQueue.current?.id === saved.id)
          persistedQueue.current = saved;
      })
      .catch(() => {});
  }, []);

  const playItem = useCallback(
    (nextIndex: number) => {
      const item = queueRef.current[nextIndex];
      if (!item) return false;
      index.current = nextIndex;
      currentOrigin.current = item.origin;
      storeQueueSnapshot(session?.sub, queueRef.current, nextIndex);
      persistQueuePosition(item.queuePosition);
      setSongCallback(item.song, item.artist, item.album);
      playAudioSource();
      return true;
    },
    [persistQueuePosition, playAudioSource, session?.sub, setSongCallback],
  );
  const handleMediaError = useCallback(
    (code: number | undefined) => {
      const activeSongId = activeSong.current.id;
      if (
        activeSongId &&
        shouldRetryWithCompatibilityStream(
          code,
          session?.bitrate ?? 0,
          compatibilityRetry.current,
        )
      ) {
        compatibilityRetry.current = true;
        setError("Direct playback failed; retrying a compatible audio stream.");
        setAudioSource(streamUrl(activeSongId, 192));
        playAudioSource();
        return true;
      }
      const hasNext =
        queueRef.current.length > 0 &&
        index.current + 1 < queueRef.current.length;
      if (shouldAdvancePastFailedTrack(code, hasNext)) {
        setError("The unavailable track was skipped.");
        playItem(index.current + 1);
        return true;
      }
      return false;
    },
    [playAudioSource, playItem, session?.bitrate, setAudioSource, setError],
  );
  const playNextSong = useCallback(() => {
    const element = audio.current;
    if (
      currentOrigin.current === "generated" &&
      element &&
      Number.isFinite(element.duration) &&
      telemetry.current.listenedSeconds < Math.min(30, element.duration * 0.3)
    ) {
      sendPlaybackEvent("early_skip", element.currentTime, element.duration);
    }
    if (queueRef.current.length && index.current + 1 < queueRef.current.length)
      playItem(index.current + 1);
  }, [playItem, sendPlaybackEvent]);
  const playPreviousSong = useCallback(() => {
    const element = audio.current;
    if (
      currentOrigin.current === "generated" &&
      element &&
      telemetry.current.listenedSeconds < Math.min(30, element.duration * 0.3)
    )
      sendPlaybackEvent("early_skip", element.currentTime, element.duration);
    if (queueRef.current.length) playItem(Math.max(index.current - 1, 0));
  }, [playItem, sendPlaybackEvent]);
  const togglePlayPause = useCallback(() => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) {
      setIsPlaying(true);
      playAudioSource();
    } else {
      resumeOnReconnect.current = false;
      setIsPlaying(false);
      element.pause();
    }
  }, [playAudioSource, setIsPlaying]);
  const handleTimeChange = useCallback((value: number | string) => {
    const element = audio.current;
    const bounded = setMediaPosition(element, value, element?.duration);
    if (bounded === null) return;
    setCurrentTime(bounded);
  }, []);
  const toggleLoop = useCallback(() => {
    const next = !loopingRef.current;
    loopingRef.current = next;
    setLooping(next);
  }, []);
  const handleEnded = useCallback(() => {
    if (loopingRef.current && audio.current) {
      audio.current.currentTime = 0;
      playAudioSource();
      return;
    }
    setIsPlaying(false);
    const element = audio.current;
    if (!telemetry.current.completed) {
      const completionThreshold = (element?.duration ?? 0) * 0.85;
      if (
        completionThreshold > 0 &&
        telemetry.current.listenedSeconds >= completionThreshold
      ) {
        telemetry.current.completed = true;
        sendPlaybackEvent("completed", element?.currentTime, element?.duration);
      }
    }
    if (
      queueRef.current.length &&
      index.current + 1 < queueRef.current.length
    ) {
      playItem(index.current + 1);
      return;
    }
    if (song.id) {
      const generation = playbackGeneration.current;
      const request = ++radioRequest.current;
      void createPlaybackQueue({
        seed_song_id: song.id,
        generated_items: 20,
        source: "radio",
      })
        .then((nextQueue) => {
          if (
            !isCurrentTrackGeneration(
              generation,
              playbackGeneration.current,
              song.id,
              activeSong.current.id,
            ) ||
            radioRequest.current !== request ||
            !song.id
          )
            return;
          const items = persistedQueueItems(nextQueue.items);
          if (!items.length) return;
          persistedQueue.current = {
            id: nextQueue.id,
            revision: nextQueue.revision,
          };
          storeQueue(nextQueue.id);
          queueRef.current = items;
          storeQueueSnapshot(session?.sub, items, 0);
          setQueueState(items);
          playItem(0);
        })
        .catch(() => {});
    }
  }, [playAudioSource, playItem, sendPlaybackEvent, session?.sub, song.id]);

  useEffect(() => {
    if (looping) {
      preloadAudioSource(null);
      return;
    }
    const next = queueRef.current[index.current + 1];
    preloadAudioSource(
      next ? streamUrl(next.song.id, session?.bitrate ?? 0) : null,
    );
  }, [
    audioVersion,
    looping,
    preloadAudioSource,
    queue,
    session?.bitrate,
    song.id,
  ]);

  useTransientPlayerError(error, setError);
  useAudioEvents({
    audio,
    audioVersion,
    currentOrigin,
    handleEnded,
    handleMediaError,
    resumeOnReconnect,
    sendPlaybackEvent,
    setCurrentTime,
    setDuration,
    setError,
    setIsPlaying,
    telemetry,
  });
  useAudioLifecycle({
    audio,
    backgroundWasPlaying,
    graph,
    play: playAudioSource,
    resumeOnReconnect,
    source,
  });

  useQueueRestore({
    currentOrigin,
    generation: playbackGeneration,
    index,
    persistedQueue,
    queue: queueRef,
    setError,
    setQueue: setQueueState,
    setSong: setSongCallback,
    userId: session?.sub,
  });

  const value = useMemo<Player>(
    () => ({
      song,
      album,
      artist,
      imageSrc,
      queue,
      isPlaying,
      error,
      currentTime,
      duration,
      volume,
      muted,
      slowedReverb,
      audioPreset,
      audioPresets,
      looping,
      setSongCallback,
      setQueue,
      addNextToQueue,
      addToQueue,
      setCurrentSongIndex: (next) => {
        if (!Number.isFinite(next)) return;
        const bounded = Math.min(
          Math.max(Math.trunc(next), 0),
          Math.max(queueRef.current.length - 1, 0),
        );
        index.current = bounded;
        const item = queueRef.current[bounded];
        if (item) {
          currentOrigin.current = item.origin;
          storeQueueSnapshot(session?.sub, queueRef.current, bounded);
          persistQueuePosition(item.queuePosition);
        }
      },
      playAudioSource,
      togglePlayPause,
      playNextSong,
      playPreviousSong,
      playQueueItem: (nextIndex) => {
        playItem(nextIndex);
      },
      reorderQueue,
      handleTimeChange,
      setAudioVolume,
      toggleMute,
      toggleSlowedReverb,
      setAudioPreset,
      toggleLoop,
    }),
    [
      album,
      artist,
      currentTime,
      duration,
      handleTimeChange,
      imageSrc,
      isPlaying,
      error,
      looping,
      muted,
      audioPreset,
      slowedReverb,
      playAudioSource,
      playNextSong,
      playPreviousSong,
      playItem,
      reorderQueue,
      persistQueuePosition,
      queue,
      session?.sub,
      setAudioVolume,
      setAudioPreset,
      setQueue,
      addNextToQueue,
      addToQueue,
      setSongCallback,
      song,
      toggleMute,
      toggleLoop,
      toggleSlowedReverb,
      togglePlayPause,
      volume,
    ],
  );
  return value;
}
