import { describe, expect, test } from "bun:test";

import {
  MAX_STORED_QUEUE_LENGTH,
  parseStoredPlayerState,
  serializePlayerState,
} from "./player-storage";

const song = (id: string) => ({ id, name: `Song ${id}`, artist: "Artist" });

describe("player storage", () => {
  test("restores a bounded queue and clamps its current index", () => {
    const stored = serializePlayerState({
      currentIndex: 99,
      originalQueue: [song("a"), song("b")] as never,
      origin: "generated",
      queue: [song("b"), song("a")] as never,
      repeat: "all",
      shuffle: true,
    });
    expect(parseStoredPlayerState(stored)).toMatchObject({
      currentIndex: 1,
      origin: "generated",
      repeat: "all",
      shuffle: true,
    });
  });

  test("rejects malformed and oversized persisted queues", () => {
    expect(parseStoredPlayerState("{broken")).toBeNull();
    expect(
      parseStoredPlayerState(
        JSON.stringify({
          currentIndex: 0,
          originalQueue: [],
          queue: Array.from(
            { length: MAX_STORED_QUEUE_LENGTH + 1 },
            (_, index) => song(String(index)),
          ),
          repeat: "none",
          shuffle: false,
        }),
      ),
    ).toBeNull();
  });
});
