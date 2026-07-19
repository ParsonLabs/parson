"use client";

type DesktopPlatform = "windows" | "linux";

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
    };
  }
}

const electronInvoke = <T>(command: string, args?: Record<string, unknown>) =>
  window.__PARSON_ELECTRON__?.invoke<T>(command, args) ?? null;

export function hasDesktopBridge(): boolean {
  return (
    typeof window !== "undefined" && Boolean(window.__PARSON_ELECTRON__?.invoke)
  );
}

export function electronWindowControls() {
  if (typeof window === "undefined") return null;
  return window.__PARSON_ELECTRON__?.windowControls ?? null;
}

export async function desktopPlatform(): Promise<DesktopPlatform | null> {
  if (typeof window === "undefined") return null;
  return electronInvoke<DesktopPlatform>("platform");
}

export async function selectMusicFolder(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  return electronInvoke<string | null>("select_music_folder");
}

export async function showTrackInFileManager(path: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  return (
    (await electronInvoke<boolean>("show_track_in_file_manager", { path })) ??
    false
  );
}
