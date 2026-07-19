export function normalizeBaseURL(url: string): string {
  const normalizedUrl = url.trim().replace(/\/+$/, "");

  try {
    const parsedUrl = new URL(normalizedUrl);
    if (parsedUrl.hostname === "localhost" && parsedUrl.port === "3000") {
      parsedUrl.port = "1993";
      return parsedUrl.toString().replace(/\/+$/, "");
    }
  } catch {
    return "";
  }

  return normalizedUrl;
}

export default function getBaseURL(): string {
  if (typeof window !== "undefined") {
    try {
      const serverConfig = globalThis.localStorage?.getItem("server_url");
      if (serverConfig) {
        const configured = normalizeBaseURL(serverConfig);
        if (configured) return configured;
      }
    } catch {}

    const url = new URL(window.location.href);
    if (url.hostname === "localhost" && url.port === "3000") {
      return normalizeBaseURL(`${url.protocol}//${url.hostname}:1993`);
    }

    return normalizeBaseURL(window.location.origin) || window.location.origin;
  }

  return "";
}
