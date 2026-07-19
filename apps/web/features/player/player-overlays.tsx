"use client";

import Image from "next/image";
import Link from "next/link";
import FavoriteButton from "@/features/library/favorite-button";
import {
  AudioLines,
  ChevronDown,
  ChevronLeft,
  ListMusic,
  MicVocal,
  Minimize2,
  Repeat2,
} from "lucide-react";
import { useRef, useState, type PointerEvent, type RefObject } from "react";
import type { TimedLyric } from "./player-bar-hooks";
import type { Player } from "./player-api";
import { PlayerQueueList } from "./player-queue";
import {
  ActionButton,
  PlaybackControls,
  Timeline,
  VolumeControl,
} from "./player-controls";

const renderTitle = (title: string) =>
  title.split(/(\([^()]*\))/g).map((part, index) =>
    part.startsWith("(") && part.endsWith(")") ? (
      <span key={`${part}-${index}`} className="inline-block whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );

export function FullscreenPlayer({
  activeLine,
  activeLineRef,
  albumName,
  artistId,
  artistName,
  cover,
  currentTime,
  duration,
  isPlaying,
  looping,
  lyricsOpen,
  lyricsFallback,
  lyricsInstrumental,
  lyricsLoading,
  lyricsScrollRef,
  muted,
  onClose,
  onNext,
  onOpenLyrics,
  onOpenQueue,
  onBackToPlayer,
  onPrevious,
  onSelectQueueItem,
  onSeek,
  onToggleLoop,
  onToggleMute,
  onTogglePlayback,
  onToggleSound,
  onVolumeChange,
  playbackRate,
  queue,
  queueOpen,
  slowedReverb,
  songId,
  title,
  timedLyrics,
  volume,
}: {
  activeLine: number;
  activeLineRef: RefObject<HTMLElement | null>;
  albumName: string;
  artistId: string;
  artistName: string;
  cover: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  looping: boolean;
  lyricsOpen: boolean;
  lyricsFallback?: string | null;
  lyricsInstrumental: boolean;
  lyricsLoading: boolean;
  lyricsScrollRef: RefObject<HTMLDivElement | null>;
  muted: boolean;
  onClose: () => void;
  onNext: () => void;
  onOpenLyrics: () => void;
  onOpenQueue: () => void;
  onBackToPlayer: () => void;
  onPrevious: () => void;
  onSelectQueueItem: (index: number) => void;
  onSeek: (value: number) => void;
  onToggleLoop: () => void;
  onToggleMute: () => void;
  onTogglePlayback: () => void;
  onToggleSound: () => void;
  onVolumeChange: (value: number) => void;
  playbackRate: number;
  queue: Player["queue"];
  queueOpen: boolean;
  slowedReverb: boolean;
  songId: string;
  title: string;
  timedLyrics: TimedLyric[];
  volume: number;
}) {
  const dragStart = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const mobileView = lyricsOpen
    ? "Lyrics"
    : queueOpen
      ? "Queue"
      : "Now playing";
  const showingMobileSubView = lyricsOpen || queueOpen;

  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    dragStart.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null) return;
    setDragOffset(Math.max(0, event.clientY - dragStart.current));
  };
  const endDrag = () => {
    dragStart.current = null;
    if (dragOffset > 88) onClose();
    else setDragOffset(0);
  };

  return (
    <section
      aria-label="Fullscreen player"
      className="fixed inset-0 z-[70] flex min-h-dvh flex-col overflow-hidden bg-black text-white motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:duration-300 md:overflow-y-auto md:animate-none"
      role="dialog"
      style={{
        transform: dragOffset ? `translateY(${dragOffset}px)` : undefined,
        transition:
          dragStart.current === null ? "transform 220ms ease-out" : "none",
      }}
    >
      <div
        aria-hidden="true"
        className="fixed inset-0 overflow-hidden"
        style={{ position: "fixed" }}
      >
        <Image
          alt=""
          className="scale-110 object-cover opacity-20 blur-3xl"
          fill
          sizes="100vw"
          src={cover}
        />
        <div className="absolute inset-0 bg-black/80" />
      </div>
      <div
        className="relative z-20 flex touch-none select-none items-center justify-between px-4 pb-2 pt-[max(10px,env(safe-area-inset-top))] md:hidden"
        onPointerCancel={endDrag}
        onPointerDown={beginDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
      >
        <button
          aria-label={
            showingMobileSubView ? "Back to now playing" : "Close now playing"
          }
          className="grid h-11 w-11 place-items-center rounded-full active:bg-white/10"
          onClick={showingMobileSubView ? onBackToPlayer : onClose}
          type="button"
        >
          {showingMobileSubView ? (
            <ChevronLeft className="h-7 w-7" />
          ) : (
            <ChevronDown className="h-7 w-7" />
          )}
        </button>
        <div className="text-center">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/35" />
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">
            {mobileView}
          </p>
        </div>
        <div aria-hidden="true" className="h-11 w-11" />
      </div>
      <button
        aria-label="Exit fullscreen player"
        className="fixed right-6 top-6 z-10 hidden h-10 w-10 items-center justify-center rounded-full bg-black/40 text-zinc-400 backdrop-blur-sm hover:bg-white/10 hover:text-white md:flex sm:right-8"
        onClick={onClose}
        title="Exit fullscreen"
        type="button"
      >
        <Minimize2 className="h-5 w-5" />
      </button>
      {lyricsOpen && (
        <div className="relative z-10 min-h-0 flex-1 overflow-hidden md:hidden">
          <LyricsContent
            activeLine={activeLine}
            activeLineRef={activeLineRef}
            fallback={lyricsFallback}
            instrumental={lyricsInstrumental}
            loading={lyricsLoading}
            onSeek={onSeek}
            scrollRef={lyricsScrollRef}
            timed={timedLyrics}
          />
        </div>
      )}
      {queueOpen && !lyricsOpen && (
        <div className="relative z-10 min-h-0 flex-1 overflow-hidden px-2 pb-[max(16px,env(safe-area-inset-bottom))] md:hidden">
          {queue.length ? (
            <PlayerQueueList
              className="h-full pb-8"
              currentSongId={songId}
              onSelect={onSelectQueueItem}
              queue={queue}
            />
          ) : (
            <div className="grid h-full place-items-center text-center text-zinc-500">
              <div>
                <ListMusic className="mx-auto h-8 w-8" />
                <p className="mt-3 text-sm font-medium text-zinc-300">
                  Nothing queued
                </p>
              </div>
            </div>
          )}
        </div>
      )}
      <div
        className={`${showingMobileSubView ? "hidden md:grid" : "flex"} relative mx-auto w-full max-w-6xl flex-1 flex-col justify-center gap-6 overflow-y-auto px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-2 md:grid md:items-center md:gap-10 md:py-10 md:pb-28 lg:grid-cols-[minmax(280px,460px)_minmax(0,1fr)] lg:px-10`}
      >
        <div
          className="relative mx-auto aspect-square w-full max-w-[min(72vw,390px)] overflow-hidden rounded-[18px] border border-white/10 bg-[#111] shadow-2xl shadow-black md:max-w-[460px] md:rounded-lg"
          style={{ position: "relative" }}
        >
          <Image
            alt={title}
            className="object-cover"
            fill
            sizes="460px"
            src={cover}
          />
        </div>
        <div className="mx-auto w-full max-w-xl min-w-0">
          <p className="hidden text-xs font-semibold uppercase tracking-widest text-zinc-500 md:block">
            {albumName}
          </p>
          <div className="flex min-w-0 items-center gap-4 md:block">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold leading-tight md:mt-3 md:whitespace-normal md:text-4xl md:font-black lg:text-6xl">
                {renderTitle(title)}
              </h1>
              <Link
                className="mt-1 block truncate text-base text-zinc-400 hover:text-white hover:underline md:mt-3 md:inline-block md:text-xl"
                href={`/artist?id=${artistId}`}
                onClick={onClose}
              >
                {artistName}
              </Link>
            </div>
            <div className="md:hidden">
              <FavoriteButton songId={songId} songName={title} />
            </div>
          </div>
          <div className="mt-5 md:mt-10 md:border-y md:border-white/10 md:py-6">
            <Timeline
              className="mb-5 flex w-full md:mb-0 md:mt-7"
              currentTime={currentTime}
              duration={duration}
              onChange={onSeek}
              playbackRate={playbackRate}
            />
            <div className="flex justify-center py-2 md:scale-125 md:py-0">
              <PlaybackControls
                isPlaying={isPlaying}
                onNext={onNext}
                onPrevious={onPrevious}
                onToggle={onTogglePlayback}
              />
            </div>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-3 md:hidden">
            <button
              className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl bg-white/8 text-xs font-medium text-white/80 active:bg-white/15"
              onClick={onOpenLyrics}
              type="button"
            >
              <MicVocal className="h-5 w-5" />
              Lyrics
            </button>
            <button
              aria-pressed={looping}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-medium ${looping ? "bg-white text-black" : "bg-white/8 text-white/80 active:bg-white/15"}`}
              onClick={onToggleLoop}
              type="button"
            >
              <Repeat2 className="h-5 w-5" />
              Repeat
            </button>
            <button
              className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl bg-white/8 text-xs font-medium text-white/80 active:bg-white/15"
              onClick={onOpenQueue}
              type="button"
            >
              <ListMusic className="h-5 w-5" />
              Queue
            </button>
          </div>
        </div>
      </div>
      <div className="fixed bottom-6 right-6 z-10 hidden flex-wrap items-center justify-end gap-2 md:flex sm:right-8">
        <ActionButton active={lyricsOpen} label="Lyrics" onClick={onOpenLyrics}>
          <MicVocal className="h-4 w-4" />
        </ActionButton>
        <ActionButton
          active={slowedReverb}
          label="Sound"
          onClick={onToggleSound}
        >
          <AudioLines className="h-4 w-4" />
        </ActionButton>
        <ActionButton
          active={looping}
          label="Repeat"
          onClick={onToggleLoop}
          shortcut="R"
        >
          <Repeat2 className="h-4 w-4" />
        </ActionButton>
        <VolumeControl
          muted={muted}
          onChange={onVolumeChange}
          onToggleMute={onToggleMute}
          volume={volume}
        />
      </div>
    </section>
  );
}

export function LyricsPanel({
  activeLine,
  activeLineRef,
  cover,
  onSeek,
  fallback,
  instrumental,
  loading,
  scrollRef,
  timed,
}: {
  activeLine: number;
  activeLineRef: RefObject<HTMLElement | null>;
  onSeek: (value: number) => void;
  cover: string;
  fallback?: string | null;
  instrumental: boolean;
  loading: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  timed: TimedLyric[];
}) {
  return (
    <section className="fixed bottom-0 left-0 right-0 top-[56px] z-40 overflow-hidden rounded-tl-[18px] border-l border-t border-white/10 bg-black md:left-[80px]">
      <div className="absolute -inset-12">
        <Image
          alt=""
          aria-hidden="true"
          className="object-cover opacity-50 blur-3xl"
          fill
          sizes="100vw"
          src={cover}
        />
      </div>
      <div className="absolute inset-0 bg-black/55" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-24 bg-gradient-to-t from-black/45 to-transparent backdrop-blur-sm [mask-image:linear-gradient(to_top,black,transparent)]" />
      <div className="relative z-[2] mx-auto h-full max-w-[720px]">
        <LyricsContent
          activeLine={activeLine}
          activeLineRef={activeLineRef}
          fallback={fallback}
          instrumental={instrumental}
          loading={loading}
          onSeek={onSeek}
          scrollRef={scrollRef}
          timed={timed}
        />
      </div>
    </section>
  );
}

function LyricsContent({
  activeLine,
  activeLineRef,
  fallback,
  instrumental,
  loading,
  onSeek,
  scrollRef,
  timed,
}: {
  activeLine: number;
  activeLineRef: RefObject<HTMLElement | null>;
  fallback?: string | null;
  instrumental: boolean;
  loading: boolean;
  onSeek: (value: number) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  timed: TimedLyric[];
}) {
  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto px-7 py-8 text-center [scrollbar-width:none] sm:px-10 [&::-webkit-scrollbar]:hidden"
    >
      {loading ? (
        <div className="grid h-full place-items-center">
          <div className="h-2 w-2 animate-pulse rounded-full bg-white/70" />
        </div>
      ) : timed.length ? (
        <div className="space-y-5 pb-[50vh] pt-1">
          {timed.map((line, index) =>
            line.text.trim() ? (
              <button
                key={`${line.time}-${index}`}
                ref={(node) => {
                  if (index === activeLine) activeLineRef.current = node;
                }}
                className={`block w-full cursor-pointer text-center text-2xl font-semibold leading-snug transition-all duration-300 hover:text-white sm:text-3xl ${index === activeLine ? "scale-[1.03] text-white" : index < activeLine ? "text-white/25" : "text-white/45"}`}
                onClick={() => onSeek(line.time)}
                type="button"
              >
                {line.text}
              </button>
            ) : (
              <div
                aria-hidden="true"
                className="h-5"
                key={`${line.time}-${index}`}
                ref={(node) => {
                  if (index === activeLine) activeLineRef.current = node;
                }}
              />
            ),
          )}
        </div>
      ) : fallback ? (
        <p className="whitespace-pre-line py-8 text-2xl font-semibold leading-[1.65] text-white sm:text-3xl">
          {fallback}
        </p>
      ) : (
        <div className="grid h-full place-items-center">
          <p className="text-2xl font-semibold leading-[1.65] text-white sm:text-3xl">
            {instrumental
              ? "Instrumental"
              : "No lyrics are available for this track."}
          </p>
        </div>
      )}
    </div>
  );
}
