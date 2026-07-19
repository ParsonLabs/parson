"use client";

import { usePlayer } from "@/features/player/player-context";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  resolveMetadataTitle,
  TITLE_TRANSITION_DELAY,
  titleModeAfterPlaybackDelay,
} from "./title-metadata-state";

function routeTitle(pathname: string, query: string) {
  if (pathname === "/") return "Home";
  if (pathname === "/library") return "Library";
  if (pathname === "/album") return "Album";
  if (pathname === "/artist") return "Artist";
  if (pathname === "/profile") return "Profile";
  if (pathname === "/login") return "Log in";
  if (pathname === "/connect") return "Choose a server";
  if (pathname === "/setup") return "Set up Parson";
  if (pathname === "/settings") return "Settings";
  if (pathname === "/search") {
    const term = new URLSearchParams(query).get("q")?.trim();
    return term ? `Search: ${term}` : "Search";
  }
  return "Parson";
}

export function usePageTitle(title?: string | null) {
  useEffect(() => {
    const value = title?.trim();
    if (!value) return;
    window.dispatchEvent(
      new CustomEvent("parson:page-title", { detail: { title: value } }),
    );
  }, [title]);
}

export default function TitleMetadata() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const { song, artist, isPlaying } = usePlayer();
  const [pageTitle, setPageTitle] = useState(() => routeTitle(pathname, query));
  const [routeTitleVisible, setRouteTitleVisible] = useState(true);
  const routeTitleTimeout = useRef<number | undefined>(undefined);
  const isPlayingRef = useRef(isPlaying);
  const previousIsPlaying = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const clearTitleTimeout = () => {
    if (routeTitleTimeout.current !== undefined) {
      window.clearTimeout(routeTitleTimeout.current);
      routeTitleTimeout.current = undefined;
    }
  };

  const keepRouteTitleVisible = () => {
    setRouteTitleVisible(true);
    clearTitleTimeout();
    routeTitleTimeout.current = window.setTimeout(() => {
      if (isPlayingRef.current) setRouteTitleVisible(false);
    }, TITLE_TRANSITION_DELAY);
  };

  useEffect(() => {
    setPageTitle(routeTitle(pathname, query));
    keepRouteTitleVisible();
  }, [pathname, query]);

  useEffect(() => {
    const update = (event: Event) => {
      const title = (event as CustomEvent<{ title?: string }>).detail?.title;
      if (!title) return;
      setPageTitle(title);
      keepRouteTitleVisible();
    };
    window.addEventListener("parson:page-title", update);
    return () => {
      window.removeEventListener("parson:page-title", update);
      if (routeTitleTimeout.current !== undefined)
        window.clearTimeout(routeTitleTimeout.current);
    };
  }, []);

  useEffect(() => {
    if (previousIsPlaying.current === isPlaying) return;
    previousIsPlaying.current = isPlaying;
    clearTitleTimeout();
    routeTitleTimeout.current = window.setTimeout(() => {
      setRouteTitleVisible(titleModeAfterPlaybackDelay(isPlaying) === "page");
    }, TITLE_TRANSITION_DELAY);
  }, [isPlaying]);

  useEffect(() => {
    document.title = resolveMetadataTitle({
      artistName: artist.name,
      mode: routeTitleVisible ? "page" : "playback",
      pageTitle,
      songName: song.name,
    });
  }, [artist.name, pageTitle, routeTitleVisible, song.name]);

  return null;
}
