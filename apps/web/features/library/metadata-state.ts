import type { LibraryMetadataPatch } from "@parson/music-sdk/types";

const sections = ["song", "album", "artist"] as const;

function equal(left: unknown, right: unknown) {
  return (
    Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right)
  );
}

export function changedMetadata(
  original: LibraryMetadataPatch,
  current: LibraryMetadataPatch,
): LibraryMetadataPatch {
  const changed: LibraryMetadataPatch = {};
  for (const section of sections) {
    const before = original[section] as Record<string, unknown> | undefined;
    const after = current[section] as Record<string, unknown> | undefined;
    if (!after) continue;
    const fields = Object.fromEntries(
      Object.entries(after).filter(
        ([field, value]) =>
          value !== undefined && !equal(value, before?.[field]),
      ),
    );
    if (Object.keys(fields).length)
      (changed as Record<string, unknown>)[section] = fields;
  }
  return changed;
}

export function hasMetadataChanges(patch: LibraryMetadataPatch) {
  return sections.some(
    (section) => patch[section] && Object.keys(patch[section]!).length > 0,
  );
}

export function validateMetadata(patch: LibraryMetadataPatch): string | null {
  for (const name of [
    patch.song?.name,
    patch.album?.name,
    patch.artist?.name,
  ]) {
    if (name !== undefined && !name.trim()) return "Names cannot be empty.";
  }
  if (patch.song?.path !== undefined && !patch.song.path.trim())
    return "File path cannot be empty.";

  const track = patch.song?.track_number;
  if (
    track !== undefined &&
    (!Number.isInteger(track) || track < 0 || track > 65_535)
  )
    return "Track number must be a whole number from 0 to 65535.";

  const duration = patch.song?.duration;
  if (duration !== undefined && (!Number.isFinite(duration) || duration < 0))
    return "Duration must be a non-negative number.";
  return null;
}
