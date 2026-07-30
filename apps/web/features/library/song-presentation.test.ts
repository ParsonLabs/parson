import { describe, expect, test } from "bun:test";
import { displaySongTitle } from "./song-presentation";

describe("song title presentation", () => {
  test("moves parenthesized featured artists out of the displayed title", () => {
    expect(displaySongTitle("FIXTURE TRACK (feat. Featured Artist)")).toBe(
      "FIXTURE TRACK",
    );
    expect(displaySongTitle("Track [ft Guest]")).toBe("Track");
  });

  test("preserves non-credit title qualifiers", () => {
    expect(displaySongTitle("Track (Live)")).toBe("Track (Live)");
    expect(displaySongTitle("Track (Remastered 2026)")).toBe(
      "Track (Remastered 2026)",
    );
  });
});
