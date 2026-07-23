import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  LIBRARY_IDLE_READINESS_POLL_MS,
  catalogRevisionAffectsQuery,
  homeFeedShouldShowSkeleton,
  invalidateCatalogRevisionQueries,
  libraryReadinessPollInterval,
  libraryReadinessShouldRefetch,
} from "./library-readiness-state";

test("library readiness polls quickly during indexing and keeps watching afterward", () => {
  expect(libraryReadinessPollInterval()).toBe(2_000);
  expect(
    libraryReadinessPollInterval({
      state: "ready",
      message: null,
      enrichment: "running",
      catalog_revision: 4,
      setup_required: false,
    }),
  ).toBe(2_000);
  expect(
    libraryReadinessPollInterval({
      state: "ready",
      message: null,
      enrichment: "complete",
      catalog_revision: 5,
      setup_required: false,
    }),
  ).toBe(LIBRARY_IDLE_READINESS_POLL_MS);
});

test("library readiness checks again on mount, reconnect, and focus", () => {
  const complete = {
    state: "ready" as const,
    message: null,
    enrichment: "complete" as const,
    catalog_revision: 5,
    setup_required: false,
  };

  expect(libraryReadinessShouldRefetch()).toBe(true);
  expect(
    libraryReadinessShouldRefetch({
      ...complete,
      enrichment: "running",
    }),
  ).toBe(true);
  expect(libraryReadinessShouldRefetch(complete)).toBe(true);
});

test("home keeps skeletons visible throughout first-library indexing", () => {
  expect(homeFeedShouldShowSkeleton(true, false)).toBe(true);
  expect(homeFeedShouldShowSkeleton(false, true)).toBe(true);
  expect(homeFeedShouldShowSkeleton(false, false, "indexing")).toBe(true);
  expect(homeFeedShouldShowSkeleton(false, false, "ready")).toBe(false);
  expect(homeFeedShouldShowSkeleton(false, false, "failed")).toBe(false);
});

test("catalog revisions invalidate every catalog-derived query but not readiness", () => {
  for (const key of [
    ["library", "feed"],
    ["library", "catalog", "albums"],
    ["search", "new song"],
    ["albums", "album-id"],
    ["artists", "artist-id"],
    ["home"],
    ["playlist", "playlist-id"],
    ["playlists"],
    ["favorite-song-details"],
    ["history"],
    ["cast-song", "song-id"],
  ]) {
    expect(catalogRevisionAffectsQuery(key)).toBe(true);
  }

  expect(catalogRevisionAffectsQuery(["library", "readiness"])).toBe(false);
  expect(catalogRevisionAffectsQuery(["setup-status"])).toBe(false);
});

test("a catalog revision makes cached search and library data stale", async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["search", "new song"], []);
  queryClient.setQueryData(["library", "feed"], { albums: [] });
  queryClient.setQueryData(["library", "readiness"], { catalog_revision: 2 });

  await invalidateCatalogRevisionQueries(queryClient);

  expect(queryClient.getQueryState(["search", "new song"])?.isInvalidated).toBe(
    true,
  );
  expect(queryClient.getQueryState(["library", "feed"])?.isInvalidated).toBe(
    true,
  );
  expect(
    queryClient.getQueryState(["library", "readiness"])?.isInvalidated,
  ).toBe(false);
});
