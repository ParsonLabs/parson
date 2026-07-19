"use client";

import getBaseURL from "@/lib/api/server-url";
import { getMediaToken } from "@parson/music-sdk";

export function buildStreamUrl(
  baseURL: string,
  songId: string,
  bitrate: number = 0,
  slowedReverb: boolean = false,
  mediaToken: string | null = null,
) {
  const url = new URL(
    `${baseURL}/api/v1/media/songs/${encodeURIComponent(songId)}/stream`,
  );
  url.searchParams.set("bitrate", String(bitrate));
  if (slowedReverb) url.searchParams.set("slowed_reverb", "true");

  if (mediaToken) {
    url.searchParams.set("media_token", mediaToken);
  }

  return url.toString();
}

export default function streamUrl(
  songId: string,
  bitrate: number = 0,
  slowedReverb: boolean = false,
) {
  return buildStreamUrl(
    getBaseURL(),
    songId,
    bitrate,
    slowedReverb,
    getMediaToken(),
  );
}
