"use client";

import FavoriteButton from "@/features/library/favorite-button";
import { ExplicitBadge } from "@/features/library/song-title";
import { ArtistCreditLinks } from "@/features/library/artist-credit-links";
import type { TrackArtistCreditPart } from "@/features/library/track-artist-credit";
import SongMenu from "@/features/library/song-menu";
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { AudioLines, ListMusic, Maximize2, MicVocal } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AudioPreset, AudioPresetId } from "./audio-presets";
import PlayerMoreMenu from "./player-more-menu";
import {
  ActionButton,
  PlaybackControls,
  Timeline,
  VolumeControl,
} from "./player-controls";

export function PlayerFooter({
  albumCover,
  albumId,
  albumName,
  artistId,
  artistName,
  artistCredits,
  audioPreset,
  audioPresets,
  cover,
  currentTime,
  duration,
  readPosition,
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
  explicit,
  volume,
}: {
  albumCover?: string;
  albumId: string;
  albumName: string;
  artistId: string;
  artistName: string;
  artistCredits: TrackArtistCreditPart[];
  audioPreset: AudioPresetId;
  audioPresets: readonly AudioPreset[];
  cover: string;
  currentTime: number;
  duration: number;
  readPosition?: () => number;
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
  explicit: boolean;
  volume: number;
}) {
  return (
    <SongMenu
      album_cover={albumCover}
      album_id={albumId}
      album_name={albumName}
      artist_id={artistId}
      artist_name={artistName}
      context="player"
      song_id={songId}
      song_name={title}
    >
      <footer className="fixed bottom-20 left-2 right-2 z-50 isolate overflow-visible rounded-[14px] border border-white/10 bg-[#080808] px-3 py-2 text-white shadow-[0_20px_70px_rgba(0,0,0,0.72)] md:bottom-4 md:left-[calc(50%+40px)] md:right-auto md:w-[min(980px,calc(100vw-112px))] md:-translate-x-1/2 md:rounded-3xl md:px-4 md:py-4 md:pl-5 md:pr-3">
        <button
          aria-label={`Open now playing: ${title}`}
          className="absolute inset-0 z-20 rounded-[14px] md:hidden"
          onClick={onOpenFullscreen}
          type="button"
        />
        <div className="relative z-10 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.9fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_300px_minmax(0,1fr)] lg:gap-x-4">
          <TrackInfo
            albumId={albumId}
            artistCredits={artistCredits}
            cover={cover}
            songId={songId}
            title={title}
            explicit={explicit}
          />
          <section className="relative z-30 flex min-w-0 flex-col items-center gap-1.5 lg:w-75">
            <PlaybackControls
              compact
              prominent
              isPlaying={isPlaying}
              onNext={onNext}
              onPrevious={onPrevious}
              onToggle={onTogglePlayback}
            />
            <Timeline
              className="hidden w-full md:flex"
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              readPosition={readPosition}
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
            <PlayerMoreMenu>
              <DropdownMenuLabel>Sound</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={audioPreset}
                onValueChange={(value) =>
                  onSelectPreset(value as AudioPresetId)
                }
              >
                {audioPresets.map((preset) => (
                  <DropdownMenuRadioItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onOpenFullscreen}>
                <Maximize2 className="h-4 w-4" />
                Fullscreen
              </DropdownMenuItem>
            </PlayerMoreMenu>
          </section>
        </div>
        <div className="relative z-10 hidden md:block">
          <Timeline
            className="mt-2 flex w-full md:hidden"
            currentTime={currentTime}
            duration={duration}
            isPlaying={isPlaying}
            onChange={onSeek}
            playbackRate={playbackRate}
          />
        </div>
      </footer>
    </SongMenu>
  );
}

function TrackInfo({
  albumId,
  artistCredits,
  cover,
  title,
  explicit,
  songId,
}: {
  albumId: string;
  artistCredits: TrackArtistCreditPart[];
  cover: string;
  title: string;
  explicit: boolean;
  songId: string;
}) {
  return (
    <section className="flex w-fit min-w-0 max-w-full items-center gap-2 overflow-hidden md:justify-self-start">
      <Link
        href={`/album?id=${albumId}`}
        aria-label={`View ${title} album`}
        className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg md:h-14 md:w-14"
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
        <span className="block truncate text-xs text-zinc-400">
          {explicit && <ExplicitBadge />}
          <ArtistCreditLinks credits={artistCredits} />
        </span>
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
    if (!container || !text) {
      return;
    }

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
      className="relative block w-full max-w-full overflow-hidden whitespace-nowrap text-sm font-semibold text-white hover:underline md:text-base"
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
