import { describe, expect, test } from "bun:test";
import {
  MEDIA_ERROR_DECODE,
  MEDIA_ERROR_NETWORK,
  MEDIA_ERROR_SOURCE_NOT_SUPPORTED,
  shouldAdvancePastFailedTrack,
  shouldRetryWithCompatibilityStream,
} from "./playback-recovery";

describe("failed media recovery", () => {
  test("retries unsupported direct-play media once through the compatibility stream", () => {
    for (const code of [MEDIA_ERROR_DECODE, MEDIA_ERROR_SOURCE_NOT_SUPPORTED]) {
      expect(shouldRetryWithCompatibilityStream(code, 0, false)).toBeTrue();
      expect(shouldRetryWithCompatibilityStream(code, 0, true)).toBeFalse();
      expect(shouldRetryWithCompatibilityStream(code, 192, false)).toBeFalse();
    }
    expect(
      shouldRetryWithCompatibilityStream(MEDIA_ERROR_NETWORK, 0, false),
    ).toBeFalse();
  });

  test("advances after terminal file, decode, or network failures", () => {
    for (const code of [
      MEDIA_ERROR_NETWORK,
      MEDIA_ERROR_DECODE,
      MEDIA_ERROR_SOURCE_NOT_SUPPORTED,
    ]) {
      expect(shouldAdvancePastFailedTrack(code, true)).toBeTrue();
      expect(shouldAdvancePastFailedTrack(code, false)).toBeFalse();
    }
    expect(shouldAdvancePastFailedTrack(undefined, true)).toBeFalse();
  });
});
