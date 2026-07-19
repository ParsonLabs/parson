export type PlayerAudioPresetId = "original" | "slow" | "deep-slow" | "faster";

export type PlayerAudioPreset = {
  id: PlayerAudioPresetId;
  label: string;
  rate: number;
  wet: number;
  dry: number;
  preservePitch: boolean;
};

export const playerAudioPresets: readonly PlayerAudioPreset[] = [
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
];

export const defaultProcessedAudioPreset = playerAudioPresets[1]!;
export const reverbImpulseDurationSeconds = 1.8;

export function getPlayerAudioPreset(id: PlayerAudioPresetId) {
  return (
    playerAudioPresets.find((preset) => preset.id === id) ??
    playerAudioPresets[0]!
  );
}

export function reverbImpulseLength(sampleRate: number) {
  return Math.max(1, Math.floor(sampleRate * reverbImpulseDurationSeconds));
}

/**
 * Fills one impulse-response channel with deterministic decaying noise.
 * Sharing this routine gives browser and native convolution the same response
 * instead of generating a different room on every player initialization.
 */
export function fillReverbImpulseChannel(data: Float32Array, channel: number) {
  const decayPerSample = Math.exp(Math.log(0.0008) / data.length);
  let envelope = 1;
  let state = (0x6d2b79f5 ^ Math.imul(channel + 1, 0x9e3779b9)) >>> 0;

  for (let index = 0; index < data.length; index += 1) {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const normalized = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    data[index] = (normalized * 2 - 1) * envelope;
    envelope *= decayPerSample;
  }
}
