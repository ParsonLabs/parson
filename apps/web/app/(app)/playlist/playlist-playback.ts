export function shuffledIndices(
  length: number,
  random: () => number = Math.random,
) {
  const indices = Array.from({ length }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1));
    [indices[index], indices[swapWith]] = [indices[swapWith]!, indices[index]!];
  }
  if (
    indices.length > 1 &&
    indices.every((originalIndex, index) => originalIndex === index)
  ) {
    indices.push(indices.shift()!);
  }
  return indices;
}

export function moveItem<T>(items: readonly T[], from: number, to: number) {
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

export function playlistDropIndex(
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
