import { describe, expect, it } from "bun:test";
import type { FavoriteSongDetail } from "@parson/music-sdk";
import { likedSongsOldestFirst } from "./liked-songs-order";

function favorite(songId: string, addedAt: string): FavoriteSongDetail {
  return {
    added_at: addedAt,
    song: { id: songId } as FavoriteSongDetail["song"],
    song_id: songId,
  };
}

describe("Liked Songs ordering", () => {
  it("puts the newest like at the bottom", () => {
    const songs = likedSongsOldestFirst([
      [
        favorite("newest", "2026-07-27T12:00:00"),
        favorite("middle", "2026-07-26T12:00:00"),
      ],
      [favorite("oldest", "2026-07-25T12:00:00")],
    ]);

    expect(songs.map((song) => song.id)).toEqual([
      "oldest",
      "middle",
      "newest",
    ]);
  });

  it("does not mutate cached query pages", () => {
    const firstPage = [
      favorite("newest", "2026-07-27T12:00:00"),
      favorite("oldest", "2026-07-25T12:00:00"),
    ];

    likedSongsOldestFirst([firstPage]);

    expect(firstPage.map((item) => item.song_id)).toEqual(["newest", "oldest"]);
  });
});
