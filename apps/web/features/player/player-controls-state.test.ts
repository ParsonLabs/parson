import { describe, expect, test } from "bun:test";
import { formatPlaybackTime, timelineValueText } from "./player-controls-state";

describe("player control presentation", () => {
  test("formats playback times safely", () => {
    expect(formatPlaybackTime(Number.NaN)).toBe("0:00");
    expect(formatPlaybackTime(-1)).toBe("0:00");
    expect(formatPlaybackTime(65.9)).toBe("1:05");
  });

  test("provides a useful spoken timeline value", () => {
    expect(timelineValueText(65, 183)).toBe("1:05 of 3:03");
  });
});
