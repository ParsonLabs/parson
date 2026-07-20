import type { LibraryAlbum, LibrarySong } from "@parson/music-sdk";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { useSyncExternalStore } from "react";

import { freshAuthorizationHeaders, streamUrl } from "@/lib/runtime";
import {
  albumDirectoryName,
  albumTrackFilename,
  songFilename,
} from "@/lib/download-paths";

type DownloadRecord = {
  albumDownload?: { albumId: string; songIds: string[] };
  id: string;
  uri: string;
  song?: LibrarySong;
};

const DOWNLOADS_KEY = "parson.downloaded-songs";
const downloaded = new Map<string, DownloadRecord>();
const listeners = new Set<() => void>();
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;
let persistenceQueue = Promise.resolve();
let revision = 0;

const snapshot = () => revision;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const changed = () => {
  revision += 1;
  listeners.forEach((listener) => listener());
};
const persist = () => {
  const snapshot = JSON.stringify([...downloaded.values()]);
  persistenceQueue = persistenceQueue
    .catch(() => {})
    .then(() => AsyncStorage.setItem(DOWNLOADS_KEY, snapshot));
  return persistenceQueue;
};

export function useDownloadsRevision() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export async function hydrateDownloads() {
  if (hydrated) return;
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      try {
        const stored = await AsyncStorage.getItem(DOWNLOADS_KEY);
        const raw = stored ? (JSON.parse(stored) as unknown[]) : [];
        let needsMigration = false;
        for (const item of raw) {
          const legacy = Array.isArray(item) ? item : null;
          const value = legacy
            ? {
                albumDownload: undefined,
                id: legacy[0],
                song: undefined,
                uri: legacy[1],
              }
            : (item as Partial<DownloadRecord>);
          if (
            typeof value.id === "string" &&
            typeof value.uri === "string" &&
            new File(value.uri).exists
          ) {
            downloaded.set(value.id, {
              albumDownload: value.albumDownload,
              id: value.id,
              uri: value.uri,
              song: "song" in value ? value.song : undefined,
            });
            needsMigration ||= !!legacy;
          } else {
            needsMigration = true;
          }
        }
        if (needsMigration) await persist();
      } catch {
      } finally {
        hydrated = true;
        changed();
      }
    })();
  }
  await hydrationPromise;
}

export function downloadedSongUri(songId: string) {
  return downloaded.get(songId)?.uri ?? null;
}

export function isSongDownloaded(songId: string) {
  return downloaded.has(songId);
}

export function downloadedRecords() {
  return [...downloaded.values()];
}

export type DownloadedLibraryItem =
  { kind: "album"; album: LibraryAlbum } | { kind: "song"; song: LibrarySong };

const downloadParent = (uri: string) => {
  const path = uri.split("?", 1)[0]?.replace(/\/+$/, "") ?? "";
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
};

const isIndividualSongsFolder = (parent: string) =>
  /\/Parson\/Songs$/i.test(decodeURI(parent));

export function groupDownloadedLibrary(
  songs: LibrarySong[],
): DownloadedLibraryItem[] {
  const downloadedById = new Map(songs.map((song) => [song.id, song]));
  const declaredAlbums = new Map<string, string[]>();
  downloaded.forEach((record) => {
    const batch = record.albumDownload;
    if (
      batch?.albumId &&
      batch.songIds.length &&
      batch.songIds.every((id) => downloadedById.has(id))
    ) {
      declaredAlbums.set(batch.albumId, batch.songIds);
    }
  });
  const legacyAlbumFolders = new Map<string, Map<string, string[]>>();
  downloaded.forEach((record) => {
    const song = record.song;
    const albumId = song?.album_object?.id;
    const parent = downloadParent(record.uri);
    if (
      !song ||
      !albumId ||
      !downloadedById.has(song.id) ||
      !parent ||
      isIndividualSongsFolder(parent)
    )
      return;
    const folders =
      legacyAlbumFolders.get(albumId) ?? new Map<string, string[]>();
    const songIds = folders.get(parent) ?? [];
    songIds.push(song.id);
    folders.set(parent, songIds);
    legacyAlbumFolders.set(albumId, folders);
  });
  legacyAlbumFolders.forEach((folders, albumId) => {
    if (declaredAlbums.has(albumId)) return;
    const largestFolder = [...folders.values()].sort(
      (left, right) => right.length - left.length,
    )[0];
    // Legacy album downloads share a folder but have no batch marker.
    if (largestFolder && largestFolder.length > 1) {
      declaredAlbums.set(
        albumId,
        largestFolder.sort(
          (left, right) =>
            (downloadedById.get(left)?.track_number ?? 0) -
            (downloadedById.get(right)?.track_number ?? 0),
        ),
      );
    }
  });
  const completeAlbums = new Map<string, LibraryAlbum>();

  for (const song of songs) {
    const album = song.album_object;
    if (!album?.id || completeAlbums.has(album.id)) continue;
    const declaredSongIds = declaredAlbums.get(album.id);
    const albumSongIds = album.songs?.map((track) => track.id) ?? [];
    const completeSongIds = declaredSongIds ?? albumSongIds;
    if (
      !completeSongIds.length ||
      !completeSongIds.every((id) => downloadedById.has(id))
    )
      continue;
    completeAlbums.set(album.id, {
      ...album,
      artist_object: song.artist_object,
      songs: completeSongIds.flatMap((id) => {
        const track = downloadedById.get(id);
        return track ? [track] : [];
      }),
    });
  }

  const emittedAlbums = new Set<string>();
  return songs.flatMap((song): DownloadedLibraryItem[] => {
    const albumId = song.album_object?.id;
    const album = albumId ? completeAlbums.get(albumId) : undefined;
    if (!album) return [{ kind: "song", song }];
    if (emittedAlbums.has(album.id)) return [];
    emittedAlbums.add(album.id);
    return [{ kind: "album", album }];
  });
}

export async function enrichDownloadedSongs(songs: LibrarySong[]) {
  let didChange = false;
  for (const song of songs) {
    const record = downloaded.get(song.id);
    if (record && !record.song) {
      downloaded.set(song.id, { ...record, song });
      didChange = true;
    }
  }
  if (didChange) {
    await persist();
    changed();
  }
}

async function rememberDownload(
  song: LibrarySong,
  uri: string,
  notify = true,
  albumDownload?: DownloadRecord["albumDownload"],
) {
  downloaded.set(song.id, { albumDownload, id: song.id, uri, song });
  if (notify) {
    await persist();
    changed();
  }
}

export async function removeDownload(songId: string) {
  await removeDownloads([songId]);
}

export async function removeDownloads(songIds: string[]) {
  const records = songIds.flatMap((id) => {
    const record = downloaded.get(id);
    if (!record) return [];
    downloaded.delete(id);
    return [record];
  });
  if (!records.length) return;
  changed();
  for (const record of records) {
    try {
      const file = new File(record.uri);
      if (file.exists) file.delete();
    } catch {}
  }
  await persist();
}

export async function downloadAlbum(
  name: string,
  songs: LibrarySong[],
  onProgress?: (done: number) => void,
) {
  const albumId = songs[0]?.album_object?.id;
  const artist = songs[0]?.artist;
  const directory = new Directory(
    Paths.document,
    "Parson",
    albumDirectoryName(name, artist, albumId ?? name),
  );
  const albumDownload = albumId
    ? {
        albumId,
        songIds: songs.map((song) => song.id),
      }
    : undefined;
  directory.create({ intermediates: true, idempotent: true });
  try {
    for (let index = 0; index < songs.length; index += 1) {
      const song = songs[index];
      if (!song) continue;
      const destination = new File(
        directory,
        albumTrackFilename(index, song.name, song.id, song.path),
      );
      const saved = await File.downloadFileAsync(
        streamUrl(song.id),
        destination,
        { headers: await freshAuthorizationHeaders(), idempotent: true },
      );
      await rememberDownload(song, saved.uri, false, albumDownload);
      onProgress?.(index + 1);
    }
  } finally {
    await persist();
    changed();
  }
  return directory.uri;
}

export async function downloadSong(song: LibrarySong) {
  const directory = new Directory(Paths.document, "Parson", "Songs");
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(
    directory,
    songFilename(song.artist, song.name, song.id, song.path),
  );
  const saved = await File.downloadFileAsync(streamUrl(song.id), destination, {
    headers: await freshAuthorizationHeaders(),
    idempotent: true,
  });
  await rememberDownload(song, saved.uri);
  return saved;
}
