import { describe, expect, test } from "bun:test";
import {
  moveItem,
  playlistDropIndex,
  shuffledIndices,
} from "./playlist-playback";

describe("playlist shuffle", () => {
  test("returns every track exactly once", () => {
    expect(shuffledIndices(4, () => 0)).toEqual([1, 2, 3, 0]);
  });

  test("handles empty and single-track playlists", () => {
    expect(shuffledIndices(0)).toEqual([]);
    expect(shuffledIndices(1)).toEqual([0]);
  });

  test("does not present an unchanged multi-track order as shuffled", () => {
    expect(shuffledIndices(3, () => 0.999)).toEqual([1, 2, 0]);
  });
});

describe("playlist reordering", () => {
  test("moves one track without losing or duplicating its neighbors", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  test("ignores same-position and out-of-range moves", () => {
    expect(moveItem(["a", "b"], 0, 0)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], -1, 1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 0, 2)).toEqual(["a", "b"]);
  });

  test("maps before and after drop edges to intuitive final positions", () => {
    expect(playlistDropIndex(4, 0, 2, "before")).toBe(1);
    expect(playlistDropIndex(4, 0, 2, "after")).toBe(2);
    expect(playlistDropIndex(4, 3, 1, "before")).toBe(1);
    expect(playlistDropIndex(4, 1, 3, "after")).toBe(3);
  });
});
