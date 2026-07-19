"use client";

import SongEditor from "@/features/library/song-editor";
import FavoriteButton from "@/features/library/favorite-button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  AudioLines,
  Check,
  Ellipsis,
  ListMusic,
  LockKeyhole,
  Maximize2,
  MicVocal,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AudioPreset, AudioPresetId } from "./audio-presets";
import {
  ActionButton,
  PlaybackControls,
  Timeline,
  VolumeControl,
} from "./player-controls";
import { CastOutputButton } from "./cast-output";

export function PlayerFooter({
  admin,
  albumId,
  artistId,
  artistName,
  audioPreset,
  audioPresets,
  cover,
  currentTime,
  duration,
  isPlaying,
  lyricsOpen,
  muted,
  onNext,
  onOpenFullscreen,
  onOpenQueue,
  onPrevious,
  onSeek,
  onSelectPreset,
  onToggleLyrics,
  onToggleMute,
  onTogglePlayback,
  onToggleSound,
  onVolumeChange,
  playbackRate,
  queueOpen,
  slowedReverb,
  songId,
  title,
  volume,
}: {
  admin: boolean;
  albumId: string;
  artistId: string;
  artistName: string;
  audioPreset: AudioPresetId;
  audioPresets: readonly AudioPreset[];
  cover: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  lyricsOpen: boolean;
  muted: boolean;
  onNext: () => void;
  onOpenFullscreen: () => void;
  onOpenQueue: () => void;
  onPrevious: () => void;
  onSeek: (value: number) => void;
  onSelectPreset: (id: AudioPresetId) => void;
  onToggleLyrics: () => void;
  onToggleMute: () => void;
  onTogglePlayback: () => void;
  onToggleSound: () => void;
  onVolumeChange: (value: number) => void;
  playbackRate: number;
  queueOpen: boolean;
  slowedReverb: boolean;
  songId: string;
  title: string;
  volume: number;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <footer className="fixed bottom-[80px] left-2 right-2 z-50 isolate overflow-visible rounded-[14px] border border-white/10 bg-[#080808] px-3 py-2 text-white shadow-[0_20px_70px_rgba(0,0,0,0.72)] md:bottom-4 md:left-[calc(50%+40px)] md:right-auto md:w-[min(900px,calc(100vw-112px))] md:-translate-x-1/2 md:rounded-[24px] md:px-4 md:py-4 md:pl-5 md:pr-3">
          <button
            aria-label={`Open now playing: ${title}`}
            className="absolute inset-0 z-20 rounded-[14px] md:hidden"
            onClick={onOpenFullscreen}
            type="button"
          />
          <div className="relative z-10 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 lg:grid-cols-[minmax(0,1fr)_300px_minmax(0,1fr)] lg:gap-x-4">
            <TrackInfo
              albumId={albumId}
              artistId={artistId}
              artistName={artistName}
              cover={cover}
              songId={songId}
              title={title}
            />
            <section className="relative z-30 flex min-w-0 flex-col items-center gap-1.5 lg:w-[300px]">
              <PlaybackControls
                compact
                isPlaying={isPlaying}
                onNext={onNext}
                onPrevious={onPrevious}
                onToggle={onTogglePlayback}
              />
              <Timeline
                className="hidden w-full md:flex"
                currentTime={currentTime}
                duration={duration}
                onChange={onSeek}
                playbackRate={playbackRate}
              />
            </section>
            <section className="relative z-30 flex items-center justify-end gap-1.5 lg:justify-self-end">
              <span className="hidden md:inline" data-player-queue-trigger>
                <ActionButton
                  active={queueOpen}
                  label="Queue"
                  onClick={onOpenQueue}
                >
                  <ListMusic className="h-4 w-4" />
                </ActionButton>
              </span>
              <div className="hidden sm:block">
                <ActionButton
                  active={lyricsOpen}
                  label="Lyrics"
                  onClick={onToggleLyrics}
                >
                  <MicVocal className="h-4 w-4" />
                </ActionButton>
              </div>
              <div className="hidden sm:block">
                <ActionButton
                  active={slowedReverb}
                  label="Sound"
                  onClick={onToggleSound}
                >
                  <AudioLines className="h-4 w-4" />
                </ActionButton>
              </div>
              <div className="hidden sm:block">
                <VolumeControl
                  muted={muted}
                  onChange={onVolumeChange}
                  onToggleMute={onToggleMute}
                  volume={volume}
                />
              </div>
              <div className="group/more relative">
                <button
                  aria-label="More controls"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white"
                  type="button"
                >
                  <Ellipsis className="h-5 w-5" />
                </button>
                <div className="absolute bottom-full right-0 z-[80] hidden w-52 pb-3 group-hover/more:block group-focus-within/more:block">
                  <div className="max-h-[min(360px,calc(100vh-120px))] overflow-y-auto rounded-xl border border-white/10 bg-black p-1.5 shadow-2xl">
                    <CastOutputButton menuItem />
                    <div className="my-1.5 h-px bg-white/10" />
                    <div className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                      Sound
                    </div>
                    {audioPresets.map((preset) => (
                      <button
                        key={preset.id}
                        aria-pressed={audioPreset === preset.id}
                        className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm ${audioPreset === preset.id ? "bg-white text-black" : "text-zinc-300 hover:bg-white/10 hover:text-white"}`}
                        onClick={() => onSelectPreset(preset.id)}
                        type="button"
                      >
                        <Check
                          className={`h-4 w-4 ${audioPreset === preset.id ? "opacity-100" : "opacity-0"}`}
                        />
                        {preset.label}
                      </button>
                    ))}
                    <div className="my-1.5 h-px bg-white/10" />
                    <button
                      className="flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-zinc-300 hover:bg-white/10 hover:text-white"
                      onClick={onOpenFullscreen}
                      type="button"
                    >
                      <Maximize2 className="h-4 w-4" />
                      Fullscreen
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
          <div className="relative z-10 hidden md:block">
            <Timeline
              className="mt-2 flex w-full md:hidden"
              currentTime={currentTime}
              duration={duration}
              onChange={onSeek}
              playbackRate={playbackRate}
            />
          </div>
        </footer>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52 bg-black text-white">
        {admin ? (
          <SongEditor song_id={songId} />
        ) : (
          <ContextMenuItem disabled>
            <LockKeyhole className="h-4 w-4" />
            Metadata editing requires admin
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function TrackInfo({
  albumId,
  artistId,
  artistName,
  cover,
  title,
  songId,
}: {
  albumId: string;
  artistId: string;
  artistName: string;
  cover: string;
  title: string;
  songId: string;
}) {
  return (
    <section className="flex w-fit min-w-0 max-w-full items-center gap-2 overflow-hidden md:justify-self-start">
      <Link
        href={`/album?id=${albumId}`}
        aria-label={`View ${title} album`}
        className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg"
      >
        <Image
          alt={title}
          className="object-cover"
          fill
          sizes="44px"
          src={cover}
        />
      </Link>
      <div className="min-w-0 flex-[0_1_auto] sm:ml-1">
        <MarqueeTitle href={`/album?id=${albumId}`} title={title} />
        <Link
          className="block truncate text-xs text-zinc-400 hover:text-white"
          href={`/artist?id=${artistId}`}
        >
          {artistName}
        </Link>
      </div>
      <FavoriteButton songId={songId} songName={title} />
    </section>
  );
}

function MarqueeTitle({ href, title }: { href: string; title: string }) {
  const containerRef = useRef<HTMLAnchorElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    const update = () =>
      setOverflowing(text.scrollWidth > container.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(text);
    return () => observer.disconnect();
  }, [title]);

  return (
    <Link
      className="relative block w-full max-w-full overflow-hidden whitespace-nowrap text-sm font-semibold text-white hover:underline"
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      ref={containerRef}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute invisible whitespace-nowrap"
        ref={textRef}
      >
        {title}
      </span>
      {!overflowing || !hovered ? (
        <span className="block truncate">{title}</span>
      ) : (
        <span className="player-title-marquee inline-flex max-w-none">
          <span>{title}</span>
          <span aria-hidden="true" className="pl-8">
            {title}
          </span>
        </span>
      )}
    </Link>
  );
}
