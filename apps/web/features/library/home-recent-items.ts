type RecentItemSource = {
  album_object: {
    id: string;
  };
};

export type PresentedRecentItem<T> = {
  historyIndex: number;
  kind: "album" | "song";
  source: T;
};

export function presentRecentItems<T extends RecentItemSource>(
  sources: readonly T[],
): PresentedRecentItem<T>[] {
  const albumCounts = new Map<string, number>();
  for (const source of sources) {
    const albumId = source.album_object.id;
    albumCounts.set(albumId, (albumCounts.get(albumId) ?? 0) + 1);
  }

  const representedAlbums = new Set<string>();
  const items: PresentedRecentItem<T>[] = [];
  sources.forEach((source, historyIndex) => {
    const albumId = source.album_object.id;
    const canRepresentAsAlbum =
      Boolean(albumId) && (albumCounts.get(albumId) ?? 0) > 1;
    if (canRepresentAsAlbum && representedAlbums.has(albumId)) {
      return;
    }
    if (canRepresentAsAlbum) {
      representedAlbums.add(albumId);
    }
    items.push({
      historyIndex,
      kind: canRepresentAsAlbum ? "album" : "song",
      source,
    });
  });

  return items;
}
