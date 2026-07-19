export function uniqueById<T extends { id: string }>(
  items: Array<T | null | undefined>,
) {
  const valid = items.filter((item): item is T =>
    Boolean(item && typeof item.id === "string" && item.id),
  );
  const unique = new Map<string, T>();
  for (const item of valid) {
    if (!unique.has(item.id)) unique.set(item.id, item);
  }
  return Array.from(unique.values());
}
