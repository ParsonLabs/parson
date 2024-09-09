declare global {
  interface Window {
    __TAURI__?: {
      promisified?: any;
    };
  }
}

export default function isTauri(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
    window != undefined &&
    window.__TAURI__ != null &&
    window.__TAURI__.promisified != null
  );
}