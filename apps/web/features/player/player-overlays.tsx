"use client";

import { ExplicitBadge } from "@/features/library/song-title";
import { ArtistCreditLinks } from "@/features/library/artist-credit-links";
import type { TrackArtistCreditPart } from "@/features/library/track-artist-credit";

import Image from "next/image";
import {
  ChevronDown,
  AudioLines,
  ChevronLeft,
  ListMusic,
  MicVocal,
  Minimize2,
} from "lucide-react";
import {
  memo,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";
import type { TimedLyric } from "./player-bar-hooks";
import type { Player } from "./player-api";
import { PlayerQueueList } from "./player-queue";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ActionButton,
  PlaybackControls,
  Timeline,
  VolumeControl,
} from "./player-controls";
import type { AudioPreset, AudioPresetId } from "./audio-presets";
import PlayerMoreMenu from "./player-more-menu";
import {
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

export function FullscreenPlayer({
  activeLine,
  activeLineRef,
  artistCredits,
  audioPreset,
  audioPresets,
  cover,
  currentTime,
  duration,
  readPosition,
  isPlaying,
  looping,
  lyricsOpen,
  lyricsFallback,
  lyricsFailed,
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
  onRetryLyrics,
  onReorderQueue,
  onSelectQueueItem,
  onSeek,
  onSelectPreset,
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
  explicit,
  timedLyrics,
  volume,
}: {
  activeLine: number;
  activeLineRef: RefObject<HTMLElement | null>;
  artistCredits: TrackArtistCreditPart[];
  audioPreset: AudioPresetId;
  audioPresets: readonly AudioPreset[];
  cover: string;
  currentTime: number;
  duration: number;
  readPosition?: () => number;
  isPlaying: boolean;
  looping: boolean;
  lyricsOpen: boolean;
  lyricsFallback?: string | null;
  lyricsFailed: boolean;
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
  onRetryLyrics: () => void;
  onReorderQueue: (from: number, to: number) => void;
  onSelectQueueItem: (index: number) => void;
  onSeek: (value: number) => void;
  onSelectPreset: (value: AudioPresetId) => void;
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
  explicit: boolean;
  timedLyrics: TimedLyric[];
  volume: number;
}) {
  const dragStart = useRef<number | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
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
    if (dragStart.current === null) {
      return;
    }
    setDragOffset(Math.max(0, event.clientY - dragStart.current));
  };
  const endDrag = () => {
    dragStart.current = null;
    if (dragOffset > 88) {
      onClose();
    } else {
      setDragOffset(0);
    }
  };

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          asChild
          aria-describedby={undefined}
          aria-labelledby={undefined}
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = returnFocus.current?.isConnected
              ? returnFocus.current
              : document.querySelector<HTMLElement>(
                  'footer button[aria-label="More controls"]',
                );
            trigger?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (lyricsOpen || queueOpen) {
              event.preventDefault();
              onBackToPlayer();
            }
          }}
        >
          <section
            aria-label="Fullscreen player"
            className="fixed inset-0 z-70 flex min-h-dvh flex-col overflow-hidden bg-black text-white motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:duration-300 md:overflow-y-auto md:animate-none"
            role="dialog"
            style={{
              transform: dragOffset ? `translateY(${dragOffset}px)` : undefined,
              transition:
                dragStart.current === null
                  ? "transform 220ms ease-out"
                  : "none",
            }}
          >
            <DialogPrimitive.Title className="sr-only">
              Now playing
            </DialogPrimitive.Title>
            <div aria-hidden="true" className="fixed inset-0 bg-[#050505]">
              {lyricsOpen && <LyricsBackground cover={cover} />}
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
                  showingMobileSubView
                    ? "Return to now playing"
                    : "Close now playing"
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
                <p className="text-sm font-medium text-zinc-500">
                  {mobileView}
                </p>
              </div>
              <div aria-hidden="true" className="h-11 w-11" />
            </div>
            <button
              aria-label="Exit fullscreen player"
              className="fixed right-6 top-6 z-30 hidden h-10 w-10 items-center justify-center rounded-full bg-black/40 text-zinc-400 backdrop-blur-sm hover:bg-white/10 hover:text-white md:flex sm:right-8"
              onClick={onClose}
              title="Exit fullscreen"
              type="button"
            >
              <Minimize2 className="h-5 w-5" />
            </button>
            <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
              {lyricsOpen ? (
                <div className="mx-auto min-h-0 w-full max-w-190 flex-1 overflow-hidden px-2 md:px-6">
                  <LyricsContent
                    activeLine={activeLine}
                    activeLineRef={activeLineRef}
                    fallback={lyricsFallback}
                    failed={lyricsFailed}
                    instrumental={lyricsInstrumental}
                    loading={lyricsLoading}
                    onRetry={onRetryLyrics}
                    onSeek={onSeek}
                    scrollRef={lyricsScrollRef}
                    timed={timedLyrics}
                  />
                </div>
              ) : queueOpen ? (
                <div className="mx-auto min-h-0 w-full max-w-160 flex-1 overflow-y-auto px-4 pt-4 md:pt-16">
                  <h2 className="mb-4 text-base font-semibold text-zinc-200">
                    Queue
                  </h2>
                  {queue.length ? (
                    <PlayerQueueList
                      currentSongId={songId}
                      onReorder={onReorderQueue}
                      onSelect={onSelectQueueItem}
                      queue={queue}
                    />
                  ) : (
                    <p className="py-8 text-sm text-zinc-500">Nothing queued</p>
                  )}
                </div>
              ) : (
                <div className="mx-auto flex min-h-0 w-full max-w-225 flex-1 flex-col items-center justify-start gap-6 overflow-y-auto px-6 py-5 md:grid md:grid-cols-2 md:content-center md:gap-12 md:py-[clamp(16px,4dvh,48px)]">
                  <div className="relative mx-auto aspect-square w-full max-w-[min(62vw,280px,max(88px,calc(100dvh-340px)))] shrink-0 overflow-hidden rounded-[18px] border border-white/8 bg-[#111] md:max-w-[min(340px,calc(100dvh-176px))]">
                    <Image
                      alt={title}
                      className="object-cover"
                      fill
                      sizes="340px"
                      src={cover}
                    />
                  </div>
                  <div className="w-full min-w-0 max-w-95">
                    <h1
                      className="wrap-break-word text-2xl font-semibold leading-tight tracking-tight md:text-[32px]"
                      title={title}
                    >
                      {title}
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-zinc-500 md:text-base">
                      {explicit && <ExplicitBadge />}
                      <ArtistCreditLinks
                        credits={artistCredits}
                        onNavigate={onClose}
                      />
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="relative z-20 mx-auto w-full max-w-150 shrink-0 px-6 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 md:pb-7">
              {showingMobileSubView && (
                <p className="mb-3 truncate text-center text-xs text-zinc-500">
                  {title}
                </p>
              )}
              <Timeline
                className="mb-3 flex w-full"
                currentTime={currentTime}
                duration={duration}
                isPlaying={isPlaying}
                readPosition={readPosition}
                onChange={onSeek}
                playbackRate={playbackRate}
              />
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                <button
                  aria-label="Lyrics"
                  aria-pressed={lyricsOpen}
                  className={`flex h-9 w-fit items-center gap-2 rounded-full px-3 text-xs transition-colors ${lyricsOpen ? "bg-white/8 text-white" : "text-zinc-500 hover:bg-white/4 hover:text-zinc-200"}`}
                  onClick={onOpenLyrics}
                  type="button"
                >
                  <MicVocal className="h-4 w-4" />
                  <span className="hidden sm:inline">Lyrics</span>
                </button>
                <PlaybackControls
                  prominent
                  isPlaying={isPlaying}
                  onNext={onNext}
                  onPrevious={onPrevious}
                  onToggle={onTogglePlayback}
                />
                <div className="flex items-center justify-self-end gap-1 sm:gap-1.5">
                  <ActionButton
                    active={slowedReverb}
                    label="Sound"
                    onClick={onToggleSound}
                  >
                    <AudioLines className="h-4 w-4" />
                  </ActionButton>
                  <div className="hidden sm:block">
                    <VolumeControl
                      muted={muted}
                      volume={volume}
                      onChange={onVolumeChange}
                      onToggleMute={onToggleMute}
                    />
                  </div>
                  <PlayerMoreMenu label="More player controls">
                    <DropdownMenuItem
                      onSelect={queueOpen ? onBackToPlayer : onOpenQueue}
                    >
                      <ListMusic />
                      {queueOpen ? "Now playing" : "Queue"}
                    </DropdownMenuItem>
                    <DropdownMenuCheckboxItem
                      checked={looping}
                      onCheckedChange={onToggleLoop}
                    >
                      Repeat
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Sound</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={audioPreset}
                      onValueChange={(value) =>
                        onSelectPreset(value as AudioPresetId)
                      }
                    >
                      {audioPresets.map((preset) => (
                        <DropdownMenuRadioItem
                          key={preset.id}
                          value={preset.id}
                        >
                          {preset.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </PlayerMoreMenu>
                </div>
              </div>
            </div>
          </section>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const LyricsPanel = memo(function LyricsPanel({
  activeLine,
  activeLineRef,
  cover,
  onSeek,
  fallback,
  failed,
  instrumental,
  loading,
  onRetry,
  scrollRef,
  timed,
}: {
  activeLine: number;
  activeLineRef: RefObject<HTMLElement | null>;
  onSeek: (value: number) => void;
  cover: string;
  fallback?: string | null;
  failed: boolean;
  instrumental: boolean;
  loading: boolean;
  onRetry: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  timed: TimedLyric[];
}) {
  return (
    <section
      aria-label="Lyrics"
      className="app-content-shell z-40 overflow-hidden bg-black"
    >
      <LyricsBackground cover={cover} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-1 h-24 bg-linear-to-t from-black/45 to-transparent mask-[linear-gradient(to_top,black,transparent)]" />
      <div className="relative z-2 mx-auto h-full max-w-180">
        <LyricsContent
          activeLine={activeLine}
          activeLineRef={activeLineRef}
          fallback={fallback}
          failed={failed}
          instrumental={instrumental}
          loading={loading}
          onRetry={onRetry}
          onSeek={onSeek}
          scrollRef={scrollRef}
          timed={timed}
        />
      </div>
    </section>
  );
});

function LyricsBackground({ cover }: { cover: string }) {
  return (
    <>
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
    </>
  );
}

const LyricsContent = memo(function LyricsContent({
  activeLine,
  activeLineRef,
  fallback,
  failed,
  instrumental,
  loading,
  onRetry,
  onSeek,
  scrollRef,
  timed,
}: {
  activeLine: number;
  activeLineRef: RefObject<HTMLElement | null>;
  fallback?: string | null;
  failed: boolean;
  instrumental: boolean;
  loading: boolean;
  onRetry: () => void;
  onSeek: (value: number) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  timed: TimedLyric[];
}) {
  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto px-7 py-8 text-center scrollbar-none sm:px-10 [&::-webkit-scrollbar]:hidden"
    >
      {loading ? (
        <div className="grid h-full place-items-center">
          <div className="h-2 w-2 animate-pulse rounded-full bg-white/70" />
        </div>
      ) : failed ? (
        <div className="grid h-full place-items-center">
          <div className="max-w-sm">
            <p className="text-2xl font-semibold text-white">
              Lyrics are temporarily unavailable
            </p>
            <button
              className="mt-5 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-zinc-200"
              onClick={onRetry}
              type="button"
            >
              Try again
            </button>
          </div>
        </div>
      ) : timed.length ? (
        <div className="space-y-5 pb-[50vh] pt-1">
          {timed.map((line, index) =>
            line.text.trim() ? (
              <button
                key={`${line.time}-${index}`}
                ref={(node) => {
                  if (index === activeLine) {
                    activeLineRef.current = node;
                  }
                }}
                className={`block w-full cursor-pointer text-center text-2xl font-semibold leading-snug transition-[color,transform] duration-150 hover:text-white sm:text-3xl ${index === activeLine ? "scale-[1.03] text-white" : index < activeLine ? "text-white/25" : "text-white/45"}`}
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
                  if (index === activeLine) {
                    activeLineRef.current = node;
                  }
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
});
