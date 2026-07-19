import { describe, expect, test } from "bun:test";
import {
  resolveMetadataTitle,
  TITLE_TRANSITION_DELAY,
  titleModeAfterPlaybackDelay,
} from "./title-metadata-state";

describe("document title transitions", () => {
  test("pause yields to the current page title after five seconds", () => {
    expect(TITLE_TRANSITION_DELAY).toBe(5_000);
    expect(titleModeAfterPlaybackDelay(false)).toBe("page");
    expect(
      resolveMetadataTitle({
        artistName: "Artist",
        mode: titleModeAfterPlaybackDelay(false),
        pageTitle: "Album",
        songName: "Track",
      }),
    ).toBe("Album");
  });

  test("a page title yields back to the playing song after five seconds", () => {
    expect(titleModeAfterPlaybackDelay(true)).toBe("playback");
    expect(
      resolveMetadataTitle({
        artistName: "Artist",
        mode: titleModeAfterPlaybackDelay(true),
        pageTitle: "Album",
        songName: "Track",
      }),
    ).toBe("Track - Artist");
  });

  test("missing playback metadata always falls back to the page", () => {
    expect(
      resolveMetadataTitle({
        artistName: "",
        mode: "playback",
        pageTitle: "Library",
        songName: "",
      }),
    ).toBe("Library");
  });
});
