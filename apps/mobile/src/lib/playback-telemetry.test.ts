import { describe, expect, test } from "bun:test";

import {
  isCompleted,
  isEarlySkip,
  newPlaybackTelemetry,
  qualifiedPlayThreshold,
  updateListenedSeconds,
} from "./playback-telemetry";

describe("mobile playback telemetry", () => {
  test("counts continuous playback without counting seeks", () => {
    const state = newPlaybackTelemetry(0, 1_000);
    expect(updateListenedSeconds(state, 1, 2_000, true)).toBe(1);
    expect(updateListenedSeconds(state, 90, 2_100, true)).toBe(1);
    expect(updateListenedSeconds(state, 91, 3_100, false)).toBe(1);
  });

  test("uses the same qualification and completion rules as web", () => {
    expect(qualifiedPlayThreshold(300)).toBe(150);
    expect(qualifiedPlayThreshold(600)).toBe(240);
    expect(isEarlySkip(20, 120)).toBe(true);
    expect(isEarlySkip(30, 120)).toBe(false);
    expect(isCompleted(84, 100)).toBe(false);
    expect(isCompleted(85, 100)).toBe(true);
  });
});
