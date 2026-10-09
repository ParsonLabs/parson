import { describe, expect, test } from "bun:test";
import { presentRecentItems } from "./home-recent-items";

type RecentSource = {
  id: string;
  album_object: { id: string };
};

function source(id: string, albumId: string): RecentSource {
  return { id, album_object: { id: albumId } };
}

describe("presentRecentItems", () => {
  test("collapses repeated plays into one album card", () => {
    const items = presentRecentItems([
      source("event-1", "album-a"),
      source("event-2", "album-a"),
      source("event-3", "album-a"),
      source("event-4", "album-a"),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      historyIndex: 0,
      kind: "album",
      source: source("event-1", "album-a"),
    });
  });

  test("collapses interleaved albums and keeps unrelated songs", () => {
    const items = presentRecentItems([
      source("a-1", "album-a"),
      source("b-1", "album-b"),
      source("a-2", "album-a"),
      source("b-2", "album-b"),
      source("c-1", "album-c"),
      source("a-3", "album-a"),
      source("b-3", "album-b"),
      source("a-4", "album-a"),
      source("b-4", "album-b"),
    ]);

    expect(
      items.map((item) => [item.kind, item.source.id, item.historyIndex]),
    ).toEqual([
      ["album", "a-1", 0],
      ["album", "b-1", 1],
      ["song", "c-1", 4],
    ]);
  });

  test("does not group songs without an album identity", () => {
    const sources = [
      source("1", ""),
      source("2", ""),
      source("3", ""),
      source("4", ""),
    ];
    const items = presentRecentItems(sources);
    expect(items.map((item) => item.source)).toEqual(sources);
    expect(items.every((item) => item.kind === "song")).toBe(true);
  });

  test.each([2, 3])("groups an album with %i recent songs", (count) => {
    const items = presentRecentItems(
      Array.from({ length: count }, (_, index) =>
        source(`golden-${index}`, "golden"),
      ),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("album");
    expect(items[0]?.source.album_object.id).toBe("golden");
  });

  test("keeps single songs in chronological order", () => {
    const sources = [
      source("1", "album-a"),
      source("2", "album-b"),
      source("3", "album-c"),
    ];
    const items = presentRecentItems(sources);
    expect(items.map((item) => item.source)).toEqual(sources);
    expect(items.every((item) => item.kind === "song")).toBe(true);
  });
});
