export function shuffledQueue<T>(
  queue: readonly T[],
  currentIndex: number,
  random: () => number = Math.random,
): { currentIndex: number; queue: T[] } {
  if (!queue.length) return { currentIndex: -1, queue: [] };
  const safeIndex = Math.max(0, Math.min(currentIndex, queue.length - 1));
  const current = queue[safeIndex]!;
  const remaining = queue.filter((_, index) => index !== safeIndex);
  for (let index = remaining.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [remaining[index], remaining[target]] = [
      remaining[target]!,
      remaining[index]!,
    ];
  }
  return { currentIndex: 0, queue: [current, ...remaining] };
}

export function restoredQueue<T extends { id: string }>(
  original: readonly T[],
  current: T | null,
): { currentIndex: number; queue: T[] } {
  const queue = [...original];
  if (!current) return { currentIndex: queue.length ? 0 : -1, queue };
  const currentIndex = queue.findIndex((item) => item.id === current.id);
  if (currentIndex >= 0) return { currentIndex, queue };
  return { currentIndex: 0, queue: [current, ...queue] };
}
