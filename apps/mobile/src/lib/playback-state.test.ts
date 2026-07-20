import { describe, expect, test } from "bun:test";

import { shouldRestartFinishedTrack } from "./playback-state";

describe("finished-track replay", () => {
  test("restarts at and immediately before the reported end", () => {
    expect(shouldRestartFinishedTrack(180, 180)).toBeTrue();
    expect(shouldRestartFinishedTrack(179.8, 180)).toBeTrue();
  });

  test("does not restart active, unknown, or invalid positions", () => {
    expect(shouldRestartFinishedTrack(179, 180)).toBeFalse();
    expect(shouldRestartFinishedTrack(0, 0)).toBeFalse();
    expect(shouldRestartFinishedTrack(Number.NaN, 180)).toBeFalse();
    expect(
      shouldRestartFinishedTrack(180, Number.POSITIVE_INFINITY),
    ).toBeFalse();
  });
});
