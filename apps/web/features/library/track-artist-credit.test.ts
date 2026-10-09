import { describe, expect, test } from "bun:test";
import {
  catalogSongArtistCredits,
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

test("compact catalog credits keep featured artists when titles are shortened", () => {
  expect(
    catalogSongArtistCredits({
      name: "Example Track (feat. Guest Artist & Another Artist)",
      artistName: "Primary Artist",
      artistId: "primary",
    }),
  ).toEqual([
    { id: "primary", name: "Primary Artist" },
    { name: "Guest Artist" },
    { name: "Another Artist" },
  ]);
  expect(
    catalogSongArtistCredits({
      name: "Example Track (Live)",
      artistName: "Primary Artist",
      artistId: "primary",
    }),
  ).toEqual([{ id: "primary", name: "Primary Artist" }]);
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
      "Primary Artist, Guest Artist",
    );
    expect(credit("Primary Artist feat. Guest Artist", ["Guest Artist"])).toBe(
      "Primary Artist, Guest Artist",
    );
  });

  test("keeps featured artist IDs aligned for artist-page links", () => {
    expect(
      trackArtistCreditParts({
        albumArtist: "Primary Artist",
        albumArtistId: "primary-id",
        albumType: "Album",
        contributingArtists: ["Featured Artist", "Second Guest"],
        contributingArtistIds: ["featured-id", "second-guest-id"],
        trackArtist: "Primary Artist",
      }),
    ).toEqual([
      { id: "primary-id", name: "Primary Artist" },
      { id: "featured-id", name: "Featured Artist" },
      { id: "second-guest-id", name: "Second Guest" },
    ]);
  });

  test("splits inline featured credits and resolves their separate links", () => {
    expect(
      trackArtistCreditParts({
        albumArtist: "Primary Artist",
        albumArtistId: "primary-id",
        albumType: "Album",
        trackArtist: "Primary Artist feat. Guest Artist",
        contributingArtists: ["Guest Artist", "Primary Artist"],
        contributingArtistIds: ["guest-id", "primary-id"],
      }),
    ).toEqual([
      { id: "primary-id", name: "Primary Artist" },
      { id: "guest-id", name: "Guest Artist" },
    ]);
  });

  test("keeps differing track artists and collaborations", () => {
    expect(credit("Second Artist")).toBe("Second Artist");
    expect(credit("Primary Artist & Second Artist")).toBe(
      "Primary Artist, Second Artist",
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
    ).toBe("Primary Artist, Guest Remixer");
  });
});
