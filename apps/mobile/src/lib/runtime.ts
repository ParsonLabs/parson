import {
  configureApiRuntime,
  getFreshAuthorizationHeaders,
  refreshToken as refreshTokenRequest,
} from "@parson/music-sdk";

type RuntimeSnapshot = {
  origin: string | null;
  refreshToken: string | null;
  refreshTokenChanged: ((token: string) => void) | null;
  token: string | null;
  unauthorized: (() => void) | null;
  tokenChanged: ((token: string) => void) | null;
};

const runtime: RuntimeSnapshot = {
  origin: null,
  refreshToken: null,
  refreshTokenChanged: null,
  token: null,
  unauthorized: null,
  tokenChanged: null,
};
let sessionGeneration = 0;

configureApiRuntime({
  getAccessToken: () => runtime.token,
  getServerUrl: () => runtime.origin,
  refreshAccessToken: async () => {
    if (!runtime.refreshToken) return null;
    const expectedGeneration = sessionGeneration;
    const expectedRefreshToken = runtime.refreshToken;
    const response = await refreshTokenRequest({
      native: true,
      refreshToken: expectedRefreshToken,
    });
    if (
      sessionGeneration !== expectedGeneration ||
      runtime.refreshToken !== expectedRefreshToken
    )
      return null;
    if (!response.status || !response.access_token) {
      if (!response.transient) runtime.unauthorized?.();
      return null;
    }
    if (response.refresh_token) {
      runtime.refreshToken = response.refresh_token;
      runtime.refreshTokenChanged?.(response.refresh_token);
    }
    return response.access_token;
  },
  onAccessToken: (token) => {
    runtime.token = token;
    runtime.tokenChanged?.(token);
  },
  onUnauthorized: () => runtime.unauthorized?.(),
});

export function configureNativeRuntime(next: Partial<RuntimeSnapshot>) {
  if (
    ("origin" in next && next.origin !== runtime.origin) ||
    ("refreshToken" in next && next.refreshToken !== runtime.refreshToken)
  ) {
    sessionGeneration += 1;
  }
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

export async function freshAuthorizationHeaders() {
  const expectedGeneration = sessionGeneration;
  const headers = await getFreshAuthorizationHeaders();
  return sessionGeneration === expectedGeneration ? headers : {};
}
