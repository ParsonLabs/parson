export function formatPlaybackTime(time: number) {
  if (!Number.isFinite(time) || time <= 0) return "0:00";
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function timelineValueText(currentTime: number, duration: number) {
  return `${formatPlaybackTime(currentTime)} of ${formatPlaybackTime(duration)}`;
}
