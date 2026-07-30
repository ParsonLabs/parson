import { describe, expect, test } from "bun:test";
import {
  activeQueueIndexAfterMove,
  moveQueueItem,
  queueDropIndex,
} from "./player-queue-reorder";

describe("player queue reordering", () => {
  test("moves an item without losing or duplicating its neighbors", () => {
    expect(moveQueueItem(["a", "b", "c", "d"], 1, 3)).toEqual([
      "a",
      "c",
      "d",
      "b",
    ]);
    expect(moveQueueItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  test("maps drop edges to the intended final position", () => {
    expect(queueDropIndex(5, 1, 3, "before")).toBe(2);
    expect(queueDropIndex(5, 1, 3, "after")).toBe(3);
    expect(queueDropIndex(5, 4, 1, "before")).toBe(1);
    expect(queueDropIndex(5, 4, 1, "after")).toBe(2);
  });

  test("keeps the same active item selected when rows cross it", () => {
    expect(activeQueueIndexAfterMove(2, 2, 4)).toBe(4);
    expect(activeQueueIndexAfterMove(2, 0, 3)).toBe(1);
    expect(activeQueueIndexAfterMove(2, 4, 1)).toBe(3);
    expect(activeQueueIndexAfterMove(2, 3, 4)).toBe(2);
  });

  test("ignores invalid moves", () => {
    expect(moveQueueItem(["a", "b"], -1, 1)).toEqual(["a", "b"]);
    expect(queueDropIndex(2, -1, 1, "after")).toBe(-1);
  });
});
