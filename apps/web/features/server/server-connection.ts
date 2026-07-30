export const OFFICIAL_PARSON_PORT = 1993;

export function normalizeServerOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password || !url.hostname) return "";
    if (url.protocol === "http:" && !url.port) {
      url.port = String(OFFICIAL_PARSON_PORT);
    }
    return url.origin;
  } catch {
    return "";
  }
}

export function serverConnectionTarget(origin: string, libraryName?: string) {
  const normalized = normalizeServerOrigin(origin);
  if (!normalized) return "";
  const destination = libraryName
    ? `/login?library=${encodeURIComponent(libraryName)}`
    : "/";
  return `${normalized}${destination}`;
}

export function connectToServer(origin: string, libraryName?: string) {
  const target = serverConnectionTarget(origin, libraryName);
  if (!target || typeof window === "undefined") return false;
  if (window.__PARSON_ELECTRON__) {
    // The desktop preload is intentionally restricted to its bundled backend.
    // Open another library in the default browser instead of granting remote
    // web content access to native desktop commands.
    window.open(target, "_blank", "noopener,noreferrer");
  } else {
    // Navigating to the server keeps browser authentication same-origin, so
    // access and refresh credentials can remain in HttpOnly cookies.
    window.location.assign(target);
  }
  return true;
}
