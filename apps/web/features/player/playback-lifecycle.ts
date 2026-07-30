export const WAKE_GAP_MS = 20_000;

export function wasSystemLikelyAsleep(
  previousCheckMs: number,
  currentCheckMs: number,
  expectedIntervalMs: number,
) {
  return currentCheckMs - previousCheckMs > expectedIntervalMs + WAKE_GAP_MS;
}

export function shouldContinuePlayback({
  wasPlaying,
  resumeAfterNetworkError,
  paused,
  ended,
}: {
  wasPlaying: boolean;
  resumeAfterNetworkError: boolean;
  paused: boolean;
  ended: boolean;
}) {
  return !ended && (wasPlaying || resumeAfterNetworkError || paused === false);
}
