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
  test("keeps every history event when an album representation is useful", () => {
    const items = presentRecentItems([
      source("event-1", "album-a"),
      source("event-2", "album-a"),
      source("event-3", "album-a"),
      source("event-4", "album-a"),
    ]);

    expect(items).toHaveLength(4);
    expect(items.map((item) => item.kind)).toEqual([
      "album",
      "song",
      "song",
      "song",
    ]);
    expect(items.map((item) => item.historyIndex).sort()).toEqual([0, 1, 2, 3]);
  });

  test("separates adjacent matching artwork when an alternative exists", () => {
    const items = presentRecentItems([
      source("event-1", "album-a"),
      source("event-2", "album-a"),
      source("event-3", "album-b"),
      source("event-4", "album-a"),
    ]);

    expect(items.map((item) => item.source.album_object.id)).toEqual([
      "album-a",
      "album-b",
      "album-a",
      "album-a",
    ]);
  });

  test("retains chronological order when no alternative artwork exists", () => {
    const items = presentRecentItems([
      source("event-1", "album-a"),
      source("event-2", "album-a"),
      source("event-3", "album-a"),
    ]);

    expect(items.map((item) => item.source.id)).toEqual([
      "event-1",
      "event-2",
      "event-3",
    ]);
  });
});
