const truncateUtf8 = (value: string, maximumBytes: number) => {
  const encoder = new TextEncoder();
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const characterBytes = encoder.encode(character).length;
    if (bytes + characterBytes > maximumBytes) break;
    bytes += characterBytes;
    result += character;
  }
  return result;
};

export const safePathComponent = (value: string) =>
  truncateUtf8(value.replace(/[\\/:*?"<>|]/g, "_").trim(), 72) || "Music";

export const safeIdentifier = (value: string) =>
  value.replace(/[^a-z0-9_-]/gi, "_").slice(0, 40) || "unknown";

export const mediaExtension = (path: string) =>
  path
    .split(".")
    .pop()
    ?.toLowerCase()
    .match(/^[a-z0-9]{2,5}$/)?.[0] ?? "mp3";

export const albumDirectoryName = (
  name: string,
  artist: string | undefined,
  albumId: string,
) =>
  `${artist ? `${safePathComponent(artist)} - ` : ""}${safePathComponent(
    name,
  )} [${safeIdentifier(albumId)}]`;

export const albumTrackFilename = (
  index: number,
  name: string,
  songId: string,
  path: string,
) =>
  `${String(index + 1).padStart(2, "0")} ${safePathComponent(
    name,
  )} [${safeIdentifier(songId)}].${mediaExtension(path)}`;

export const songFilename = (
  artist: string,
  name: string,
  songId: string,
  path: string,
) =>
  `${safePathComponent(artist)} - ${safePathComponent(name)} [${safeIdentifier(
    songId,
  )}].${mediaExtension(path)}`;
