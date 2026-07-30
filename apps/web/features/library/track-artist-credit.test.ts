import { describe, expect, test } from "bun:test";
import {
  trackArtistCredit,
  trackArtistCreditParts,
} from "./track-artist-credit";

const credit = (
  trackArtist: string,
  contributingArtists: string[] = [],
  albumArtist = "Primary Artist",
  albumType = "Album",
) =>
  trackArtistCredit({
    albumArtist,
    albumType,
    contributingArtists,
    trackArtist,
  });

describe("track artist credits", () => {
  test("omits repeated and differently formatted album artists", () => {
    expect(credit("Primary Artist")).toBeNull();
    expect(credit("  primary   artist  ", ["Primary Artist"])).toBeNull();
    expect(
      credit("Primary Artist feat. PRIMARY ARTIST", ["primary artist"]),
    ).toBeNull();
  });

  test("keeps featured artists and avoids duplicate credits", () => {
    expect(credit("Primary Artist", ["Primary Artist", "Guest Artist"])).toBe(
      "Primary Artist feat. Guest Artist",
    );
    expect(credit("Primary Artist feat. Guest Artist", ["Guest Artist"])).toBe(
      "Primary Artist feat. Guest Artist",
    );
  });

  test("keeps featured artist IDs aligned for artist-page links", () => {
    expect(
      trackArtistCreditParts({
        albumArtist: "Primary Artist",
        albumType: "Album",
        contributingArtists: ["Featured Artist", "Second Guest"],
        contributingArtistIds: ["featured-id", "second-guest-id"],
        trackArtist: "Primary Artist",
      }),
    ).toEqual([
      { name: "Primary Artist" },
      { id: "featured-id", name: "Featured Artist" },
      { id: "second-guest-id", name: "Second Guest" },
    ]);
  });

  test("keeps differing track artists and collaborations", () => {
    expect(credit("Second Artist")).toBe("Second Artist");
    expect(credit("Primary Artist & Second Artist")).toBe(
      "Primary Artist & Second Artist",
    );
  });

  test("keeps compilation and various-artists credits", () => {
    expect(credit("Primary Artist", [], "Primary Artist", "Compilation")).toBe(
      "Primary Artist",
    );
    expect(credit("Various Artists", [], "Various Artists")).toBe(
      "Various Artists",
    );
  });

  test("keeps guest remix credits supplied as contributors", () => {
    expect(
      credit("Primary Artist", ["Guest Remixer"], "Primary Artist", "Remix"),
    ).toBe("Primary Artist feat. Guest Remixer");
  });
});
