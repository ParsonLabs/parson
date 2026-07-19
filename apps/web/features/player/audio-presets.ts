import {
  defaultProcessedAudioPreset,
  fillReverbImpulseChannel,
  getPlayerAudioPreset,
  playerAudioPresets,
  reverbImpulseLength,
  type PlayerAudioPreset,
  type PlayerAudioPresetId,
} from "@parson/music-sdk";

export type AudioPresetId = PlayerAudioPresetId;
export type AudioPreset = PlayerAudioPreset;

export type AudioGraph = {
  convolver: ConvolverNode;
  context: AudioContext;
  dryGain: GainNode;
  source: MediaElementAudioSourceNode;
  wetGain: GainNode;
  wetConnected: boolean;
};

type PitchControllableMedia = {
  preservesPitch: boolean;
  webkitPreservesPitch?: boolean;
  mozPreservesPitch?: boolean;
};

export function setPitchPreservation(
  element: PitchControllableMedia,
  preservePitch: boolean,
) {
  element.preservesPitch = preservePitch;
  if ("webkitPreservesPitch" in element) {
    element.webkitPreservesPitch = preservePitch;
  }
  if ("mozPreservesPitch" in element) {
    element.mozPreservesPitch = preservePitch;
  }
}

export const audioPresets = playerAudioPresets;

export const defaultAudioPreset = defaultProcessedAudioPreset;

export function getAudioPreset(id: AudioPresetId) {
  return getPlayerAudioPreset(id);
}

export function createAudioElement() {
  const element = new Audio();
  element.crossOrigin = "anonymous";
  element.preload = "metadata";
  return element;
}

export function buildReverbImpulse(context: AudioContext) {
  // Keep convolution short for WebKitGTK.
  const length = reverbImpulseLength(context.sampleRate);
  const impulse = context.createBuffer(2, length, context.sampleRate);

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    fillReverbImpulseChannel(impulse.getChannelData(channel), channel);
  }

  return impulse;
}
