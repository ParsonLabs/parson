export function shouldRestartFinishedTrack(
  currentTime: number,
  duration: number,
) {
  return (
    Number.isFinite(currentTime) &&
    Number.isFinite(duration) &&
    duration > 0 &&
    currentTime >= duration - 0.25
  );
}
