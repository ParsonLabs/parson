import { describe, expect, test } from "bun:test";
import {
  shouldContinuePlayback,
  wasSystemLikelyAsleep,
} from "./playback-lifecycle";

describe("playback lifecycle recovery", () => {
  test("detects a clock gap caused by sleep without flagging normal timer jitter", () => {
    expect(wasSystemLikelyAsleep(1_000, 7_100, 5_000)).toBeFalse();
    expect(wasSystemLikelyAsleep(1_000, 31_100, 5_000)).toBeTrue();
  });

  test("continues only playback that was active or interrupted", () => {
    expect(
      shouldContinuePlayback({
        wasPlaying: true,
        resumeAfterNetworkError: false,
        paused: true,
        ended: false,
      }),
    ).toBeTrue();
    expect(
      shouldContinuePlayback({
        wasPlaying: false,
        resumeAfterNetworkError: true,
        paused: true,
        ended: false,
      }),
    ).toBeTrue();
    expect(
      shouldContinuePlayback({
        wasPlaying: false,
        resumeAfterNetworkError: false,
        paused: false,
        ended: false,
      }),
    ).toBeTrue();
    expect(
      shouldContinuePlayback({
        wasPlaying: false,
        resumeAfterNetworkError: false,
        paused: true,
        ended: false,
      }),
    ).toBeFalse();
    expect(
      shouldContinuePlayback({
        wasPlaying: true,
        resumeAfterNetworkError: false,
        paused: true,
        ended: true,
      }),
    ).toBeFalse();
  });
});
