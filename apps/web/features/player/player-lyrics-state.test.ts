import { describe, expect, test } from "bun:test";
import type { LyricsResult } from "@parson/music-sdk";
import {
  resolveLyricsRenderState,
  shouldRequestLyrics,
} from "./player-lyrics-state";

const cachedLyrics: LyricsResult = {
  id: 1,
  trackName: "Cached track",
  artistName: "Artist",
  albumName: "Album",
  duration: 180,
  instrumental: false,
  plainLyrics: "Already stored locally",
  syncedLyrics: "[00:01.00] Already stored locally",
};

describe("lyrics render state", () => {
  test("renders an SDK memory-cache hit without a loading frame", () => {
    const state = resolveLyricsRenderState({
      cachedLyrics,
      completedLyrics: null,
      completedSongId: "previous-song",
      open: false,
      songId: "cached-song",
    });

    expect(state.loading).toBe(false);
    expect(state.lyrics).toBe(cachedLyrics);
  });

  test("renders embedded local lyrics while synced lyrics prefetch", () => {
    const state = resolveLyricsRenderState({
      completedLyrics: null,
      completedSongId: "previous-song",
      localPlainLyrics: "Lyrics from local metadata",
      open: true,
      songId: "local-song",
    });

    expect(state.loading).toBe(false);
    expect(state.lyrics).toBeNull();
  });

  test("keeps the loading state for a genuine uncached lookup", () => {
    const state = resolveLyricsRenderState({
      completedLyrics: null,
      completedSongId: "previous-song",
      open: true,
      songId: "remote-song",
    });

    expect(state.loading).toBe(true);
  });

  test("does not show a loading state before lyrics are opened", () => {
    const state = resolveLyricsRenderState({
      completedLyrics: null,
      completedSongId: "previous-song",
      open: false,
      songId: "remote-song",
    });

    expect(state.loading).toBe(false);
  });
});

describe("lyrics request policy", () => {
  test("does not request uncached lyrics when a song starts playing", () => {
    expect(
      shouldRequestLyrics({
        completedSongId: "previous-song",
        open: false,
        songId: "new-song",
      }),
    ).toBe(false);
  });

  test("requests uncached lyrics when the lyrics UI is opened", () => {
    expect(
      shouldRequestLyrics({
        completedSongId: "previous-song",
        open: true,
        songId: "new-song",
      }),
    ).toBe(true);
  });

  test("does not request lyrics already held in the SDK cache", () => {
    expect(
      shouldRequestLyrics({
        cachedLyrics,
        completedSongId: "previous-song",
        open: true,
        songId: "cached-song",
      }),
    ).toBe(false);
  });
});
