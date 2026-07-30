import { describe, expect, test } from "bun:test";
import { ApiError } from "@parson/music-sdk";
import { syncQueuePosition } from "./queue-position-sync";

describe("persisted queue position", () => {
  test("stores the active logical queue position and advances the revision", async () => {
    const calls: unknown[][] = [];
    const saved = await syncQueuePosition(
      { id: "queue/one", revision: 4 },
      7,
      async (...args) => {
        calls.push(args);
        return { current_position: 7, revision: 5 };
      },
    );
    expect(calls).toEqual([["queue/one", 7, 4]]);
    expect(saved).toEqual({ id: "queue/one", revision: 5 });
  });

  test("reconciles a concurrent revision and retries the requested position", async () => {
    const revisions: number[] = [];
    const saved = await syncQueuePosition(
      { id: "queue", revision: 2 },
      3,
      async (_id, position, revision) => {
        revisions.push(revision);
        if (revision === 2) {
          throw new ApiError(
            "conflict",
            {},
            {
              status: 409,
              headers: new Headers(),
              data: {
                error: "queue_revision_conflict",
                revision: 8,
                current_position: 1,
              },
            },
          );
        }
        return { current_position: position, revision: 9 };
      },
    );
    expect(revisions).toEqual([2, 8]);
    expect(saved).toEqual({ id: "queue", revision: 9 });
  });

  test("accepts a conflict when another client already stored the target", async () => {
    let calls = 0;
    const saved = await syncQueuePosition(
      { id: "queue", revision: 2 },
      3,
      async () => {
        calls += 1;
        throw new ApiError(
          "conflict",
          {},
          {
            status: 409,
            headers: new Headers(),
            data: {
              error: "queue_revision_conflict",
              revision: 8,
              current_position: 3,
            },
          },
        );
      },
    );
    expect(calls).toBe(1);
    expect(saved).toEqual({ id: "queue", revision: 8 });
  });
});
