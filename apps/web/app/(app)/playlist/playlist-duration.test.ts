import { describe, expect, it } from "bun:test";
import { formatPlaylistDuration } from "./playlist-duration";

describe("formatPlaylistDuration", () => {
  it("handles empty and short playlists", () => {
    expect(formatPlaylistDuration(0)).toBe("0 min");
    expect(formatPlaylistDuration(45)).toBe("1 min");
    expect(formatPlaylistDuration(8 * 60 + 44)).toBe("9 min");
  });

  it("uses readable hour units", () => {
    expect(formatPlaylistDuration(60 * 60)).toBe("1 hr");
    expect(formatPlaylistDuration((2 * 60 + 15) * 60)).toBe("2 hrs 15 min");
  });

  it("normalizes long playlists into days", () => {
    expect(formatPlaylistDuration(24 * 60 * 60)).toBe("1 day");
    expect(formatPlaylistDuration((24 * 60 + 2 * 60 + 5) * 60)).toBe(
      "1 day 2 hrs 5 min",
    );
    expect(formatPlaylistDuration(2 * 24 * 60 * 60)).toBe("2 days");
  });
});
