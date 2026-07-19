import { describe, expect, test } from "bun:test";
import {
  audioPresets,
  buildReverbImpulse,
  getAudioPreset,
  setPitchPreservation,
} from "./audio-presets";

describe("player audio presets", () => {
  test("have unique identifiers and browser-safe values", () => {
    expect(new Set(audioPresets.map((preset) => preset.id)).size).toBe(
      audioPresets.length,
    );
    for (const preset of audioPresets) {
      expect(preset.rate).toBeGreaterThan(0);
      expect(preset.dry).toBeGreaterThanOrEqual(0);
      expect(preset.wet).toBeGreaterThanOrEqual(0);
    }
  });

  test("falls back to the original preset for unknown stored values", () => {
    expect(getAudioPreset("missing" as never).id).toBe("original");
  });

  test("the faster preset is materially faster than normal playback", () => {
    expect(getAudioPreset("faster").rate).toBeGreaterThanOrEqual(1.15);
  });

  test("pitch preservation reaches standard and WebKit media controls", () => {
    const media = {
      preservesPitch: true,
      webkitPreservesPitch: true,
      mozPreservesPitch: true,
    };
    setPitchPreservation(media, false);
    expect(media).toEqual({
      preservesPitch: false,
      webkitPreservesPitch: false,
      mozPreservesPitch: false,
    });
  });

  test("the reverb impulse stays short enough for interactive playback", () => {
    const sampleRate = 48_000;
    const context = {
      sampleRate,
      createBuffer: (channels: number, length: number) => {
        const data = Array.from(
          { length: channels },
          () => new Float32Array(length),
        );
        return {
          length,
          numberOfChannels: channels,
          getChannelData: (channel: number) => data[channel]!,
        };
      },
    } as unknown as AudioContext;

    const impulse = buildReverbImpulse(context);
    expect(impulse.length).toBeLessThanOrEqual(sampleRate * 2);
  });
});
