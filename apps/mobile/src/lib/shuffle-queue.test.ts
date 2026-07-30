import { describe, expect, test } from "bun:test";

import { restoredQueue, shuffledQueue } from "./shuffle-queue";

const songs = ["a", "b", "c", "d"].map((id) => ({ id }));

describe("shuffle queue", () => {
  test("keeps the current song first and shuffles every remaining song once", () => {
    const randomValues = [0, 0.75, 0.25];
    let call = 0;
    const result = shuffledQueue(songs, 2, () => randomValues[call++] ?? 0);
    expect(result.currentIndex).toBe(0);
    expect(result.queue[0]).toEqual({ id: "c" });
    expect(result.queue.map((song) => song.id).sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  test("restores source order while keeping the current song selected", () => {
    expect(restoredQueue(songs, songs[2]!)).toEqual({
      currentIndex: 2,
      queue: songs,
    });
  });

  test("handles empty queues", () => {
    expect(shuffledQueue([], -1)).toEqual({ currentIndex: -1, queue: [] });
    expect(restoredQueue([], null)).toEqual({ currentIndex: -1, queue: [] });
  });
});
