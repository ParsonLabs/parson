"use client";

import type { PlaybackEventType } from "@parson/music-sdk";
import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import type { AudioGraph } from "./audio-presets";
import type { QueueOrigin } from "./player-model";

export type PlaybackTelemetry = {
  started: boolean;
  qualified: boolean;
  completed: boolean;
  listenedSeconds: number;
  lastPosition: number;
  lastUpdateMs: number;
  seeking: boolean;
};

type StateSetter<T> = Dispatch<SetStateAction<T>>;
type PlaybackEventSender = (
  event: PlaybackEventType,
  position?: number,
  duration?: number,
) => void;

export function useTransientPlayerError(
  error: string | null,
  setError: StateSetter<string | null>,
) {
  useEffect(() => {
    if (!error) return;
    toast(error, { id: "player-error" });
    setError(null);
  }, [error, setError]);
}

export function useAudioEvents({
  audio,
  audioVersion,
  currentOrigin,
  handleEnded,
  resumeOnReconnect,
  sendPlaybackEvent,
  setCurrentTime,
  setDuration,
  setError,
  setIsPlaying,
  telemetry,
}: {
  audio: MutableRefObject<HTMLAudioElement | null>;
  audioVersion: number;
  currentOrigin: MutableRefObject<QueueOrigin>;
  handleEnded: () => void;
  resumeOnReconnect: MutableRefObject<boolean>;
  sendPlaybackEvent: PlaybackEventSender;
  setCurrentTime: StateSetter<number>;
  setDuration: StateSetter<number>;
  setError: StateSetter<string | null>;
  setIsPlaying: StateSetter<boolean>;
  telemetry: MutableRefObject<PlaybackTelemetry>;
}) {
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    const update = () => {
      const nextPosition = element.currentTime || 0;
      const now = performance.now();
      const positionDelta = nextPosition - telemetry.current.lastPosition;
      const wallDelta = telemetry.current.lastUpdateMs
        ? (now - telemetry.current.lastUpdateMs) / 1000
        : 0;
      if (
        !element.paused &&
        !telemetry.current.seeking &&
        positionDelta >= 0 &&
        positionDelta <= Math.max(2, wallDelta * 2)
      ) {
        telemetry.current.listenedSeconds += Math.min(
          positionDelta,
          wallDelta * 1.25,
        );
      }
      telemetry.current.lastPosition = nextPosition;
      telemetry.current.lastUpdateMs = now;
      setCurrentTime(nextPosition);
      setDuration(element.duration || 0);
      const threshold = Math.min(element.duration * 0.5, 240);
      if (
        !telemetry.current.qualified &&
        Number.isFinite(threshold) &&
        threshold > 0 &&
        telemetry.current.listenedSeconds >= threshold
      ) {
        telemetry.current.qualified = true;
        sendPlaybackEvent(
          "qualified_play",
          element.currentTime,
          element.duration,
        );
      }
    };
    const started = () => {
      setIsPlaying(true);
      resumeOnReconnect.current = false;
      if (telemetry.current.started) return;
      telemetry.current.started = true;
      sendPlaybackEvent(
        currentOrigin.current === "manual"
          ? "manual_selection"
          : "play_started",
        element.currentTime,
        element.duration,
      );
    };
    const paused = () => setIsPlaying(false);
    const failed = () => {
      setIsPlaying(false);
      const code = element.error?.code;
      resumeOnReconnect.current = code === MediaError.MEDIA_ERR_NETWORK;
      setError(
        code === MediaError.MEDIA_ERR_NETWORK
          ? "Playback was interrupted by a network error."
          : code === MediaError.MEDIA_ERR_DECODE ||
              code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
            ? "This audio file could not be decoded by the browser."
            : "Playback failed. Try the track again.",
      );
    };
    const seeking = () => {
      telemetry.current.seeking = true;
    };
    const seeked = () => {
      telemetry.current.seeking = false;
      telemetry.current.lastPosition = element.currentTime || 0;
      telemetry.current.lastUpdateMs = performance.now();
    };
    const listeners: [keyof HTMLMediaElementEventMap, EventListener][] = [
      ["timeupdate", update],
      ["loadedmetadata", update],
      ["play", started],
      ["playing", started],
      ["pause", paused],
      ["error", failed],
      ["seeking", seeking],
      ["seeked", seeked],
      ["ended", handleEnded],
    ];
    listeners.forEach(([name, listener]) =>
      element.addEventListener(name, listener),
    );
    return () =>
      listeners.forEach(([name, listener]) =>
        element.removeEventListener(name, listener),
      );
  }, [
    audio,
    audioVersion,
    currentOrigin,
    handleEnded,
    resumeOnReconnect,
    sendPlaybackEvent,
    setCurrentTime,
    setDuration,
    setError,
    setIsPlaying,
    telemetry,
  ]);
}

export function useAudioLifecycle({
  audio,
  backgroundWasPlaying,
  graph,
  play,
  resumeOnReconnect,
  source,
}: {
  audio: MutableRefObject<HTMLAudioElement | null>;
  backgroundWasPlaying: MutableRefObject<boolean>;
  graph: MutableRefObject<AudioGraph | null>;
  play: () => void;
  resumeOnReconnect: MutableRefObject<boolean>;
  source: MutableRefObject<string>;
}) {
  useEffect(
    () => () => {
      const element = audio.current;
      element?.pause();
      element?.removeAttribute("src");
      element?.load();
      void graph.current?.context.close().catch(() => {});
      graph.current = null;
    },
    [audio, graph],
  );

  useEffect(() => {
    const reconnect = () => {
      if (resumeOnReconnect.current && source.current) play();
    };
    const visibilityChanged = () => {
      const element = audio.current;
      if (document.visibilityState === "hidden") {
        backgroundWasPlaying.current = Boolean(element && !element.paused);
        return;
      }
      if (graph.current?.context.state === "suspended")
        void graph.current.context.resume().catch(() => {});
      if (backgroundWasPlaying.current && element?.paused) play();
      backgroundWasPlaying.current = false;
    };
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [audio, backgroundWasPlaying, graph, play, resumeOnReconnect, source]);
}
