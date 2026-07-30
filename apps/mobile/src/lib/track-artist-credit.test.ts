import { describe, expect, test } from "bun:test";

import { trackArtistCredit } from "./track-artist-credit";

describe("album track artist credits", () => {
  test("hides the album artist when the track has no distinct credit", () => {
    expect(
      trackArtistCredit({
        albumArtist: "Tyla",
        albumType: "Album",
        contributingArtists: [],
        trackArtist: "Tyla",
      }),
    ).toBeNull();
  });

  test("keeps a distinct featured artist without duplicating credits", () => {
    expect(
      trackArtistCredit({
        albumArtist: "Tyla",
        albumType: "Album",
        contributingArtists: ["Liquideep"],
        trackArtist: "Tyla",
      }),
    ).toBe("Tyla feat. Liquideep");
  });

  test("keeps per-track artists visible on compilations", () => {
    expect(
      trackArtistCredit({
        albumArtist: "Various Artists",
        albumType: "Compilation",
        trackArtist: "Guest",
      }),
    ).toBe("Guest");
  });
});
