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

export function connectToServer(origin: string, libraryName?: string) {
  const normalized = normalizeServerOrigin(origin);
  if (!normalized || typeof window === "undefined") return false;
  try {
    window.localStorage.setItem("server_url", normalized);
  } catch {
    return false;
  }
  const destination = libraryName
    ? `/login?library=${encodeURIComponent(libraryName)}`
    : "/";
  window.location.assign(destination);
  return true;
}
