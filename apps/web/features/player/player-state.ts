export function boundedMediaPosition(
  value: number | string,
  duration?: number,
): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  const nonNegative = Math.max(0, numeric);
  return Number.isFinite(duration) && Number(duration) > 0
    ? Math.min(nonNegative, Number(duration))
    : nonNegative;
}

export function boundedVolume(value: number | string): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric / 100));
}

export function isCurrentTrackGeneration(
  requestedGeneration: number,
  currentGeneration: number,
  requestedSongId?: string,
  currentSongId?: string,
) {
  return (
    requestedGeneration === currentGeneration &&
    (requestedSongId === undefined || requestedSongId === currentSongId)
  );
}

export function queueIndexForPersistedPosition(
  positions: Array<number | null>,
  persistedPosition: number,
): number {
  if (!positions.length) return 0;
  const exact = positions.findIndex(
    (position) => position === persistedPosition,
  );
  if (exact >= 0) return exact;
  const next = positions.findIndex(
    (position) => position !== null && position > persistedPosition,
  );
  return next >= 0 ? next : positions.length - 1;
}
