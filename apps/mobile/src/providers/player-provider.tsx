import {
  fillReverbImpulseChannel,
  getPlayerAudioPreset,
  playerAudioPresets,
  reverbImpulseLength,
  type LibrarySong,
  type PlayerAudioPresetId,
} from "@parson/music-sdk";
import * as Haptics from "expo-haptics";
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer as ExpoAudioPlayer,
} from "expo-audio";
import {
  Audio,
  AudioContext,
  AudioManager,
  PlaybackNotificationManager,
  type AudioTagHandle,
  type ConvolverNode,
  type GainNode,
  type MediaElementAudioSourceNode,
} from "react-native-audio-api";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PropsWithChildren,
  type RefObject,
  type SetStateAction,
} from "react";
import { Platform } from "react-native";

import { freshAuthorizationHeaders, imageUrl, streamUrl } from "@/lib/runtime";
import { downloadedSongUri, hydrateDownloads } from "@/lib/downloads";
import { shouldRestartFinishedTrack } from "@/lib/playback-state";
import { useSession } from "@/providers/session-provider";

type RepeatMode = "none" | "one" | "all";
export type AudioPreset = PlayerAudioPresetId;

type PlaybackSource = {
  autoplay: boolean;
  key: number;
  retryCount: number;
  value: { uri: string; headers?: Record<string, string> };
};

type NativeAudioGraph = {
  convolver: ConvolverNode;
  dryGain: GainNode;
  source: MediaElementAudioSourceNode | null;
  wetConnected: boolean;
  wetGain: GainNode;
};

type PlaybackControls = {
  cleanup: () => void;
  interrupt: () => boolean;
  next: () => void;
  pause: () => void;
  play: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
};

type PlayerContextValue = {
  current: LibrarySong | null;
  currentIndex: number;
  error: string | null;
  isBuffering: boolean;
  isPlaying: boolean;
  queue: LibrarySong[];
  repeat: RepeatMode;
  audioPreset: AudioPreset;
  audioPresetsEnabled: boolean;
  playSong: (song: LibrarySong, queue?: LibrarySong[]) => void;
  playAt: (index: number) => void;
  addNext: (song: LibrarySong) => void;
  addToQueue: (songs: LibrarySong[]) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  cycleRepeat: () => void;
  setAudioPreset: (preset: AudioPreset) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);
const PlayerPositionContext = createContext({ currentTime: 0, duration: 0 });

function buildReverbImpulse(context: AudioContext) {
  const length = reverbImpulseLength(context.sampleRate);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    fillReverbImpulseChannel(impulse.getChannelData(channel), channel);
  }
  return impulse;
}

function disconnectSource(graph: NativeAudioGraph) {
  if (!graph.source) return;
  try {
    graph.source.disconnect();
  } catch {}
  graph.source = null;
  graph.wetConnected = false;
}

function useNativePlaybackControls(controls: PlaybackControls) {
  const controlsRef = useRef(controls);
  const interruptedWhilePlaying = useRef(false);

  useEffect(() => {
    controlsRef.current = controls;
  }, [controls]);

  useEffect(() => {
    void hydrateDownloads();
    if (Platform.OS === "android") return;
    AudioManager.setAudioSessionOptions({
      iosCategory: "playback",
      iosMode: "default",
      iosNotifyOthersOnDeactivation: true,
    });
    AudioManager.observeAudioInterruptions("gain");

    const interruption = AudioManager.addSystemEventListener(
      "interruption",
      ({ type, shouldResume }) => {
        if (type === "began") {
          interruptedWhilePlaying.current = controlsRef.current.interrupt();
          return;
        }
        if (shouldResume && interruptedWhilePlaying.current) {
          interruptedWhilePlaying.current = false;
          controlsRef.current.play();
        }
      },
    );
    const subscriptions = [
      interruption,
      PlaybackNotificationManager.addEventListener(
        "playbackNotificationPlay",
        () => controlsRef.current.play(),
      ),
      PlaybackNotificationManager.addEventListener(
        "playbackNotificationPause",
        () => controlsRef.current.pause(),
      ),
      PlaybackNotificationManager.addEventListener(
        "playbackNotificationNextTrack",
        () => controlsRef.current.next(),
      ),
      PlaybackNotificationManager.addEventListener(
        "playbackNotificationPreviousTrack",
        () => controlsRef.current.previous(),
      ),
      PlaybackNotificationManager.addEventListener(
        "playbackNotificationSeekTo",
        ({ value }) => controlsRef.current.seek(value),
      ),
    ];

    return () => {
      subscriptions.forEach((subscription) => subscription?.remove());
      controlsRef.current.cleanup();
      void PlaybackNotificationManager.hide().catch(() => {});
      void AudioManager.setAudioSessionActivity(false).catch(() => {});
    };
  }, []);
}

function usePlaybackNotification({
  current,
  currentTime,
  duration,
  isPlaying,
  rate,
}: {
  current: LibrarySong | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  rate: number;
}) {
  const controlsEnabled = useRef(false);
  const permissionRequested = useRef(false);
  const notificationUpdates = useRef<Promise<void>>(Promise.resolve());
  const elapsedTime = Math.floor(currentTime / 30) * 30;

  useEffect(() => {
    if (Platform.OS === "android") return;
    const artwork = current
      ? imageUrl(current.album_object?.cover_url)
      : undefined;

    // Older Android versions require serialized notification updates.
    notificationUpdates.current = notificationUpdates.current
      .catch(() => {})
      .then(async () => {
        if (!current) {
          controlsEnabled.current = false;
          await PlaybackNotificationManager.hide();
          return;
        }
        if (Platform.OS === "android" && !permissionRequested.current) {
          permissionRequested.current = true;
          await AudioManager.requestNotificationPermissions();
        }
        if (!controlsEnabled.current) {
          await PlaybackNotificationManager.enableControl("play", true);
          await PlaybackNotificationManager.enableControl("pause", true);
          await PlaybackNotificationManager.enableControl(
            "previousTrack",
            true,
          );
          await PlaybackNotificationManager.enableControl("nextTrack", true);
          await PlaybackNotificationManager.enableControl("seekTo", true);
          controlsEnabled.current = true;
        }
        await PlaybackNotificationManager.show({
          title: current.name,
          artist: current.artist,
          album: current.album_object?.name,
          artwork: artwork ? { uri: artwork } : undefined,
          duration,
          elapsedTime,
          speed: rate,
          state: isPlaying ? "playing" : "paused",
        });
      })
      .catch(() => {
        controlsEnabled.current = false;
      });
  }, [current, duration, elapsedTime, isPlaying, rate]);
}

function schedulePlaybackRetry(
  source: PlaybackSource,
  desiredPlayingRef: RefObject<boolean>,
  sourceSequenceRef: RefObject<number>,
  setPlaybackSource: Dispatch<SetStateAction<PlaybackSource | null>>,
) {
  if (
    !desiredPlayingRef.current ||
    source.retryCount >= 2 ||
    !/^https?:\/\//i.test(source.value.uri)
  ) {
    return false;
  }
  const failedKey = source.key;
  setTimeout(
    () => {
      setPlaybackSource((activeSource) =>
        activeSource?.key === failedKey && desiredPlayingRef.current
          ? {
              ...activeSource,
              key: ++sourceSequenceRef.current,
              retryCount: activeSource.retryCount + 1,
            }
          : activeSource,
      );
    },
    600 * (source.retryCount + 1),
  );
  return true;
}

function useAndroidAudioOutput({
  current,
  playbackSource,
  androidPlayerRef,
  playbackSourceRef,
  desiredPlayingRef,
  endedHandlerRef,
  sourceSequenceRef,
  setPlaybackSource,
  setCurrentTime,
  setDuration,
  setIsBuffering,
  setIsPlaying,
  setPlaybackError,
}: {
  current: LibrarySong | null;
  playbackSource: PlaybackSource | null;
  androidPlayerRef: RefObject<ExpoAudioPlayer | null>;
  playbackSourceRef: RefObject<PlaybackSource | null>;
  desiredPlayingRef: RefObject<boolean>;
  endedHandlerRef: RefObject<() => void>;
  sourceSequenceRef: RefObject<number>;
  setPlaybackSource: Dispatch<SetStateAction<PlaybackSource | null>>;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  setDuration: Dispatch<SetStateAction<number>>;
  setIsBuffering: Dispatch<SetStateAction<boolean>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setPlaybackError: Dispatch<SetStateAction<string | null>>;
}) {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void setAudioModeAsync({
      interruptionMode: "doNotMix",
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    }).catch((cause) =>
      console.error("Could not configure Android audio", cause),
    );

    const player = createAudioPlayer(null, {
      keepAudioSessionActive: true,
      preferredForwardBufferDuration: 15,
      updateInterval: 250,
    });
    androidPlayerRef.current = player;
    let finishedSourceKey = -1;
    const subscription = player.addListener(
      "playbackStatusUpdate",
      (status) => {
        if (Number.isFinite(status.currentTime))
          setCurrentTime(status.currentTime);
        if (Number.isFinite(status.duration) && status.duration > 0) {
          setDuration(status.duration);
        }
        setIsBuffering(
          status.isBuffering || (desiredPlayingRef.current && !status.isLoaded),
        );
        // Ignore stale native state while replacing the source.
        if (status.playing) setIsPlaying(true);
        else if (!desiredPlayingRef.current) setIsPlaying(false);

        const source = playbackSourceRef.current;
        if (status.error && source) {
          console.error("Could not load Android audio source", status.error);
          if (
            !schedulePlaybackRetry(
              source,
              desiredPlayingRef,
              sourceSequenceRef,
              setPlaybackSource,
            )
          ) {
            desiredPlayingRef.current = false;
            setIsBuffering(false);
            setIsPlaying(false);
            setPlaybackError(
              "Playback failed. Check your connection and try again.",
            );
          }
        }
        if (
          status.didJustFinish &&
          source &&
          finishedSourceKey !== source.key
        ) {
          finishedSourceKey = source.key;
          endedHandlerRef.current();
        }
      },
    );
    return () => {
      subscription.remove();
      player.clearLockScreenControls();
      player.remove();
      androidPlayerRef.current = null;
    };
  }, [
    androidPlayerRef,
    desiredPlayingRef,
    endedHandlerRef,
    playbackSourceRef,
    setCurrentTime,
    setDuration,
    setIsBuffering,
    setIsPlaying,
    setPlaybackSource,
    setPlaybackError,
    sourceSequenceRef,
  ]);

  useEffect(() => {
    if (Platform.OS !== "android" || !playbackSource) return;
    const player = androidPlayerRef.current;
    if (!player) return;
    setIsBuffering(true);
    player.replace(playbackSource.value);
    player.loop = false;
    if (current) {
      player.setActiveForLockScreen(true, {
        albumTitle: current.album_object?.name,
        artist: current.artist,
        artworkUrl: imageUrl(current.album_object?.cover_url) ?? undefined,
        title: current.name,
      });
    }
    if (playbackSource.autoplay && desiredPlayingRef.current) player.play();
  }, [
    androidPlayerRef,
    current,
    desiredPlayingRef,
    playbackSource,
    setIsBuffering,
  ]);
}

function BrowserAudioOutput({
  playbackSource,
  currentRate,
  preservePitch,
  audioRef,
  audioContext,
  desiredPlayingRef,
  sourceSequenceRef,
  setPlaybackSource,
  setCurrentTime,
  setIsBuffering,
  setIsPlaying,
  setPlaybackError,
  routeLoadedSource,
  handleEnded,
}: {
  playbackSource: PlaybackSource;
  currentRate: number;
  preservePitch: boolean;
  audioRef: RefObject<AudioTagHandle | null>;
  audioContext: AudioContext;
  desiredPlayingRef: RefObject<boolean>;
  sourceSequenceRef: RefObject<number>;
  setPlaybackSource: Dispatch<SetStateAction<PlaybackSource | null>>;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  setIsBuffering: Dispatch<SetStateAction<boolean>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setPlaybackError: Dispatch<SetStateAction<string | null>>;
  routeLoadedSource: () => void;
  handleEnded: () => void;
}) {
  return (
    <Audio
      key={playbackSource.key}
      ref={audioRef}
      context={audioContext}
      source={playbackSource.value}
      autoPlay={Platform.OS === "web" ? playbackSource.autoplay : false}
      playbackRate={currentRate}
      preservesPitch={preservePitch}
      preload="auto"
      onLoadStart={() => setIsBuffering(true)}
      onLoad={routeLoadedSource}
      onError={(error) => {
        console.error("Could not load audio source", error);
        if (
          schedulePlaybackRetry(
            playbackSource,
            desiredPlayingRef,
            sourceSequenceRef,
            setPlaybackSource,
          )
        ) {
          setIsBuffering(true);
          return;
        }
        desiredPlayingRef.current = false;
        setIsBuffering(false);
        setIsPlaying(false);
        setPlaybackError(
          "Playback failed. Check your connection and try again.",
        );
      }}
      onPositionChange={setCurrentTime}
      onEnded={handleEnded}
      onPlay={() => {
        desiredPlayingRef.current = true;
        setIsBuffering(false);
        setIsPlaying(true);
      }}
      onPause={() => setIsPlaying(false)}
    />
  );
}

export function PlayerProvider({ children }: PropsWithChildren) {
  const session = useSession();
  const [audioContext] = useState(() => new AudioContext());
  const audioRef = useRef<AudioTagHandle>(null);
  const androidPlayerRef = useRef<ExpoAudioPlayer | null>(null);
  const graphRef = useRef<NativeAudioGraph | null>(null);
  const sourceSequence = useRef(0);
  const desiredPlaying = useRef(false);
  const endedHandlerRef = useRef<() => void>(() => {});
  const playbackSourceRef = useRef<PlaybackSource | null>(null);

  const [queue, setQueue] = useState<LibrarySong[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [repeat, setRepeat] = useState<RepeatMode>("none");
  const [audioPreset, setAudioPresetState] = useState<AudioPreset>("original");
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource | null>(
    null,
  );

  useEffect(() => {
    if (session.claims || session.phase === "offline") return;
    const reset = setTimeout(() => {
      sourceSequence.current += 1;
      desiredPlaying.current = false;
      audioRef.current?.pause();
      const androidPlayer = androidPlayerRef.current;
      if (androidPlayer) {
        androidPlayer.pause();
        androidPlayer.replace(null);
        androidPlayer.clearLockScreenControls();
      }
      if (graphRef.current) disconnectSource(graphRef.current);
      setPlaybackSource(null);
      setQueue([]);
      setCurrentIndex(-1);
      setCurrentTime(0);
      setDuration(0);
      setIsBuffering(false);
      setIsPlaying(false);
      setPlaybackError(null);
    }, 0);
    return () => clearTimeout(reset);
  }, [session.claims, session.phase]);

  const current = queue[currentIndex] ?? null;
  const preset = getPlayerAudioPreset(audioPreset);
  const audioPresetsEnabled = Platform.OS !== "android";
  const effectivePreset = audioPresetsEnabled
    ? preset
    : getPlayerAudioPreset("original");

  const ensureGraph = useCallback(() => {
    if (graphRef.current) return graphRef.current;
    const dryGain = audioContext.createGain();
    const wetGain = audioContext.createGain();
    const convolver = audioContext.createConvolver();
    convolver.buffer = buildReverbImpulse(audioContext);
    dryGain.gain.value = 1;
    wetGain.gain.value = 0;
    dryGain.connect(audioContext.destination);
    convolver.connect(wetGain);
    wetGain.connect(audioContext.destination);
    graphRef.current = {
      convolver,
      dryGain,
      source: null,
      wetConnected: false,
      wetGain,
    };
    return graphRef.current;
  }, [audioContext]);

  const applyPreset = useCallback(
    (presetId: AudioPreset) => {
      const next = getPlayerAudioPreset(presetId);
      audioRef.current?.setPlaybackRate(next.rate);
      const graph = graphRef.current;
      if (!graph) return;
      const now = audioContext.currentTime;
      graph.dryGain.gain.setTargetAtTime(next.dry, now, 0.025);
      graph.wetGain.gain.setTargetAtTime(next.wet, now, 0.025);
      if (next.wet > 0 && graph.source && !graph.wetConnected) {
        graph.source.connect(graph.convolver);
        graph.wetConnected = true;
      } else if (next.wet === 0 && graph.source && graph.wetConnected) {
        try {
          graph.source.disconnect(graph.convolver);
        } catch {}
        graph.wetConnected = false;
      }
    },
    [audioContext],
  );

  const routeLoadedSource = useCallback(() => {
    setIsBuffering(false);
    const audio = audioRef.current;
    if (!audio || Platform.OS === "web") return;
    const playWhenRequested = () => {
      if (!desiredPlaying.current) return;
      void AudioManager.setAudioSessionActivity(true).catch(() => {});
      audio.play();
    };
    // Older Android audio stacks underrun with the effects graph.
    if (Platform.OS === "android") {
      audio.setPlaybackRate(1);
      playWhenRequested();
      return;
    }
    try {
      const graph = ensureGraph();
      disconnectSource(graph);
      const source = audioContext.createMediaElementSource(audio);
      source.connect(graph.dryGain);
      graph.source = source;
      applyPreset(audioPreset);
      playWhenRequested();
    } catch (cause) {
      setIsPlaying(false);
      desiredPlaying.current = false;
      console.error("Could not initialize native convolution audio", cause);
    }
  }, [applyPreset, audioContext, audioPreset, ensureGraph]);

  const sourceFor = useCallback(
    async (song: LibrarySong) => {
      const local = downloadedSongUri(song.id);
      const bitrate = session.claims?.bitrate ?? 0;
      return {
        // Native decoding expects a decoded path, not an Expo file URI.
        uri: local ? decodeURI(local) : streamUrl(song.id, bitrate),
        headers: local ? undefined : await freshAuthorizationHeaders(),
      };
    },
    [session.claims?.bitrate],
  );

  const loadAt = useCallback(
    (songs: LibrarySong[], index: number, autoplay = true) => {
      const song = songs[index];
      if (!song) return;
      setQueue(songs);
      setCurrentIndex(index);
      setCurrentTime(0);
      setDuration(Math.max(0, song.duration || 0));
      setIsBuffering(true);
      setIsPlaying(autoplay);
      setPlaybackError(null);
      desiredPlaying.current = autoplay;
      audioRef.current?.pause();
      androidPlayerRef.current?.pause();
      setPlaybackSource(null);
      const key = ++sourceSequence.current;
      void sourceFor(song)
        .then((value) => {
          if (sourceSequence.current !== key) return;
          setPlaybackSource({ autoplay, key, retryCount: 0, value });
        })
        .catch((cause) => {
          if (sourceSequence.current !== key) return;
          desiredPlaying.current = false;
          setIsBuffering(false);
          setIsPlaying(false);
          setPlaybackError("Could not prepare this song for playback.");
          console.error("Could not prepare audio source", cause);
        });
    },
    [sourceFor],
  );

  const playSong = useCallback(
    (song: LibrarySong, songs = [song]) => {
      const index = Math.max(
        0,
        songs.findIndex((item) => item.id === song.id),
      );
      loadAt(songs, index);
    },
    [loadAt],
  );

  const playAt = useCallback(
    (index: number) => loadAt(queue, index),
    [loadAt, queue],
  );

  const addNext = useCallback(
    (song: LibrarySong) => {
      setQueue((items) => {
        const insert = Math.max(0, currentIndex + 1);
        return [...items.slice(0, insert), song, ...items.slice(insert)];
      });
    },
    [currentIndex],
  );

  const addToQueue = useCallback((songs: LibrarySong[]) => {
    if (songs.length) setQueue((items) => [...items, ...songs]);
  }, []);

  const play = useCallback(() => {
    if (!current) return;
    if (playbackError) {
      loadAt(queue, currentIndex);
      return;
    }
    if (shouldRestartFinishedTrack(currentTime, duration)) {
      if (Platform.OS === "android") {
        void androidPlayerRef.current?.seekTo(0);
      } else {
        audioRef.current?.seekToTime(0);
      }
      setCurrentTime(0);
    }
    desiredPlaying.current = true;
    setIsPlaying(true);
    if (Platform.OS === "android") {
      androidPlayerRef.current?.play();
      return;
    }
    if (isBuffering) return;
    void AudioManager.setAudioSessionActivity(true).catch(() => {});
    audioRef.current?.play();
  }, [
    current,
    currentIndex,
    currentTime,
    duration,
    isBuffering,
    loadAt,
    playbackError,
    queue,
  ]);

  const pause = useCallback(() => {
    desiredPlaying.current = false;
    if (Platform.OS === "android") {
      androidPlayerRef.current?.pause();
      setIsPlaying(false);
      return;
    }
    audioRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const interrupt = useCallback(() => {
    const wasPlaying = desiredPlaying.current;
    if (Platform.OS === "android") {
      androidPlayerRef.current?.pause();
      setIsPlaying(false);
      return wasPlaying;
    }
    audioRef.current?.pause();
    setIsPlaying(false);
    return wasPlaying;
  }, []);

  const next = useCallback(() => {
    if (!queue.length) return;
    const nextIndex = currentIndex + 1;
    if (nextIndex < queue.length) loadAt(queue, nextIndex);
    else if (repeat === "all") loadAt(queue, 0);
    else {
      desiredPlaying.current = false;
      setIsPlaying(false);
    }
  }, [currentIndex, loadAt, queue, repeat]);

  const seek = useCallback(
    (seconds: number) => {
      const target = Math.max(0, Math.min(seconds, duration || seconds));
      if (Platform.OS === "android") {
        void androidPlayerRef.current?.seekTo(target);
      } else {
        audioRef.current?.seekToTime(target);
      }
      setCurrentTime(target);
    },
    [duration],
  );

  const previous = useCallback(() => {
    if (currentTime > 3) {
      seek(0);
      return;
    }
    const previousIndex = currentIndex - 1;
    if (previousIndex >= 0) loadAt(queue, previousIndex);
    else seek(0);
  }, [currentIndex, currentTime, loadAt, queue, seek]);

  const toggle = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    if (desiredPlaying.current) pause();
    else play();
  }, [pause, play]);

  const setAudioPreset = useCallback(
    (presetId: AudioPreset) => {
      if (!audioPresetsEnabled) return;
      if (presetId === audioPreset) return;
      setAudioPresetState(presetId);
      applyPreset(presetId);
    },
    [applyPreset, audioPreset, audioPresetsEnabled],
  );

  const cycleRepeat = useCallback(() => {
    setRepeat((value) =>
      value === "none" ? "all" : value === "all" ? "one" : "none",
    );
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    if (repeat === "one") loadAt(queue, currentIndex);
    else next();
  }, [currentIndex, loadAt, next, queue, repeat]);

  useEffect(() => {
    endedHandlerRef.current = handleEnded;
  }, [handleEnded]);

  useEffect(() => {
    playbackSourceRef.current = playbackSource;
  }, [playbackSource]);

  useAndroidAudioOutput({
    current,
    playbackSource,
    androidPlayerRef,
    playbackSourceRef,
    desiredPlayingRef: desiredPlaying,
    endedHandlerRef,
    sourceSequenceRef: sourceSequence,
    setPlaybackSource,
    setCurrentTime,
    setDuration,
    setIsBuffering,
    setIsPlaying,
    setPlaybackError,
  });

  const cleanup = useCallback(() => {
    if (graphRef.current) disconnectSource(graphRef.current);
  }, []);

  const playbackControls = useMemo(
    () => ({ cleanup, interrupt, next, pause, play, previous, seek }),
    [cleanup, interrupt, next, pause, play, previous, seek],
  );
  useNativePlaybackControls(playbackControls);
  usePlaybackNotification({
    current,
    currentTime,
    duration,
    isPlaying,
    rate: effectivePreset.rate,
  });

  const value = useMemo<PlayerContextValue>(
    () => ({
      current,
      currentIndex,
      error: playbackError,
      isBuffering,
      isPlaying,
      queue,
      repeat,
      audioPreset,
      audioPresetsEnabled,
      playSong,
      playAt,
      addNext,
      addToQueue,
      toggle,
      next,
      previous,
      seek,
      cycleRepeat,
      setAudioPreset,
    }),
    [
      addNext,
      addToQueue,
      audioPreset,
      audioPresetsEnabled,
      current,
      currentIndex,
      cycleRepeat,
      playbackError,
      isBuffering,
      isPlaying,
      next,
      playAt,
      playSong,
      previous,
      queue,
      repeat,
      seek,
      setAudioPreset,
      toggle,
    ],
  );
  const position = useMemo(
    () => ({ currentTime, duration }),
    [currentTime, duration],
  );

  return (
    <PlayerContext.Provider value={value}>
      <PlayerPositionContext.Provider value={position}>
        {children}
      </PlayerPositionContext.Provider>
      {playbackSource && Platform.OS !== "android" ? (
        <BrowserAudioOutput
          playbackSource={playbackSource}
          currentRate={effectivePreset.rate}
          preservePitch={effectivePreset.preservePitch}
          audioRef={audioRef}
          audioContext={audioContext}
          desiredPlayingRef={desiredPlaying}
          sourceSequenceRef={sourceSequence}
          setPlaybackSource={setPlaybackSource}
          setCurrentTime={setCurrentTime}
          setIsBuffering={setIsBuffering}
          setIsPlaying={setIsPlaying}
          setPlaybackError={setPlaybackError}
          routeLoadedSource={routeLoadedSource}
          handleEnded={handleEnded}
        />
      ) : null}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("usePlayer must be used inside PlayerProvider.");
  return value;
}

export function usePlayerPosition() {
  return useContext(PlayerPositionContext);
}

export { playerAudioPresets };
