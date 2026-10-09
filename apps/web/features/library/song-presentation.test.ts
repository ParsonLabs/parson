import { describe, expect, test } from "bun:test";
import { displaySongTitle, isExplicitSongTitle } from "./song-presentation";

describe("song title presentation", () => {
  test("handles long whitespace and malformed qualifiers", () => {
    expect(displaySongTitle(`Track${" ".repeat(100000)}(feat. Guest)`)).toBe(
      "Track",
    );
    const malformed = "(ft ".repeat(10000);
    expect(displaySongTitle(malformed)).toBe(malformed.trim());
    expect(isExplicitSongTitle(`${" ".repeat(100000)}(explicit version)`)).toBe(
      true,
    );
  });

  test("omits featured qualifiers from displayed titles", () => {
    expect(displaySongTitle("FIXTURE TRACK (feat. Featured Artist)")).toBe(
      "FIXTURE TRACK",
    );
    expect(displaySongTitle("Track [ft Guest]")).toBe("Track");
    expect(displaySongTitle("Track (featuring Guest)")).toBe("Track");
  });

  test("preserves non-credit title qualifiers", () => {
    expect(displaySongTitle("Track (Live)")).toBe("Track (Live)");
    expect(displaySongTitle("Track (Explicit Ver.) (feat. Guest)")).toBe(
      "Track",
    );
    expect(displaySongTitle("Track (Remix) [ft. Guest]")).toBe("Track (Remix)");
    expect(displaySongTitle("Track (Remastered 2026)")).toBe(
      "Track (Remastered 2026)",
    );
  });

  test("detects explicit qualifiers without matching ordinary title words", () => {
    for (const suffix of [
      "(Explicit)",
      "(Explicit Ver.)",
      "[Explicit Version]",
      "(explicit edit)",
    ]) {
      const title = `Example Song ${suffix}`;
      expect(isExplicitSongTitle(title)).toBe(true);
      expect(displaySongTitle(title)).toBe("Example Song");
    }
    for (const title of [
      "Explicit Instructions",
      "Track (Clean Ver.)",
      "Track (Live)",
      "Track (Not Explicit)",
    ]) {
      expect(isExplicitSongTitle(title)).toBe(false);
      expect(displaySongTitle(title)).toBe(title);
    }
    expect(displaySongTitle("Track (Clean Ver.) (feat. Guest)")).toBe(
      "Track (Clean Ver.)",
    );
  });
});
