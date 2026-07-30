import { describe, expect, test } from "bun:test";
import { parseStoredQueueSnapshot } from "./player-queue-storage";

const item = {
  song: { id: "song-1" },
  artist: {},
  album: {},
  origin: "manual",
  queuePosition: null,
};

describe("local queue restart snapshot", () => {
  test("restores only the current user's valid queue and clamps its index", () => {
    const value = JSON.stringify({
      version: 1,
      userId: "listener",
      index: 99,
      items: [item],
    });
    expect(parseStoredQueueSnapshot(value, "listener")).toMatchObject({
      userId: "listener",
      index: 0,
      items: [item],
    });
    expect(parseStoredQueueSnapshot(value, "someone-else")).toBeNull();
  });

  test("rejects corrupt, empty, and unidentified snapshots", () => {
    expect(parseStoredQueueSnapshot("{", "listener")).toBeNull();
    expect(
      parseStoredQueueSnapshot(
        JSON.stringify({ version: 1, userId: "listener", items: [] }),
        "listener",
      ),
    ).toBeNull();
    expect(
      parseStoredQueueSnapshot(
        JSON.stringify({
          version: 1,
          userId: "listener",
          items: [{ song: {} }],
        }),
        "listener",
      ),
    ).toBeNull();
  });
});
