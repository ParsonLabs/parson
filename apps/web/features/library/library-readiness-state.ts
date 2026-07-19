import type { LibraryReadiness } from "@parson/music-sdk";

export const LIBRARY_READINESS_POLL_MS = 2_000;

export function libraryReadinessShouldRefetch(readiness?: LibraryReadiness) {
  return readiness?.enrichment !== "complete";
}

export function libraryReadinessPollInterval(readiness?: LibraryReadiness) {
  return libraryReadinessShouldRefetch(readiness)
    ? LIBRARY_READINESS_POLL_MS
    : false;
}
