import type { LibraryCatalogArtist } from "@parson/music-sdk";

type ArtistCounts = Pick<
  LibraryCatalogArtist,
  "albumCount" | "appearanceCount" | "songCount"
>;

export function artistCatalogSummary({
  albumCount,
  appearanceCount,
  songCount,
}: ArtistCounts) {
  if (albumCount === 0 && songCount === 0) {
    return appearanceCount > 0
      ? `Appears on ${appearanceCount} ${
          appearanceCount === 1 ? "song" : "songs"
        }`
      : null;
  }

  return `${albumCount} ${albumCount === 1 ? "album" : "albums"} · ${songCount} ${
    songCount === 1 ? "song" : "songs"
  }`;
}
