import { expect, test } from "bun:test";
import {
  songMenuEntityLinkVisibility,
  songMenuQueueItem,
} from "./song-menu-state";

test("song menu queue actions preserve album artwork", () => {
  const item = songMenuQueueItem({
    songId: "song-1",
    songName: "Song",
    artistId: "artist-1",
    artistName: "Artist",
    albumId: "album-1",
    albumName: "Album",
    albumCover: "/music/album/cover.jpg",
  });

  expect(item.album.cover_url).toBe("/music/album/cover.jpg");
});

test("album track menus omit links to the page already in view", () => {
  expect(songMenuEntityLinkVisibility("album")).toEqual({
    album: false,
    artist: false,
  });
  expect(songMenuEntityLinkVisibility("default")).toEqual({
    album: true,
    artist: true,
  });
  expect(songMenuEntityLinkVisibility("artist")).toEqual({
    album: true,
    artist: false,
  });
});
