export function moveQueueItem<T>(
  items: readonly T[],
  from: number,
  to: number,
) {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  ) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function queueDropIndex(
  length: number,
  from: number,
  target: number,
  edge: "before" | "after",
) {
  if (
    length <= 0 ||
    from < 0 ||
    from >= length ||
    target < 0 ||
    target >= length
  ) {
    return from;
  }
  const insertionIndex = target + (edge === "after" ? 1 : 0);
  return Math.min(length - 1, insertionIndex - (from < insertionIndex ? 1 : 0));
}

export function activeQueueIndexAfterMove(
  active: number,
  from: number,
  to: number,
) {
  if (active === from) return to;
  if (from < active && to >= active) return active - 1;
  if (from > active && to <= active) return active + 1;
  return active;
}
