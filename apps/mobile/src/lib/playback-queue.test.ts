import { expect, test } from "bun:test";

import { playableQueueSongs } from "./playback-queue";

test("normalizes generated playback queue songs for the native player", () => {
  const [song] = playableQueueSongs([
    {
      album_object: { id: "album", name: "Album", cover_url: "/cover" },
      artist: "Artist",
      artist_object: { id: "artist", name: "Artist" },
      contributing_artist_ids: [],
      contributing_artists: [],
      duration: 180,
      id: "song",
      name: "Song",
      origin: "generated",
      queue_position: 0,
      track_number: 1,
    },
  ]);
  expect(song?.album_object.cover_url).toBe("/cover");
  expect(song?.album_object.songs).toEqual([]);
  expect(song?.artist_object.featured_on_album_ids).toEqual([]);
});
