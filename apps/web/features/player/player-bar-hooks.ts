"use client";

import {
  findLyrics,
  getCachedLyrics,
  type LyricsResult,
} from "@parson/music-sdk";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { shouldDismissPlayerOverlayForLink } from "./player-overlay-state";
import {
  resolveLyricsRenderState,
  shouldRequestLyrics,
} from "./player-lyrics-state";

export type TimedLyric = { time: number; text: string };

export function parseSyncedLyrics(value?: string | null): TimedLyric[] {
  if (!value) return [];
  return value
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/);
      if (!match) return null;
      return {
        time: Number(match[1]) * 60 + Number(match[2]),
        text: match[3]?.trim() || " ",
      };
    })
    .filter((line): line is TimedLyric => Boolean(line));
}

function isKeyboardShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, button, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="slider"], [role="spinbutton"]',
    ),
  );
}

type ShortcutOptions = {
  currentTime: number;
  duration: number;
  enabled: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onRepeat: () => void;
  onSeek: (value: number) => void;
  onToggleMute: () => void;
  onTogglePlayback: () => void;
};

export function usePlayerShortcuts(options: ShortcutOptions) {
  useEffect(() => {
    if (!options.enabled) return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isKeyboardShortcutTarget(event.target)
      )
        return;
      const seekBy = (seconds: number) => {
        const upperBound =
          Number.isFinite(options.duration) && options.duration > 0
            ? options.duration
            : Number.POSITIVE_INFINITY;
        options.onSeek(
          Math.max(0, Math.min(options.currentTime + seconds, upperBound)),
        );
      };
      const commands: Record<string, () => void> = {
        Space: options.onTogglePlayback,
        ArrowLeft: () => seekBy(event.shiftKey ? -10 : -5),
        ArrowRight: () => seekBy(event.shiftKey ? 10 : 5),
        KeyM: options.onToggleMute,
        KeyN: options.onNext,
        KeyP: options.onPrevious,
        KeyR: options.onRepeat,
      };
      const command = commands[event.code];
      if (command) {
        event.preventDefault();
        command();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [options]);
}

export function useLyrics(
  song: { id: string; plain_lyrics?: string },
  currentTime: number,
  open: boolean,
) {
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [lyricsSongId, setLyricsSongId] = useState("");
  const activeLineRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const positionedSongRef = useRef("");
  // Fetch uncached lyrics only after the panel opens.
  const cachedLyrics = song.id ? getCachedLyrics(song.id) : undefined;

  useEffect(() => {
    if (!song.id || lyricsSongId === song.id) return;
    if (cachedLyrics) {
      setLyrics(cachedLyrics);
      setLyricsSongId(song.id);
      return;
    }
    if (
      !shouldRequestLyrics({
        cachedLyrics,
        completedSongId: lyricsSongId,
        open,
        songId: song.id,
      })
    )
      return;
    let cancelled = false;
    findLyrics(song.id)
      .then((result) => {
        if (!cancelled) setLyrics(result);
      })
      .catch(() => {
        if (!cancelled) setLyrics(null);
      })
      .finally(() => {
        if (!cancelled) {
          setLyricsSongId(song.id);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cachedLyrics, lyricsSongId, open, song.id]);

  // Read cached lyrics during render to avoid a loading frame.
  const { lyrics: currentLyrics, loading } = resolveLyricsRenderState({
    cachedLyrics,
    completedLyrics: lyrics,
    completedSongId: lyricsSongId,
    localPlainLyrics: song.plain_lyrics,
    open,
    songId: song.id,
  });

  const timed = useMemo(
    () => parseSyncedLyrics(currentLyrics?.syncedLyrics),
    [currentLyrics?.syncedLyrics],
  );
  const activeLine = timed.reduce(
    (found, line, index) => (line.time <= currentTime ? index : found),
    -1,
  );

  const scrollActiveLine = (behavior: ScrollBehavior) => {
    const activeNode = activeLineRef.current;
    const container = scrollRef.current;
    if (!activeNode || !container) return false;
    const target =
      activeNode.offsetTop -
      (container.clientHeight - activeNode.offsetHeight) / 2;
    container.scrollTo({
      behavior,
      top: Math.max(0, target),
    });
    return true;
  };

  useEffect(() => {
    if (!open) {
      positionedSongRef.current = "";
      return;
    }
    if (loading || lyricsSongId !== song.id) return;
    if (positionedSongRef.current !== lyricsSongId) {
      const frame = requestAnimationFrame(() => {
        if (!scrollActiveLine("auto")) {
          scrollRef.current?.scrollTo({ top: 0 });
        }
      });
      positionedSongRef.current = lyricsSongId;
      return () => cancelAnimationFrame(frame);
    }
    if (!activeLineRef.current) return;
    const frame = requestAnimationFrame(() => scrollActiveLine("smooth"));
    return () => cancelAnimationFrame(frame);
  }, [activeLine, loading, lyricsSongId, open, song.id, timed.length]);

  return {
    activeLine,
    activeLineRef,
    fallback: currentLyrics?.plainLyrics ?? song.plain_lyrics,
    instrumental: currentLyrics?.instrumental ?? false,
    loading,
    scrollRef,
    timed,
  };
}

export function useFullscreenDismiss(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [close, open]);
}

export function useCloseLyricsOnNavigation(close: () => void) {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (previousPathname.current !== pathname) close();
    previousPathname.current = pathname;
  }, [close, pathname]);

  useEffect(() => {
    const closeOnLinkNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (
        !link ||
        link.hasAttribute("download") ||
        (link.target && link.target !== "_self")
      )
        return;
      if (shouldDismissPlayerOverlayForLink(window.location.href, link.href))
        close();
    };

    document.addEventListener("click", closeOnLinkNavigation, true);
    window.addEventListener("popstate", close);
    window.addEventListener("parson:navigate-home", close);
    window.addEventListener("parson:search-submitted", close);
    return () => {
      document.removeEventListener("click", closeOnLinkNavigation, true);
      window.removeEventListener("popstate", close);
      window.removeEventListener("parson:navigate-home", close);
      window.removeEventListener("parson:search-submitted", close);
    };
  }, [close]);
}
