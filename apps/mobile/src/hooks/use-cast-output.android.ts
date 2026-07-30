import {
  createCastSession,
  getCastSession,
  stopCastSession,
  updateCastSessionState,
  type CastSession,
} from "@parson/music-sdk";
import {
  MediaPlayerState,
  MediaRepeatMode,
  MediaStreamType,
  useCastDevice,
  useRemoteMediaClient,
  type MediaStatus,
} from "react-native-google-cast";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CastOutputOptions } from "./use-cast-output";

const castStatus = (status: MediaStatus | null) =>
  status?.playerState === MediaPlayerState.PLAYING
    ? "playing"
    : status?.playerState === MediaPlayerState.PAUSED
      ? "paused"
      : status?.playerState === MediaPlayerState.IDLE
        ? "ended"
        : "connecting";

const statusPosition = (status: MediaStatus | null, fallback: number) => {
  const position = (
    status?.mediaInfo?.customData as { parsonPosition?: unknown } | undefined
  )?.parsonPosition;
  return typeof position === "number" && Number.isInteger(position)
    ? position
    : fallback;
};

export function useCastOutput({
  currentIndex,
  pauseLocal,
  queue,
  repeat,
}: CastOutputOptions) {
  const client = useRemoteMediaClient();
  const device = useCastDevice();
  const backendSession = useRef<CastSession | null>(null);
  const queueOffset = useRef(0);
  const generation = useRef(0);
  const [casting, setCasting] = useState(false);
  const [castIndex, setCastIndex] = useState(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const loadSession = useCallback(
    async (session: CastSession, position: number) => {
      if (!client) return;
      await client.loadMedia({
        autoplay: true,
        queueData: {
          items: session.items.map((item) => ({
            autoplay: true,
            mediaInfo: {
              contentType: item.content_type,
              contentUrl: item.media_url,
              customData: { parsonPosition: item.position },
              metadata: {
                albumTitle: item.album,
                artist: item.artist,
                images: item.artwork_url ? [{ url: item.artwork_url }] : [],
                title: item.title,
                type: "musicTrack",
              },
              streamDuration: item.duration_ms / 1_000,
              streamType: MediaStreamType.BUFFERED,
            },
          })),
          repeatMode:
            repeat === "one"
              ? MediaRepeatMode.SINGLE
              : repeat === "all"
                ? MediaRepeatMode.ALL
                : MediaRepeatMode.OFF,
          startIndex: position,
        },
      });
    },
    [client, repeat],
  );

  useEffect(() => {
    if (!client || !device || !queue.length || currentIndex < 0) return;
    const request = ++generation.current;
    const offset = Math.max(0, Math.min(currentIndex, queue.length - 100));
    const castQueue = queue.slice(offset, offset + 100);
    const castPosition = currentIndex - offset;
    void createCastSession({
      current_position: castPosition,
      receiver_id: device.deviceId,
      receiver_name: device.friendlyName,
      song_ids: castQueue.map((song) => song.id),
    })
      .then(async (session) => {
        if (generation.current !== request) return;
        queueOffset.current = offset;
        backendSession.current = session;
        await loadSession(session, session.current_position);
        if (generation.current !== request) return;
        pauseLocal();
        setCastIndex(offset + session.current_position);
        setCasting(true);
      })
      .catch(() => {});
    return () => {
      generation.current += 1;
    };
  }, [client, currentIndex, device, loadSession, pauseLocal, queue]);

  useEffect(() => {
    if (!client || !casting) return;
    const status = client.onMediaStatusUpdated((next) => {
      setCastIndex((value) => {
        const fallback = Math.max(0, value - queueOffset.current);
        return queueOffset.current + statusPosition(next, fallback);
      });
      setCurrentTime(next?.streamPosition ?? 0);
      setDuration(next?.mediaInfo?.streamDuration ?? 0);
      setIsPlaying(next?.playerState === MediaPlayerState.PLAYING);
    });
    const progress = client.onMediaProgressUpdated((position, length) => {
      setCurrentTime(position);
      setDuration(length);
    }, 1);
    return () => {
      status.remove();
      progress.remove();
    };
  }, [casting, client]);

  useEffect(() => {
    if (!client || !casting) return;
    let active = true;
    const synchronize = async () => {
      const local = backendSession.current;
      if (!local) return;
      try {
        const remote = await getCastSession(local.id);
        if (!active) return;
        if (remote.status === "stopped") {
          await client.stop();
          backendSession.current = null;
          setCasting(false);
          setCastIndex(-1);
          return;
        }
        if (
          remote.command &&
          remote.command_revision > remote.acknowledged_command_revision
        ) {
          if (remote.command === "play") await client.play();
          else if (remote.command === "pause") await client.pause();
          else if (remote.command === "next") await client.queueNext();
          else if (remote.command === "previous") await client.queuePrev();
          else if (remote.command === "seek")
            await client.seek({
              position: (remote.command_position_ms ?? 0) / 1_000,
            });
          else if (remote.command === "set_volume")
            await client.setStreamVolume(remote.command_volume ?? 1);
          else if (remote.command === "set_mute")
            await client.setStreamMuted(remote.command_muted ?? false);
          else if (
            remote.command === "jump" &&
            remote.command_queue_position !== null
          )
            await loadSession(remote, remote.command_queue_position);
          else if (remote.command === "stop") {
            await client.stop();
            await stopCastSession(remote.id);
            backendSession.current = null;
            setCasting(false);
            setCastIndex(-1);
            return;
          }
        }
        const media = await client.getMediaStatus();
        if (!active) return;
        const position = statusPosition(media, remote.current_position);
        const updated = await updateCastSessionState(remote.id, {
          acknowledged_command_revision: remote.command_revision,
          current_position: position,
          duration_ms: Math.round(
            (media?.mediaInfo?.streamDuration ?? 0) * 1_000,
          ),
          muted: media?.isMuted ?? false,
          playing: media?.playerState === MediaPlayerState.PLAYING,
          position_ms: Math.round((media?.streamPosition ?? 0) * 1_000),
          revision: remote.revision,
          status: castStatus(media),
          volume: media?.volume ?? 1,
        });
        backendSession.current = {
          ...remote,
          ...updated,
          acknowledged_command_revision: remote.command_revision,
          current_position: position,
        };
      } catch {}
    };
    void synchronize();
    const timer = setInterval(() => void synchronize(), 1_500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [casting, client, loadSession]);

  useEffect(() => {
    if (device || !backendSession.current) return;
    const id = backendSession.current.id;
    backendSession.current = null;
    setCasting(false);
    setCastIndex(-1);
    void stopCastSession(id).catch(() => {});
  }, [device]);

  const next = useCallback(
    () => void client?.queueNext().catch(() => {}),
    [client],
  );
  const previous = useCallback(
    () => void client?.queuePrev().catch(() => {}),
    [client],
  );
  const seek = useCallback(
    (seconds: number) =>
      void client?.seek({ position: seconds }).catch(() => {}),
    [client],
  );
  const toggle = useCallback(
    () => void (isPlaying ? client?.pause() : client?.play())?.catch(() => {}),
    [client, isPlaying],
  );

  return useMemo(
    () => ({
      casting,
      currentIndex: castIndex,
      currentTime,
      duration,
      isPlaying,
      next,
      previous,
      seek,
      toggle,
    }),
    [
      castIndex,
      casting,
      currentTime,
      duration,
      isPlaying,
      next,
      previous,
      seek,
      toggle,
    ],
  );
}
