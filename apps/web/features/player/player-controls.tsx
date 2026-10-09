"use client";

import PauseIcon from "@/components/icons/pause";
import PlayIcon from "@/components/icons/play";
import { Slider } from "@/components/ui/slider";
import { SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { formatPlaybackTime, timelineValueText } from "./player-controls-state";

function ControlTooltip({ children }: { children: ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-100 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-zinc-950 px-2 py-1 text-[11px] font-medium text-zinc-200 opacity-0 shadow-lg group-hover/control:animate-[control-tooltip_1800ms_ease_forwards] group-focus-within/control:animate-[control-tooltip_1800ms_ease_forwards]"
    >
      {children}
    </span>
  );
}

export function PlaybackControls({
  compact = false,
  prominent = false,
  isPlaying,
  onNext,
  onPrevious,
  onToggle,
}: {
  compact?: boolean;
  prominent?: boolean;
  isPlaying: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onToggle: () => void;
}) {
  const [optimisticPlaying, setOptimisticPlaying] = useState<boolean | null>(
    null,
  );
  const displayedPlaying = optimisticPlaying ?? isPlaying;

  useEffect(() => {
    if (optimisticPlaying === null) {
      return;
    }
    if (isPlaying === optimisticPlaying) {
      setOptimisticPlaying(null);
      return;
    }
    const rollback = window.setTimeout(() => setOptimisticPlaying(null), 1500);
    return () => window.clearTimeout(rollback);
  }, [isPlaying, optimisticPlaying]);

  const toggle = () => {
    setOptimisticPlaying(!displayedPlaying);
    onToggle();
  };

  return (
    <div className={`flex items-center ${prominent ? "gap-2" : "gap-1"}`}>
      <span className={compact ? "hidden md:contents" : "contents"}>
        <IconButton
          label="Previous"
          onClick={onPrevious}
          shortcut="P"
          prominent={prominent}
        >
          <SkipBack className={prominent ? "h-5 w-5" : "h-4 w-4"} />
        </IconButton>
      </span>
      <button
        aria-label={displayedPlaying ? "Pause" : "Play"}
        aria-keyshortcuts="Space"
        className={`flex shrink-0 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105 ${prominent ? "h-11 w-11" : "h-9 w-9"}`}
        onClick={toggle}
        type="button"
      >
        {displayedPlaying ? (
          <PauseIcon
            className={prominent ? "h-5 w-5" : "h-4 w-4"}
            fill="currentColor"
          />
        ) : (
          <PlayIcon
            className={prominent ? "ml-0.5 h-5 w-5" : "ml-0.5 h-4 w-4"}
            fill="currentColor"
          />
        )}
      </button>
      <span className={compact ? "hidden md:contents" : "contents"}>
        <IconButton
          label="Next"
          onClick={onNext}
          shortcut="N"
          prominent={prominent}
        >
          <SkipForward className={prominent ? "h-5 w-5" : "h-4 w-4"} />
        </IconButton>
      </span>
    </div>
  );
}

export function Timeline({
  className,
  currentTime,
  duration,
  isPlaying,
  readPosition,
  onChange,
  playbackRate,
}: {
  className: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  readPosition?: () => number;
  onChange: (value: number) => void;
  playbackRate: number;
}) {
  const safePlaybackRate = playbackRate > 0 ? playbackRate : 1;
  const [smoothTime, setSmoothTime] = useState(currentTime);
  useEffect(() => {
    if (!isPlaying || !readPosition) {
      return;
    }
    setSmoothTime(readPosition());
    let frame: number;
    const update = () => {
      setSmoothTime(readPosition());
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, readPosition]);
  const position = isPlaying && readPosition ? smoothTime : currentTime;
  return (
    <div className={`${className} items-center gap-2`}>
      <span className="w-8 text-right font-mono text-[9px] text-zinc-400">
        {formatPlaybackTime(currentTime / safePlaybackRate)}
      </span>
      <Slider
        aria-label="Playback position"
        aria-keyshortcuts="ArrowLeft ArrowRight Home End"
        aria-valuetext={timelineValueText(
          position / safePlaybackRate,
          duration / safePlaybackRate,
        )}
        className="flex-1 cursor-pointer before:absolute before:-inset-y-3 before:inset-x-0 before:content-[''] **:data-[slot=slider-range]:bg-white **:data-[slot=slider-thumb]:h-2.5 **:data-[slot=slider-thumb]:w-2.5 **:data-[slot=slider-thumb]:border-0 **:data-[slot=slider-thumb]:bg-white **:data-[slot=slider-thumb]:opacity-0 **:data-[slot=slider-track]:h-1 **:data-[slot=slider-track]:bg-white/15 [&:focus-within_[data-slot=slider-thumb]]:opacity-100 [&:hover_[data-slot=slider-thumb]]:opacity-100"
        max={duration || 100}
        min={0}
        step={0.01}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
            return;
          }
          event.preventDefault();
          onChange(
            Math.max(
              0,
              Math.min(
                duration,
                position + (event.key === "ArrowRight" ? 5 : -5),
              ),
            ),
          );
        }}
        onValueChange={([value]) =>
          typeof value === "number" && onChange(value)
        }
        value={[Math.min(position, duration || position)]}
      />
      <span className="w-8 font-mono text-[9px] text-zinc-400">
        {formatPlaybackTime(duration / safePlaybackRate)}
      </span>
    </div>
  );
}

export function VolumeControl({
  muted,
  onChange,
  onToggleMute,
  volume,
}: {
  muted: boolean;
  onChange: (value: number) => void;
  onToggleMute: () => void;
  volume: number;
}) {
  const wheelRef = useVolumeWheel(muted, volume, onChange);
  return (
    <div
      ref={wheelRef}
      className="volume-control group/volume flex min-h-10 items-center justify-end"
    >
      <div className="w-0 overflow-hidden opacity-0 transition-[width,opacity] duration-200 group-hover/volume:w-20 group-hover/volume:opacity-100 group-focus-within/volume:w-20 group-focus-within/volume:opacity-100">
        <Slider
          aria-label="Volume"
          className="mr-1 h-10 w-17 **:data-[slot=slider-range]:bg-white **:data-[slot=slider-thumb]:h-3.5 **:data-[slot=slider-thumb]:w-3.5 **:data-[slot=slider-thumb]:border-0 **:data-[slot=slider-thumb]:bg-white **:data-[slot=slider-thumb]:opacity-0 **:data-[slot=slider-track]:h-1 **:data-[slot=slider-track]:bg-white/15 [&:hover_[data-slot=slider-thumb]]:opacity-100"
          max={100}
          min={0}
          onValueChange={([value]) => onChange(value ?? 0)}
          value={[muted ? 0 : volume * 100]}
        />
      </div>
      <span className="group/control relative">
        <button
          aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
          aria-keyshortcuts="M"
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white"
          onClick={onToggleMute}
          type="button"
        >
          {muted || volume === 0 ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </button>
        <ControlTooltip>
          {muted || volume === 0 ? "Unmute" : "Mute"} · M
        </ControlTooltip>
      </span>
    </div>
  );
}

function changeVolumeOnWheel(
  event: WheelEvent,
  muted: boolean,
  volume: number,
  onChange: (value: number) => void,
) {
  if (event.deltaY === 0) {
    return;
  }
  event.preventDefault();
  const currentVolume = muted ? 0 : volume * 100;
  onChange(
    Math.min(
      100,
      Math.max(
        0,
        Math.round((currentVolume + (event.deltaY < 0 ? 5 : -5)) * 10) / 10,
      ),
    ),
  );
}

export function useVolumeWheel(
  muted: boolean,
  volume: number,
  onChange: (value: number) => void,
) {
  const latest = useRef({ muted, volume, onChange });
  useEffect(() => {
    latest.current = { muted, volume, onChange };
  }, [muted, volume, onChange]);
  return useCallback((element: HTMLDivElement | null) => {
    if (!element) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      const state = latest.current;
      changeVolumeOnWheel(event, state.muted, state.volume, state.onChange);
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);
}

export function ActionButton({
  active,
  children,
  label,
  onClick,
  shortcut,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
  shortcut?: string;
}) {
  return (
    <span className="group/control relative">
      <button
        aria-label={label}
        aria-keyshortcuts={shortcut}
        aria-pressed={active}
        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${active ? "bg-white text-black" : "text-zinc-400 hover:bg-white/10 hover:text-white"}`}
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
      <ControlTooltip>
        {label}
        {shortcut ? ` · ${shortcut}` : ""}
      </ControlTooltip>
    </span>
  );
}

function IconButton({
  children,
  label,
  onClick,
  shortcut,
  prominent = false,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  shortcut?: string;
  prominent?: boolean;
}) {
  return (
    <button
      aria-label={label}
      aria-keyshortcuts={shortcut}
      className={`flex items-center justify-center rounded-full hover:bg-white/10 hover:text-white ${prominent ? "h-10 w-10 text-zinc-200" : "h-8 w-8 text-zinc-400"}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
