import { describe, expect, test } from "bun:test";
import { songCreditsArtist } from "./artist-appearance";

const artist = { id: "track-owner", name: "Lúmina Vale" };

describe("artist appearances", () => {
  test("recognizes the primary track artist on another artist's album", () => {
    expect(
      songCreditsArtist(
        {
          artist: "Lumina Vale",
          contributing_artist_ids: [],
          contributing_artists: [],
        },
        artist,
      ),
    ).toBeTrue();
  });

  test("recognizes contributor IDs and rejects unrelated credits", () => {
    expect(
      songCreditsArtist(
        {
          artist: "Album Owner",
          contributing_artist_ids: ["track-owner"],
          contributing_artists: [],
        },
        artist,
      ),
    ).toBeTrue();
    expect(
      songCreditsArtist(
        {
          artist: "Album Owner",
          contributing_artist_ids: [],
          contributing_artists: ["Other Guest"],
        },
        artist,
      ),
    ).toBeFalse();
  });
});
