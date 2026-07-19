import { expect, test } from "bun:test";
import { uniqueById } from "./library-items";

test("library collections ignore malformed entries and keep the first unique id", () => {
  const first = { id: "artist-1", name: "First" };
  expect(
    uniqueById([undefined, null, first, { id: "artist-1", name: "Later" }]),
  ).toEqual([first]);
});
