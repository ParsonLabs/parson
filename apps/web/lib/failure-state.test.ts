import { describe, expect, test } from "bun:test";
import {
  failureCopy,
  libraryFailureKind,
  type FailureKind,
} from "./failure-state";

describe("failure copy", () => {
  test("every common failure has actionable, non-technical copy", () => {
    const failures: FailureKind[] = [
      "library_folder_unavailable",
      "no_playable_music",
      "database_migration_failed",
      "backup_failed",
      "host_unavailable",
      "android_cannot_connect",
      "lyrics_provider_unavailable",
      "playback_format_unsupported",
      "update_failed",
      "webview_failed",
    ];

    for (const failure of failures) {
      expect(failureCopy[failure].title.length).toBeGreaterThan(3);
      expect(failureCopy[failure].body.length).toBeGreaterThan(20);
      expect(failureCopy[failure].action.length).toBeGreaterThan(2);
    }
  });

  test("distinguishes an empty folder from an unavailable folder", () => {
    expect(
      libraryFailureKind(
        "The selected folder contains no supported audio files.",
      ),
    ).toBe("no_playable_music");
    expect(libraryFailureKind("Permission denied opening /media/music")).toBe(
      "library_folder_unavailable",
    );
    expect(libraryFailureKind("Metadata worker stopped unexpectedly")).toBe(
      "library_index_failed",
    );
  });
});
