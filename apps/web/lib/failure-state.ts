export type FailureKind =
  | "library_folder_unavailable"
  | "library_index_failed"
  | "no_playable_music"
  | "database_migration_failed"
  | "backup_failed"
  | "host_unavailable"
  | "android_cannot_connect"
  | "lyrics_provider_unavailable"
  | "playback_format_unsupported"
  | "update_failed"
  | "webview_failed";

export type FailureCopy = {
  title: string;
  body: string;
  action: string;
};

export const failureCopy: Record<FailureKind, FailureCopy> = {
  library_folder_unavailable: {
    title: "Music folder unavailable",
    body: "Parson can’t open the folder used by this library. Reconnect the drive or choose the folder’s new location.",
    action: "Choose music folder",
  },
  library_index_failed: {
    title: "Library scan failed",
    body: "Parson couldn’t finish scanning this folder. Your existing library was not changed. Check the details, then try again.",
    action: "Review library settings",
  },
  no_playable_music: {
    title: "No playable music found",
    body: "This folder doesn’t contain audio that Parson can play. Choose a folder with supported music files.",
    action: "Choose another folder",
  },
  database_migration_failed: {
    title: "Database update failed",
    body: "Parson couldn’t update its library database. Your music files were not changed. Open the logs before trying again.",
    action: "Open logs",
  },
  backup_failed: {
    title: "Backup failed",
    body: "Parson couldn’t create a safe backup. Check that the data drive is connected and has free space, then try again.",
    action: "Try backup again",
  },
  host_unavailable: {
    title: "Parson host unavailable",
    body: "The device that serves this library can’t be reached. Make sure it is on, Parson is running, and both devices are on the same network.",
    action: "Try again",
  },
  android_cannot_connect: {
    title: "Android can’t connect",
    body: "Make sure the Parson host is running and this phone is on the same Wi‑Fi network. Then check the address and try again.",
    action: "Try again",
  },
  lyrics_provider_unavailable: {
    title: "Lyrics are temporarily unavailable",
    body: "Please try again in a moment.",
    action: "Try again",
  },
  playback_format_unsupported: {
    title: "This audio format isn’t supported",
    body: "This device can’t decode this track. Try another track or convert the file to a supported audio format.",
    action: "Dismiss",
  },
  update_failed: {
    title: "Update failed",
    body: "Parson couldn’t download or install the update. The current version is still installed and your library was not changed.",
    action: "Close",
  },
  webview_failed: {
    title: "Parson’s window could not load",
    body: "The app window failed to load the local Parson interface. Restart the app; if it happens again, open the logs.",
    action: "Try again",
  },
};

export function libraryFailureKind(message?: string | null): FailureKind {
  const normalized = message?.toLowerCase() ?? "";
  if (
    normalized.includes("no supported audio") ||
    normalized.includes("no playable") ||
    normalized.includes("contains no audio")
  ) {
    return "no_playable_music";
  }
  if (
    normalized.includes("permission") ||
    normalized.includes("not found") ||
    normalized.includes("no such file") ||
    normalized.includes("folder") ||
    normalized.includes("directory") ||
    normalized.includes("path") ||
    normalized.includes("drive")
  ) {
    return "library_folder_unavailable";
  }
  return "library_index_failed";
}

export function isUnsupportedPlaybackError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotSupportedError")
    return true;
  if (
    typeof MediaError !== "undefined" &&
    error instanceof MediaError &&
    error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
  )
    return true;
  return false;
}
