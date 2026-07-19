import { describe, expect, test } from "bun:test";
import {
  boundedMediaPosition,
  boundedVolume,
  isCurrentTrackGeneration,
  queueIndexForPersistedPosition,
} from "./player-state";

describe("player numeric boundaries", () => {
  test("rejects non-finite media state", () => {
    expect(boundedMediaPosition(Number.NaN, 120)).toBeNull();
    expect(boundedMediaPosition(Number.POSITIVE_INFINITY, 120)).toBeNull();
    expect(boundedVolume("not-a-number")).toBeNull();
  });

  test("clamps seeks and volume to browser-supported ranges", () => {
    expect(boundedMediaPosition(-5, 120)).toBe(0);
    expect(boundedMediaPosition(180, 120)).toBe(120);
    expect(boundedVolume(-20)).toBe(0);
    expect(boundedVolume(250)).toBe(1);
    expect(boundedVolume(50)).toBe(0.5);
    expect(boundedMediaPosition("12.5", 120)).toBe(12.5);
    expect(boundedMediaPosition(180, Number.NaN)).toBe(180);
  });
});

test("persisted queue positions survive filtered missing songs", () => {
  const positions = [0, 2, 3];
  expect(queueIndexForPersistedPosition(positions, 2)).toBe(1);
  expect(queueIndexForPersistedPosition(positions, 1)).toBe(1);
  expect(queueIndexForPersistedPosition(positions, 99)).toBe(2);
  expect(queueIndexForPersistedPosition([], 4)).toBe(0);
  expect(queueIndexForPersistedPosition([null, null], 4)).toBe(1);
});

describe("async playback generations", () => {
  test("accepts only work for the active generation and track", () => {
    expect(isCurrentTrackGeneration(4, 4, "song-a", "song-a")).toBeTrue();
    expect(isCurrentTrackGeneration(3, 4, "song-a", "song-a")).toBeFalse();
    expect(isCurrentTrackGeneration(4, 4, "song-a", "song-b")).toBeFalse();
    expect(isCurrentTrackGeneration(4, 4)).toBeTrue();
  });
});
