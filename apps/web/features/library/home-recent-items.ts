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
  const items = sources.map((source, historyIndex) => {
    const albumId = source.album_object.id;
    const canRepresentAsAlbum =
      (albumCounts.get(albumId) ?? 0) > 3 && !representedAlbums.has(albumId);
    if (canRepresentAsAlbum) representedAlbums.add(albumId);
    return {
      historyIndex,
      kind: canRepresentAsAlbum ? ("album" as const) : ("song" as const),
      source,
    };
  });

  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    if (!previous || !current) continue;
    const previousAlbumId = previous.source.album_object.id;
    if (current.source.album_object.id !== previousAlbumId) continue;

    const alternativeIndex = items.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index &&
        candidate.source.album_object.id !== previousAlbumId,
    );
    if (alternativeIndex === -1) continue;

    const alternative = items[alternativeIndex];
    if (!alternative) continue;
    items.splice(alternativeIndex, 1);
    items.splice(index, 0, alternative);
  }

  return items;
}
