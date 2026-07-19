import { expect, test } from "bun:test";
import {
  libraryReadinessPollInterval,
  libraryReadinessShouldRefetch,
} from "./library-readiness-state";

test("library readiness polling stops permanently after enrichment completes", () => {
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
  ).toBe(false);
});

test("library readiness disables every automatic refetch after completion", () => {
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
  expect(libraryReadinessShouldRefetch(complete)).toBe(false);
});
