"use client";

import { useSession } from "@/features/account/session-provider";
import { usePlayer } from "@/features/player/player-context";
import { defaultCover } from "@/lib/images/default-cover";
import { useCallback, useState } from "react";
import {
  useCloseLyricsOnNavigation,
  useFullscreenDismiss,
  useLyrics,
  usePlayerShortcuts,
} from "./player-bar-hooks";
import { FullscreenPlayer, LyricsPanel } from "./player-overlays";
import { PlayerFooter } from "./player-footer";
import PlayerQueue from "./player-queue";
import { useMediaSession } from "./use-media-session";
import { useCastOutput } from "./use-cast-output";
import { getSongInfo } from "@parson/music-sdk";
import { useQuery } from "@tanstack/react-query";

export default function PlayerBar() {
  const {
    album,
    artist,
    currentTime,
    duration,
    handleTimeChange,
    imageSrc,
    isPlaying,
    looping,
    muted,
    playNextSong,
    playPreviousSong,
    playQueueItem,
    queue,
    setAudioVolume,
    setAudioPreset,
    slowedReverb,
    song,
    toggleLoop,
    toggleMute,
    togglePlayPause,
    toggleSlowedReverb,
    volume,
    audioPreset,
    audioPresets,
  } = usePlayer();
  const { session } = useSession();
  const cast = useCastOutput();
  const castItem = cast.session?.items[cast.session.current_position] ?? null;
  const castSong = useQuery({
    queryKey: ["cast-song", castItem?.song_id],
    queryFn: () => getSongInfo(castItem!.song_id, false),
    enabled: Boolean(castItem?.song_id),
    staleTime: 5 * 60_000,
  }).data;
  const effectiveSong = castSong || song;
  const casting = Boolean(cast.session && castItem);
  const effectiveCurrentTime = casting
    ? (cast.session?.position_ms ?? 0) / 1000
    : currentTime;
  const effectiveDuration = casting
    ? (cast.session?.duration_ms || castItem?.duration_ms || 0) / 1000
    : duration;
  const effectivePlaying = casting ? Boolean(cast.session?.playing) : isPlaying;
  const effectiveVolume = casting ? (cast.session?.volume ?? volume) : volume;
  const effectiveMuted = casting ? Boolean(cast.session?.muted) : muted;
  const effectiveCover = castItem?.artwork_url || imageSrc || defaultCover;
  const effectiveTitle = castItem?.title || effectiveSong.name;
  const effectiveArtist =
    castItem?.artist ||
    effectiveSong.artist_object.name ||
    effectiveSong.artist;
  const togglePlayback = casting
    ? () => cast.send({ command: cast.session?.playing ? "pause" : "play" })
    : togglePlayPause;
  const next = casting ? () => cast.send({ command: "next" }) : playNextSong;
  const previous = casting
    ? () => cast.send({ command: "previous" })
    : playPreviousSong;
  const seek = casting
    ? (value: number | string) => {
        const seconds = Number(value);
        if (Number.isFinite(seconds))
          cast.send({
            command: "seek",
            position_ms: Math.max(0, Math.round(seconds * 1000)),
          });
      }
    : handleTimeChange;
  const changeVolume = casting
    ? (value: number | string) => {
        const level = Number(value) / 100;
        if (Number.isFinite(level))
          cast.send({
            command: "set_volume",
            volume: Math.min(1, Math.max(0, level)),
          });
      }
    : setAudioVolume;
  const toggleOutputMute = casting
    ? () => cast.send({ command: "set_mute", muted: !cast.session?.muted })
    : toggleMute;
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const closeLyrics = useCallback(() => setLyricsOpen(false), []);
  const closeFullscreen = useCallback(() => {
    setFullscreenOpen(false);
    setLyricsOpen(false);
    setQueueOpen(false);
  }, []);
  const closeQueue = useCallback(() => setQueueOpen(false), []);
  const cover = effectiveCover;
  const playbackRate =
    audioPresets.find((preset) => preset.id === audioPreset)?.rate ?? 1;

  usePlayerShortcuts({
    currentTime: effectiveCurrentTime,
    duration: effectiveDuration,
    enabled: Boolean(song.id || castItem),
    onNext: next,
    onPrevious: previous,
    onRepeat: toggleLoop,
    onSeek: seek,
    onToggleMute: toggleOutputMute,
    onTogglePlayback: togglePlayback,
  });
  useMediaSession({
    album: effectiveSong.album_object.name || album.name,
    artist: effectiveArtist,
    artwork: cover,
    currentTime: effectiveCurrentTime,
    duration: effectiveDuration,
    isPlaying: effectivePlaying,
    onNext: next,
    onPause: togglePlayback,
    onPlay: togglePlayback,
    onPrevious: previous,
    onSeek: seek,
    title: effectiveTitle,
  });
  const {
    activeLine,
    activeLineRef,
    fallback: fallbackLyrics,
    instrumental: lyricsInstrumental,
    loading: lyricsLoading,
    scrollRef: lyricsScrollRef,
    timed: timedLyrics,
  } = useLyrics(effectiveSong, effectiveCurrentTime, lyricsOpen);
  useFullscreenDismiss(fullscreenOpen, closeFullscreen);
  useCloseLyricsOnNavigation(closeLyrics);

  if (!song.id && !castItem) return null;

  return (
    <>
      {fullscreenOpen && (
        <FullscreenPlayer
          activeLine={activeLine}
          activeLineRef={activeLineRef}
          albumName={effectiveSong.album_object.name || album.name}
          artistId={effectiveSong.artist_object.id || artist.id}
          artistName={effectiveArtist}
          cover={cover}
          currentTime={effectiveCurrentTime}
          duration={effectiveDuration}
          isPlaying={effectivePlaying}
          looping={looping}
          lyricsOpen={lyricsOpen}
          lyricsFallback={fallbackLyrics}
          lyricsInstrumental={lyricsInstrumental}
          lyricsLoading={lyricsLoading}
          lyricsScrollRef={lyricsScrollRef}
          muted={effectiveMuted}
          onClose={closeFullscreen}
          onNext={next}
          onOpenLyrics={() => {
            setQueueOpen(false);
            setLyricsOpen(true);
          }}
          onOpenQueue={() => {
            setLyricsOpen(false);
            setQueueOpen(true);
          }}
          onBackToPlayer={() => {
            setLyricsOpen(false);
            setQueueOpen(false);
          }}
          onPrevious={previous}
          onSelectQueueItem={(index) => {
            playQueueItem(index);
            setLyricsOpen(false);
            setQueueOpen(false);
          }}
          onSeek={seek}
          onToggleLoop={toggleLoop}
          onToggleMute={toggleOutputMute}
          onTogglePlayback={togglePlayback}
          onToggleSound={toggleSlowedReverb}
          onVolumeChange={changeVolume}
          playbackRate={playbackRate}
          queue={queue}
          queueOpen={queueOpen}
          slowedReverb={slowedReverb}
          songId={castItem?.song_id || song.id}
          title={effectiveTitle}
          timedLyrics={timedLyrics}
          volume={effectiveVolume}
        />
      )}

      {lyricsOpen && !fullscreenOpen && (
        <LyricsPanel
          activeLine={activeLine}
          activeLineRef={activeLineRef}
          cover={cover}
          fallback={fallbackLyrics}
          instrumental={lyricsInstrumental}
          loading={lyricsLoading}
          scrollRef={lyricsScrollRef}
          onSeek={handleTimeChange}
          timed={timedLyrics}
        />
      )}

      {queueOpen && !fullscreenOpen && (
        <PlayerQueue
          currentSongId={song.id}
          onClose={closeQueue}
          onSelect={(index) => playQueueItem(index)}
          queue={queue}
        />
      )}

      <PlayerFooter
        admin={session?.role === "admin"}
        albumId={effectiveSong.album_object.id || album.id}
        artistId={effectiveSong.artist_object.id || artist.id}
        artistName={effectiveArtist}
        audioPreset={audioPreset}
        audioPresets={audioPresets}
        cover={cover}
        currentTime={effectiveCurrentTime}
        duration={effectiveDuration}
        isPlaying={effectivePlaying}
        lyricsOpen={lyricsOpen}
        muted={effectiveMuted}
        onNext={next}
        onOpenFullscreen={() => {
          setLyricsOpen(false);
          setFullscreenOpen(true);
        }}
        onPrevious={previous}
        onOpenQueue={() => setQueueOpen((open) => !open)}
        onSeek={seek}
        onSelectPreset={setAudioPreset}
        onToggleLyrics={() => setLyricsOpen((open) => !open)}
        onToggleMute={toggleOutputMute}
        onTogglePlayback={togglePlayback}
        onToggleSound={toggleSlowedReverb}
        onVolumeChange={changeVolume}
        playbackRate={playbackRate}
        queueOpen={queueOpen}
        slowedReverb={slowedReverb}
        songId={castItem?.song_id || song.id}
        title={effectiveTitle}
        volume={effectiveVolume}
      />
    </>
  );
}
