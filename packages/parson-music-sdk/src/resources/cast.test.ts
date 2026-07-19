import { afterEach, expect, mock, spyOn, test } from "bun:test";
import api from "../core/http";
import {
  createCastSession,
  getCastSessionEventsURL,
  getCurrentCastSession,
  sendCastCommand,
} from "./cast";

afterEach(() => mock.restore());

test("cast session events use the API WebSocket origin", () => {
  expect(getCastSessionEventsURL()).toBe(
    "ws://localhost:1993/api/v1/cast/sessions/events",
  );
});

test("cast session creation sends the receiver and backend-authoritative queue", async () => {
  const session = { id: "cast-1", items: [] };
  const post = spyOn(api, "post").mockResolvedValue({
    data: session,
    status: 200,
    headers: new Headers(),
  } as never);
  expect(
    await createCastSession({
      receiver_id: "living-room",
      receiver_name: "Living room",
      song_ids: ["song-1", "song-2"],
      current_position: 1,
    }),
  ).toBe(session as never);
  expect(post).toHaveBeenCalledWith("/cast/sessions", {
    receiver_id: "living-room",
    receiver_name: "Living room",
    song_ids: ["song-1", "song-2"],
    current_position: 1,
  });
});

test("no active cast session is represented by a 204", async () => {
  spyOn(api, "get").mockResolvedValue({
    data: undefined,
    status: 204,
    headers: new Headers(),
  } as never);
  expect(await getCurrentCastSession()).toBeNull();
});

test("remote cast commands are explicit and bounded", async () => {
  const post = spyOn(api, "post").mockResolvedValue({
    data: { revision: 4, command_revision: 2 },
    status: 202,
    headers: new Headers(),
  } as never);
  await sendCastCommand("cast /1", "seek", { position_ms: 45_000 });
  expect(post).toHaveBeenCalledWith("/cast/sessions/cast%20%2F1/commands", {
    command: "seek",
    position_ms: 45_000,
  });
});
