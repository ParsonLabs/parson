"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { boundedVolume } from "./player-state";
import {
  audioPresets,
  buildReverbImpulse,
  createAudioElement,
  defaultAudioPreset,
  getAudioPreset,
  setPitchPreservation,
  type AudioGraph,
  type AudioPreset,
  type AudioPresetId,
} from "./audio-presets";

const PLAYBACK_START_TIMEOUT_MS = 12_000;

export function useAudioEngine() {
  const audio = useRef<HTMLAudioElement | null>(
    typeof window === "undefined" ? null : createAudioElement(),
  );
  const graph = useRef<AudioGraph | null>(null);
  const source = useRef("");
  const playbackAttempt = useRef(0);
  const resumeOnReconnect = useRef(false);
  const backgroundWasPlaying = useRef(false);
  const volumeRef = useRef(1);
  const mutedRef = useRef(false);
  const recovered = useRef(false);
  const presetRef = useRef<AudioPreset>(audioPresets[0]!);
  const [audioVersion, setAudioVersion] = useState(0);
  const [audioPreset, setAudioPresetState] =
    useState<AudioPresetId>("original");
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const recoverAudioElement = useCallback(() => {
    if (recovered.current || typeof window === "undefined") return;
    const current = audio.current;
    const resumeAt = current?.currentTime || 0;
    current?.pause();
    const replacement = createAudioElement();
    replacement.volume = volumeRef.current;
    replacement.muted = mutedRef.current;
    setPitchPreservation(replacement, presetRef.current.preservePitch);
    replacement.defaultPlaybackRate = presetRef.current.rate;
    replacement.playbackRate = presetRef.current.rate;
    if (source.current) {
      replacement.src = source.current;
      try {
        replacement.currentTime = resumeAt;
      } catch {}
      replacement.load();
    }
    audio.current = replacement;
    recovered.current = true;
    setAudioVersion((version) => version + 1);
  }, []);

  const ensureAudioGraph = useCallback(() => {
    recoverAudioElement();
    const element = audio.current;
    if (!element || graph.current || typeof window === "undefined")
      return graph.current;
    const Constructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Constructor) return null;
    try {
      const context = new Constructor();
      const mediaSource = context.createMediaElementSource(element);
      const dryGain = context.createGain();
      const wetGain = context.createGain();
      const convolver = context.createConvolver();
      convolver.buffer = buildReverbImpulse(context);
      mediaSource.connect(dryGain);
      convolver.connect(wetGain);
      dryGain.connect(context.destination);
      wetGain.connect(context.destination);
      dryGain.gain.value = 1;
      wetGain.gain.value = 0;
      graph.current = {
        convolver,
        context,
        dryGain,
        source: mediaSource,
        wetConnected: false,
        wetGain,
      };
    } catch (cause) {
      console.error("Unable to initialize slowed reverb audio graph", cause);
      return null;
    }
    return graph.current;
  }, [recoverAudioElement]);

  const applyPreset = useCallback(
    (preset: AudioPreset) => {
      const element = audio.current;
      if (!element) return;
      setPitchPreservation(element, preset.preservePitch);
      element.defaultPlaybackRate = preset.rate;
      element.playbackRate = preset.rate;
      const audioGraph =
        graph.current ?? (preset.wet > 0 ? ensureAudioGraph() : null);
      if (!audioGraph) return;
      if (preset.wet > 0 && !audioGraph.wetConnected) {
        audioGraph.source.connect(audioGraph.convolver);
        audioGraph.wetConnected = true;
      } else if (preset.wet <= 0 && audioGraph.wetConnected) {
        try {
          audioGraph.source.disconnect(audioGraph.convolver);
        } catch {}
        audioGraph.wetConnected = false;
      }
      const now = audioGraph.context.currentTime;
      audioGraph.wetGain.gain.setTargetAtTime(preset.wet, now, 0.025);
      audioGraph.dryGain.gain.setTargetAtTime(preset.dry, now, 0.025);
    },
    [ensureAudioGraph],
  );

  const setAudioSource = useCallback((next: string) => {
    playbackAttempt.current += 1;
    setIsPlaying(false);
    setError(null);
    source.current = next;
    if (!audio.current) return;
    audio.current.crossOrigin = "anonymous";
    audio.current.src = next;
    setPitchPreservation(audio.current, presetRef.current.preservePitch);
    audio.current.defaultPlaybackRate = presetRef.current.rate;
    audio.current.playbackRate = presetRef.current.rate;
  }, []);

  const playAudioSource = useCallback(() => {
    recoverAudioElement();
    const element = audio.current;
    if (!element) return;
    applyPreset(presetRef.current);
    if (graph.current?.context.state === "suspended")
      void graph.current.context.resume().catch(() => {});
    if (source.current && element.src !== source.current) {
      element.crossOrigin = "anonymous";
      element.src = source.current;
      element.load();
    }
    const attempt = ++playbackAttempt.current;
    const attemptedSource = source.current;
    const startTimeout = window.setTimeout(() => {
      if (
        attempt !== playbackAttempt.current ||
        attemptedSource !== source.current ||
        !element.paused
      )
        return;
      playbackAttempt.current += 1;
      element.pause();
      setIsPlaying(false);
      setError(
        "Playback did not start. Check that Linux media codecs are installed, then try again.",
      );
    }, PLAYBACK_START_TIMEOUT_MS);
    void element
      .play()
      .then(
        () => {
          if (
            attempt === playbackAttempt.current &&
            attemptedSource === source.current
          ) {
            setIsPlaying(true);
            setError(null);
            resumeOnReconnect.current = false;
          }
        },
        (cause: unknown) => {
          if (
            attempt !== playbackAttempt.current ||
            attemptedSource !== source.current ||
            (cause instanceof DOMException && cause.name === "AbortError")
          )
            return;
          setIsPlaying(false);
          if (typeof navigator !== "undefined" && !navigator.onLine)
            resumeOnReconnect.current = true;
          setError(
            cause instanceof DOMException && cause.name === "NotAllowedError"
              ? "Your browser blocked audio. Allow sound for this site, then press play."
              : "This track could not be played.",
          );
        },
      )
      .finally(() => window.clearTimeout(startTimeout));
  }, [applyPreset, recoverAudioElement]);

  const setAudioVolume = useCallback((value: number | string) => {
    const next = boundedVolume(value);
    if (next === null) return;
    if (audio.current) audio.current.volume = next;
    volumeRef.current = next;
    setVolume(next);
    if (next > 0) {
      mutedRef.current = false;
      if (audio.current) audio.current.muted = false;
      setMuted(false);
    }
  }, []);
  const toggleMute = useCallback(() => {
    if (!audio.current) return;
    audio.current.muted = !audio.current.muted;
    mutedRef.current = audio.current.muted;
    setMuted(audio.current.muted);
  }, []);
  const setAudioPreset = useCallback(
    (id: AudioPresetId) => {
      const preset = getAudioPreset(id);
      presetRef.current = preset;
      setAudioPresetState(preset.id);
      applyPreset(preset);
      if (graph.current?.context.state === "suspended")
        void graph.current.context.resume().catch(() => {});
    },
    [applyPreset],
  );
  const toggleSlowedReverb = useCallback(
    () =>
      setAudioPreset(
        presetRef.current.id === "original"
          ? defaultAudioPreset.id
          : "original",
      ),
    [setAudioPreset],
  );

  useEffect(() => {
    if (graph.current?.context.state === "suspended")
      void graph.current.context.resume().catch(() => {});
  }, [audioPreset]);

  return {
    audio,
    audioPreset,
    audioVersion,
    backgroundWasPlaying,
    error,
    graph,
    isPlaying,
    muted,
    playAudioSource,
    resumeOnReconnect,
    setAudioPreset,
    setAudioSource,
    setError,
    setIsPlaying,
    setAudioVolume,
    slowedReverb: audioPreset !== "original",
    source,
    toggleMute,
    toggleSlowedReverb,
    volume,
  };
}
