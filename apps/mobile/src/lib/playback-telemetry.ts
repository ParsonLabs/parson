export type PlaybackTelemetryState = {
  completed: boolean;
  lastPosition: number;
  lastUpdateMs: number;
  listenedSeconds: number;
  qualified: boolean;
  started: boolean;
};

export function newPlaybackTelemetry(
  position = 0,
  nowMs = Date.now(),
): PlaybackTelemetryState {
  return {
    completed: false,
    lastPosition: Math.max(0, position),
    lastUpdateMs: nowMs,
    listenedSeconds: 0,
    qualified: false,
    started: false,
  };
}

export function updateListenedSeconds(
  state: PlaybackTelemetryState,
  position: number,
  nowMs: number,
  playing: boolean,
) {
  const nextPosition = Math.max(0, position);
  const positionDelta = nextPosition - state.lastPosition;
  const wallDelta = Math.max(0, (nowMs - state.lastUpdateMs) / 1_000);
  if (
    playing &&
    positionDelta >= 0 &&
    positionDelta <= Math.max(2, wallDelta * 2)
  ) {
    state.listenedSeconds += Math.min(positionDelta, wallDelta * 1.25);
  }
  state.lastPosition = nextPosition;
  state.lastUpdateMs = nowMs;
  return state.listenedSeconds;
}

export function qualifiedPlayThreshold(duration: number) {
  return Number.isFinite(duration) && duration > 0
    ? Math.min(duration * 0.5, 240)
    : 0;
}

export function isEarlySkip(listenedSeconds: number, duration: number) {
  return (
    Number.isFinite(duration) &&
    duration > 0 &&
    listenedSeconds < Math.min(30, duration * 0.3)
  );
}

export function isCompleted(listenedSeconds: number, duration: number) {
  return (
    Number.isFinite(duration) &&
    duration > 0 &&
    listenedSeconds >= duration * 0.85
  );
}
