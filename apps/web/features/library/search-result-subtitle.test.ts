import { describe, expect, test } from "bun:test";
import {
  searchResultIsPlayable,
  searchResultSubtitle,
} from "./search-result-subtitle";

const item = (
  itemType: string,
  artist?: string,
  primaryType?: string,
  songArtist?: string,
  contributors?: string[],
) => ({
  album_object: primaryType
    ? { id: "release", name: "Release", primary_type: primaryType }
    : undefined,
  artist_object: artist ? { id: "artist", name: artist } : undefined,
  item_type: itemType,
  song_object:
    songArtist || contributors
      ? {
          artist: songArtist,
          contributing_artists: contributors,
          duration: 200,
          id: "recording",
          name: "Recording",
          path: "",
        }
      : undefined,
});

describe("search result subtitles", () => {
  test("artists show only their type", () => {
    expect(searchResultSubtitle(item("artist", "Primary Artist"))).toEqual({
      label: "Artist",
    });
  });

  test("songs show their type and artist in mixed results", () => {
    expect(searchResultSubtitle(item("song", "Primary Artist"))).toEqual({
      artist: "Primary Artist",
      label: "Song",
    });
    expect(
      searchResultSubtitle(
        item("song", "Primary Artist", undefined, "Primary Artist", [
          "Guest Artist",
        ]),
      ),
    ).toEqual({
      artist: "Primary Artist feat. Guest Artist",
      label: "Song",
    });
  });

  test("albums and editions keep type and artist", () => {
    expect(searchResultSubtitle(item("album", "Primary Artist"))).toEqual({
      artist: "Primary Artist",
      label: "Album",
    });
    expect(
      searchResultSubtitle(
        item("album", "Primary Artist", "Anniversary Edition"),
      ),
    ).toEqual({
      artist: "Primary Artist",
      label: "Edition",
    });
  });

  test("playlists show only their type", () => {
    expect(searchResultSubtitle(item("playlist"))).toEqual({
      label: "Playlist",
    });
  });

  test("artist rows do not expose the direct play control", () => {
    expect(searchResultIsPlayable("artist")).toBeFalse();
    expect(searchResultIsPlayable("song")).toBeTrue();
    expect(searchResultIsPlayable("album")).toBeTrue();
  });
});
