import { describe, expect, test } from "bun:test";
import { blankSong, normalizeSong } from "./player-model";

describe("player song normalization", () => {
  test("creates complete nested entities from partial playback input", () => {
    const song = normalizeSong(
      {
        id: 42 as unknown as string,
        name: "Track",
        duration: "90" as unknown as number,
      },
      { id: "artist-1", name: "Artist" },
      { id: "album-1", name: "Album", cover_url: "cover.jpg" },
    );

    expect(song.id).toBe("42");
    expect(song.duration).toBe(90);
    expect(song.artist).toBe("Artist");
    expect(song.artist_object.id).toBe("artist-1");
    expect(song.album_object.cover_url).toBe("cover.jpg");
    expect(song.contributing_artists).toEqual([]);
  });

  test("returns independent blank nested objects", () => {
    const first = blankSong();
    const second = blankSong();
    first.artist_object.name = "Changed";
    expect(second.artist_object.name).toBe("");
  });
});
