import { describe, expect, test } from "bun:test";

import {
  albumDirectoryName,
  albumTrackFilename,
  mediaExtension,
  safePathComponent,
  songFilename,
} from "./download-paths";

describe("download paths", () => {
  test("sanitizes reserved characters and bounds UTF-8 components by bytes", () => {
    expect(safePathComponent('  A/B:C*D?E"F<G>H|  ')).toBe("A_B_C_D_E_F_G_H_");
    const unicode = safePathComponent("🎵".repeat(100));
    expect(new TextEncoder().encode(unicode).length).toBeLessThanOrEqual(72);
    expect(unicode.endsWith("🎵")).toBeTrue();
  });

  test("keeps equal titles collision-resistant by stable IDs", () => {
    expect(songFilename("Artist", "Intro", "song-a", "/a.flac")).not.toBe(
      songFilename("Artist", "Intro", "song-b", "/b.flac"),
    );
    expect(albumTrackFilename(0, "Intro", "song-a", "/a.flac")).not.toBe(
      albumTrackFilename(0, "Intro", "song-b", "/b.flac"),
    );
    expect(albumDirectoryName("Greatest Hits", "Artist", "album-a")).not.toBe(
      albumDirectoryName("Greatest Hits", "Artist", "album-b"),
    );
  });

  test("accepts bounded extensions and rejects path-like suffixes", () => {
    expect(mediaExtension("track.FLAC")).toBe("flac");
    expect(mediaExtension("track.mpeg")).toBe("mpeg");
    expect(mediaExtension("track.toolongextension")).toBe("mp3");
    expect(mediaExtension("track./bad")).toBe("mp3");
  });
});
