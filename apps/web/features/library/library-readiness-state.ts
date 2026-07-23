import type { LibraryReadiness } from "@parson/music-sdk";
import type { QueryClient } from "@tanstack/react-query";

export const LIBRARY_READINESS_POLL_MS = 2_000;
export const LIBRARY_IDLE_READINESS_POLL_MS = 15_000;

const CATALOG_QUERY_ROOTS = new Set([
  "albums",
  "artists",
  "cast-song",
  "favorite-song-details",
  "history",
  "home",
  "library",
  "playlist",
  "playlists",
  "search",
]);

export function catalogRevisionAffectsQuery(queryKey: readonly unknown[]) {
  return (
    typeof queryKey[0] === "string" &&
    CATALOG_QUERY_ROOTS.has(queryKey[0]) &&
    !(queryKey[0] === "library" && queryKey[1] === "readiness")
  );
}

export function invalidateCatalogRevisionQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => catalogRevisionAffectsQuery(query.queryKey),
  });
}

export function libraryReadinessShouldRefetch(_readiness?: LibraryReadiness) {
  return true;
}

export function libraryReadinessPollInterval(readiness?: LibraryReadiness) {
  return readiness?.enrichment === "complete"
    ? LIBRARY_IDLE_READINESS_POLL_MS
    : LIBRARY_READINESS_POLL_MS;
}

export function homeFeedShouldShowSkeleton(
  setupPending: boolean,
  feedPending: boolean,
  unavailableState?: LibraryReadiness["state"],
) {
  return setupPending || feedPending || unavailableState === "indexing";
}
