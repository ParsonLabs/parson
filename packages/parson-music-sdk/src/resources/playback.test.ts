import { expect, test } from "bun:test";
import { ApiError } from "../core/http";
import { getPlaybackQueueRevisionConflict } from "./playback";

test("queue revision conflicts expose a validated reconciliation state", () => {
  const conflict = new ApiError(
    "conflict",
    {},
    {
      status: 409,
      headers: new Headers(),
      data: {
        error: "queue_revision_conflict",
        revision: 7,
        current_position: 3,
      },
    },
  );
  expect(getPlaybackQueueRevisionConflict(conflict)).toEqual({
    revision: 7,
    current_position: 3,
  });
  expect(
    getPlaybackQueueRevisionConflict(
      new ApiError(
        "bad response",
        {},
        {
          status: 409,
          headers: new Headers(),
          data: { error: "queue_revision_conflict", revision: -1 },
        },
      ),
    ),
  ).toBeNull();
});
