import type { FavoriteSongDetail } from "@parson/music-sdk";

export function likedSongsOldestFirst(pages: FavoriteSongDetail[][]) {
  return pages
    .flatMap((page) => page)
    .reverse()
    .map((item) => item.song);
}
