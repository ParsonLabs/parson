"use client";

import streamUrl from "@/lib/api/stream-url";
import type { LibraryAlbum } from "@parson/music-sdk";

type AndroidDownloadBridge = {
  downloadAlbum: (payload: string) => void;
};

declare global {
  interface Window {
    ParsonAndroid?: AndroidDownloadBridge;
  }
}

const safeName = (value: string) =>
  value
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim()
    .slice(0, 120) || "Track";

const extensionFor = (path: string) => {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : "mp3";
};

const mimeFor = (extension: string) => {
  if (extension === "flac") return "audio/flac";
  if (extension === "m4a" || extension === "mp4") return "audio/mp4";
  if (extension === "wav") return "audio/wav";
  if (extension === "ogg" || extension === "oga") return "audio/ogg";
  if (extension === "opus") return "audio/opus";
  return "audio/mpeg";
};

export function downloadAlbum(album: LibraryAlbum) {
  const artist = album.artist_object?.name || "Unknown artist";
  const items = album.songs.map((song, index) => {
    const extension = extensionFor(song.path || "");
    const track = String(index + 1).padStart(2, "0");
    return {
      artist: song.artist_object?.name || song.artist || artist,
      fileName: `${track} - ${safeName(song.name)}.${extension}`,
      mimeType: mimeFor(extension),
      title: song.name || `Track ${track}`,
      url: streamUrl(song.id, 0, false),
    };
  });

  if (!items.length) return 0;

  if (window.ParsonAndroid?.downloadAlbum) {
    window.ParsonAndroid.downloadAlbum(
      JSON.stringify({ album: safeName(album.name), items }),
    );
    return items.length;
  }

  // Chromium drops same-frame download navigations.
  items.forEach((item, index) => {
    window.setTimeout(() => {
      const link = document.createElement("a");
      link.download = item.fileName;
      link.href = item.url;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }, index * 180);
  });
  return items.length;
}
