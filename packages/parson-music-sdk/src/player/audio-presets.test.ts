import { describe, expect, test } from "bun:test";

import {
  fillReverbImpulseChannel,
  getPlayerAudioPreset,
  playerAudioPresets,
  reverbImpulseLength,
} from "./audio-presets";

describe("shared player audio presets", () => {
  test("exposes exactly the four web and native presets", () => {
    expect(playerAudioPresets).toEqual([
      {
        id: "original",
        label: "Original",
        rate: 1,
        wet: 0,
        dry: 1,
        preservePitch: true,
      },
      {
        id: "slow",
        label: "Slow",
        rate: 0.78,
        wet: 0.18,
        dry: 0.82,
        preservePitch: false,
      },
      {
        id: "deep-slow",
        label: "Deep Slow",
        rate: 0.64,
        wet: 0.35,
        dry: 0.65,
        preservePitch: false,
      },
      {
        id: "faster",
        label: "Faster",
        rate: 1.2,
        wet: 0.08,
        dry: 0.98,
        preservePitch: false,
      },
    ]);
  });

  test("falls back to original for an unknown persisted value", () => {
    expect(getPlayerAudioPreset("unknown" as never).id).toBe("original");
  });

  test("builds a deterministic stereo impulse shared by every client", () => {
    const length = reverbImpulseLength(48_000);
    const left = new Float32Array(length);
    const sameLeft = new Float32Array(length);
    const right = new Float32Array(length);
    fillReverbImpulseChannel(left, 0);
    fillReverbImpulseChannel(sameLeft, 0);
    fillReverbImpulseChannel(right, 1);

    expect(left).toEqual(sameLeft);
    expect(left.slice(0, 32)).not.toEqual(right.slice(0, 32));
    expect(Math.abs(left.at(-1) ?? 1)).toBeLessThan(0.001);
  });
});
