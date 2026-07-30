import { describe, expect, test } from "bun:test";
import { canPromotePreloadedMedia } from "./gapless-playback";

describe("gapless media handoff", () => {
  test("promotes the exact buffered source", () => {
    expect(
      canPromotePreloadedMedia(
        { error: null, readyState: 4 },
        "https://music.test/track/2",
        "https://music.test/track/2",
      ),
    ).toBe(true);
  });

  test("allows consecutive queue entries with the same source", () => {
    const source = "https://music.test/track/repeated";
    expect(
      canPromotePreloadedMedia({ error: null, readyState: 3 }, source, source),
    ).toBe(true);
  });

  test("never promotes stale, failed, or insufficiently buffered preloads", () => {
    expect(
      canPromotePreloadedMedia(
        { error: null, readyState: 4 },
        "https://music.test/track/old",
        "https://music.test/track/new",
      ),
    ).toBe(false);
    expect(
      canPromotePreloadedMedia(
        { error: {} as MediaError, readyState: 4 },
        "https://music.test/track/new",
        "https://music.test/track/new",
      ),
    ).toBe(false);
    expect(
      canPromotePreloadedMedia(
        { error: null, readyState: 2 },
        "https://music.test/track/new",
        "https://music.test/track/new",
      ),
    ).toBe(false);
  });
});
