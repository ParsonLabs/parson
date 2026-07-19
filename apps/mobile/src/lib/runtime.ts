import { configureApiRuntime } from "@parson/music-sdk";

type RuntimeSnapshot = {
  origin: string | null;
  token: string | null;
  unauthorized: (() => void) | null;
  tokenChanged: ((token: string) => void) | null;
};

const runtime: RuntimeSnapshot = {
  origin: null,
  token: null,
  unauthorized: null,
  tokenChanged: null,
};

configureApiRuntime({
  getAccessToken: () => runtime.token,
  getServerUrl: () => runtime.origin,
  onAccessToken: (token) => {
    runtime.token = token;
    runtime.tokenChanged?.(token);
  },
  onUnauthorized: () => runtime.unauthorized?.(),
});

export function configureNativeRuntime(next: Partial<RuntimeSnapshot>) {
  Object.assign(runtime, next);
}

export function normalizeOrigin(value: string) {
  const candidate = value.trim().replace(/\/+$/, "");
  const withScheme = /^https?:\/\//i.test(candidate)
    ? candidate
    : `http://${candidate}`;
  const parsed = new URL(withScheme);
  return parsed.origin;
}

export function apiUrl(path: string) {
  if (!runtime.origin) throw new Error("No Parson library is connected.");
  return `${runtime.origin}/api/v1/${path.replace(/^\/+/, "")}`;
}

export function authenticatedUrl(path: string) {
  return apiUrl(path);
}

export function imageUrl(path?: string | null) {
  const image = path?.trim();
  const normalized = image?.toLowerCase() ?? "";
  if (
    !runtime.origin ||
    !image ||
    normalized === "snf.png" ||
    normalized.endsWith("/snf.png") ||
    normalized.includes("snf.png?")
  )
    return null;
  if (/^https?:\/\//i.test(image)) return image;
  return `${runtime.origin}/media/images/${encodeURIComponent(image)}`;
}

export function streamUrl(songId: string, bitrate = 0) {
  const url = new URL(
    apiUrl(`media/songs/${encodeURIComponent(songId)}/stream`),
  );
  url.searchParams.set("bitrate", String(bitrate));
  return url.toString();
}

export function authorizationHeaders(): Record<string, string> {
  return runtime.token ? { Authorization: `Bearer ${runtime.token}` } : {};
}
