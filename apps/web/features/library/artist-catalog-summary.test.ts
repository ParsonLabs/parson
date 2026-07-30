import { describe, expect, test } from "bun:test";
import { artistCatalogSummary } from "./artist-catalog-summary";

describe("artist catalog summaries", () => {
  test("shows appearance count instead of two zero counts", () => {
    expect(
      artistCatalogSummary({
        albumCount: 0,
        appearanceCount: 3,
        songCount: 0,
      }),
    ).toBe("Appears on 3 songs");
    expect(
      artistCatalogSummary({
        albumCount: 0,
        appearanceCount: 1,
        songCount: 0,
      }),
    ).toBe("Appears on 1 song");
  });

  test("hides the summary for an artist with no library relationships", () => {
    expect(
      artistCatalogSummary({
        albumCount: 0,
        appearanceCount: 0,
        songCount: 0,
      }),
    ).toBeNull();
  });

  test("keeps normal album and song counts for primary artists", () => {
    expect(
      artistCatalogSummary({
        albumCount: 1,
        appearanceCount: 2,
        songCount: 12,
      }),
    ).toBe("1 album · 12 songs");
  });
});
