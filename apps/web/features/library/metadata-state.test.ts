import { expect, test } from "bun:test";
import {
  changedMetadata,
  hasMetadataChanges,
  validateMetadata,
} from "./metadata-state";

test("metadata saves include only fields changed by the editor", () => {
  const original = {
    song: { name: "Track", artist: "Artist", track_number: 1 },
    album: { name: "Album" },
    artist: { name: "Artist" },
  };
  const current = {
    ...original,
    song: { ...original.song, name: "New Track" },
  };
  expect(changedMetadata(original, current)).toEqual({
    song: { name: "New Track" },
  });
  expect(hasMetadataChanges(changedMetadata(current, current))).toBeFalse();
});

test("metadata validation rejects values the backend cannot safely apply", () => {
  expect(validateMetadata({ song: { name: "  " } })).toBe(
    "Names cannot be empty.",
  );
  expect(validateMetadata({ song: { track_number: 1.5 } })).not.toBeNull();
  expect(validateMetadata({ song: { duration: Number.NaN } })).not.toBeNull();
  expect(validateMetadata({ song: { duration: 240 } })).toBeNull();
  expect(validateMetadata({ song: { path: "  " } })).toBe(
    "File path cannot be empty.",
  );
  expect(validateMetadata({ song: { track_number: -1 } })).not.toBeNull();
  expect(validateMetadata({ song: { track_number: 65_536 } })).not.toBeNull();
  expect(validateMetadata({ song: { duration: -0.1 } })).not.toBeNull();
});

test("metadata diff preserves explicit clearing values and ignores undefined fields", () => {
  expect(
    changedMetadata(
      { song: { name: "Track", contributing_artists: ["Guest"] } },
      { song: { name: undefined, contributing_artists: [] } },
    ),
  ).toEqual({ song: { contributing_artists: [] } });
  expect(hasMetadataChanges({ album: { description: "" } })).toBeTrue();
});
