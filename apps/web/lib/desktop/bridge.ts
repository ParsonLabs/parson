"use client";

type DesktopPlatform = "linux" | "macos" | "windows";
export type DesktopUpdateState = {
  status:
    | "manual"
    | "idle"
    | "checking"
    | "current"
    | "downloading"
    | "ready"
    | "error";
  version: string;
  availableVersion?: string;
  percent?: number;
  message: string;
  releaseUrl: string;
};

declare global {
  interface Window {
    __PARSON_ELECTRON__?: {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
      windowControls: {
        close(): Promise<boolean>;
        isMaximized(): Promise<boolean>;
        minimize(): Promise<boolean>;
        toggleMaximize(): Promise<boolean>;
        watchMaximized(callback: (maximized: boolean) => void): void;
      };
      watchPowerResume(callback: () => void): () => void;
      watchUpdates(callback: (state: DesktopUpdateState) => void): () => void;
    };
  }
}

export function watchDesktopUpdates(
  callback: (state: DesktopUpdateState) => void,
) {
  return window.__PARSON_ELECTRON__?.watchUpdates?.(callback) ?? (() => {});
}

export async function desktopUpdates(action: "state" | "check" | "install") {
  return electronInvoke<DesktopUpdateState>(`updates_${action}`);
}

const electronInvoke = <T>(command: string, args?: Record<string, unknown>) =>
  window.__PARSON_ELECTRON__?.invoke<T>(command, args) ?? null;

export function hasDesktopBridge(): boolean {
  return (
    typeof window !== "undefined" && Boolean(window.__PARSON_ELECTRON__?.invoke)
  );
}

export function electronWindowControls() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.__PARSON_ELECTRON__?.windowControls ?? null;
}

export function watchDesktopPowerResume(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }
  return window.__PARSON_ELECTRON__?.watchPowerResume(callback) ?? (() => {});
}

export async function desktopPlatform(): Promise<DesktopPlatform | null> {
  if (typeof window === "undefined") {
    return null;
  }
  return electronInvoke<DesktopPlatform>("platform");
}

export async function selectMusicFolder(): Promise<string | null> {
  if (typeof window === "undefined") {
    return null;
  }
  return electronInvoke<string | null>("select_music_folder");
}

export async function showTrackInFileManager(path: string): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    (await electronInvoke<boolean>("show_track_in_file_manager", { path })) ??
    false
  );
}
