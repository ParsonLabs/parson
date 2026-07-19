import { deleteCookie, getCookie } from "cookies-next";
import { jwtDecode } from "jwt-decode";

const MAX_RETRY_ATTEMPTS = 1;
const TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const REFRESH_THRESHOLD_SECONDS = 30;

export interface ApiRuntimeAdapter {
  getAccessToken?: () => string | null;
  getServerUrl?: () => string | null;
  onAccessToken?: (token: string) => void;
  onUnauthorized?: () => void;
  refreshAccessToken?: () => Promise<string | null>;
}

let runtimeAdapter: ApiRuntimeAdapter | null = null;

/**
 * Supplies host-specific storage to the universal SDK. Browser callers keep
 * using cookies and localStorage by default; native clients can provide their
 * hydrated secure-storage values without browser shims.
 */
export const configureApiRuntime = (adapter: ApiRuntimeAdapter | null) => {
  runtimeAdapter = adapter;
};

export interface ApiRequestConfig extends Omit<RequestInit, "body"> {
  baseURL?: string;
  data?: unknown;
  params?: object;
  responseType?: "json" | "text" | "blob";
  timeout?: number;
  _retryCount?: number;
}

export interface ApiResponse<T = any> {
  data: T;
  status: number;
  headers: Headers;
}

export class ApiError<T = any> extends Error {
  response?: ApiResponse<T>;
  config: ApiRequestConfig;
  requestId?: string;

  constructor(
    message: string,
    config: ApiRequestConfig,
    response?: ApiResponse<T>,
  ) {
    super(message);
    this.name = "ApiError";
    this.config = config;
    this.response = response;
    this.requestId = response?.headers.get("x-request-id") ?? undefined;
  }
}

export const isApiError = (error: unknown): error is ApiError =>
  error instanceof ApiError;

export const normalizeApiBaseURL = (
  storedServerUrl: string | null,
  locationOrigin: string | undefined,
): string => {
  const fallback = locationOrigin || "http://localhost:1993";
  let url: URL;
  try {
    url = new URL(storedServerUrl?.trim() || fallback);
  } catch {
    try {
      url = new URL(fallback);
    } catch {
      url = new URL("http://localhost:1993");
    }
  }
  if (url.hostname === "localhost" && url.port === "3000") url.port = "1993";
  return `${url.origin}/api/v1`;
};

export const getApiBaseURL = (): string => {
  const runtimeServerUrl = runtimeAdapter?.getServerUrl?.() ?? null;
  let storedServerUrl: string | null = null;
  if (runtimeServerUrl) {
    storedServerUrl = runtimeServerUrl;
  } else {
    try {
      storedServerUrl = globalThis.localStorage?.getItem("server_url") ?? null;
    } catch {}
  }
  let origin: string | undefined;
  try {
    origin = globalThis.location?.origin;
  } catch {}
  return normalizeApiBaseURL(storedServerUrl, origin);
};

export const getAccessToken = (): string | null => {
  const runtimeToken = runtimeAdapter?.getAccessToken?.() ?? null;
  if (runtimeToken) return runtimeToken;
  try {
    const token = getCookie("plm_accessToken");
    return token ? String(token) : null;
  } catch {
    return null;
  }
};

const redirectToLogin = () => {
  if (runtimeAdapter?.onUnauthorized) {
    runtimeAdapter.onUnauthorized();
    return;
  }
  try {
    deleteCookie("plm_accessToken", { path: "/" });
  } catch {}
  try {
    if (typeof globalThis.location !== "undefined") {
      globalThis.location.href = "/login";
    }
  } catch {}
};

export const normalizeTimeout = (value?: number): number => {
  if (value === undefined || !Number.isFinite(value)) return TIMEOUT_MS;
  return Math.max(1, Math.min(MAX_TIMEOUT_MS, Math.trunc(value)));
};

export const composeAbortSignals = (
  signals: Array<AbortSignal | null | undefined>,
): { signal: AbortSignal; cleanup: () => void } => {
  const active = signals.filter((signal): signal is AbortSignal =>
    Boolean(signal),
  );
  if (active.length === 1) return { signal: active[0]!, cleanup: () => {} };

  const controller = new AbortController();
  const listeners: Array<[AbortSignal, () => void]> = [];
  for (const source of active) {
    if (source.aborted) {
      controller.abort(source.reason);
      break;
    }
    const abort = () => controller.abort(source.reason);
    source.addEventListener("abort", abort, { once: true });
    listeners.push([source, abort]);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const [source, listener] of listeners)
        source.removeEventListener("abort", listener);
    },
  };
};

const appendParams = (url: URL, params?: ApiRequestConfig["params"]) => {
  if (!params) return;

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
};

const resolveURL = (path: string, config: ApiRequestConfig): string => {
  if (/^https?:\/\//.test(path)) {
    const absoluteURL = new URL(path);
    appendParams(absoluteURL, config.params);
    return absoluteURL.toString();
  }

  const baseURL = config.baseURL ?? getApiBaseURL();
  const normalizedPath = path.replace(/^\/+/, "");
  const url = new URL(
    normalizedPath,
    baseURL.endsWith("/") ? baseURL : `${baseURL}/`,
  );
  appendParams(url, config.params);
  return url.toString();
};

export const getApiWebSocketURL = (path: string): string => {
  const url = new URL(resolveURL(path, {}));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

export const parseResponse = async <T>(
  response: Response,
  responseType: ApiRequestConfig["responseType"],
): Promise<T> => {
  if (responseType === "blob") {
    return response.blob() as Promise<T>;
  }

  if (responseType === "text") {
    return response.text() as Promise<T>;
  }

  if (response.status === 204) return undefined as T;

  // Preserve non-JSON HTTP errors.
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
};

const buildBodyAndHeaders = (
  config: ApiRequestConfig,
): { body?: BodyInit; headers: Headers } => {
  const headers = new Headers(config.headers);

  if (config.data === undefined) {
    return { headers };
  }

  if (typeof FormData !== "undefined" && config.data instanceof FormData) {
    headers.delete("Content-Type");
    return { body: config.data, headers };
  }

  if (
    typeof config.data === "string" ||
    (typeof Blob !== "undefined" && config.data instanceof Blob) ||
    (typeof URLSearchParams !== "undefined" &&
      config.data instanceof URLSearchParams)
  ) {
    return { body: config.data, headers };
  }

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return { body: JSON.stringify(config.data), headers };
};

export const tokenFromRefreshResponse = (
  response: Pick<Response, "ok">,
  data: { access_token?: string } | undefined,
): string | null =>
  response.ok && data?.access_token ? data.access_token : null;

const refreshAccessToken = async (): Promise<string | null> => {
  if (runtimeAdapter?.refreshAccessToken) {
    const token = await runtimeAdapter.refreshAccessToken();
    if (token) runtimeAdapter.onAccessToken?.(token);
    return token;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(resolveURL("/auth/refresh", {}), {
      method: "POST",
      credentials: "include",
      signal: controller.signal,
    });

    const data = await parseResponse<{
      access_token?: string;
      status?: boolean;
    }>(response, "json");

    const refreshedToken = tokenFromRefreshResponse(response, data);
    if (refreshedToken) {
      runtimeAdapter?.onAccessToken?.(refreshedToken);
      return refreshedToken;
    }

    if (response.status === 401 || response.status === 403) redirectToLogin();
    return null;
  } catch (error) {
    console.error("Token refresh failed:", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

let refreshPromise: Promise<string | null> | null = null;

const getFreshAccessToken = async (): Promise<string | null> => {
  refreshPromise ??= refreshAccessToken().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
};

export const isAuthLifecycleURL = (url: string): boolean => {
  try {
    return /(?:^|\/)auth(?:\/|$)/.test(
      new URL(url, "http://localhost").pathname,
    );
  } catch {
    return false;
  }
};

export const shouldAttemptAuthRefresh = (
  url: string,
  status: number,
  retryCount: number,
): boolean =>
  status === 401 && !isAuthLifecycleURL(url) && retryCount < MAX_RETRY_ATTEMPTS;

const addAuthHeader = async (url: string, headers: Headers) => {
  // Refreshing before authentication requests creates signed-out redirect loops.
  if (isAuthLifecycleURL(url)) return;

  const accessToken = getAccessToken();

  if (!accessToken) return;

  try {
    const decoded = jwtDecode<{ exp: number }>(accessToken.toString());
    const currentTime = Math.floor(Date.now() / 1000);

    if (decoded.exp && decoded.exp - currentTime < REFRESH_THRESHOLD_SECONDS) {
      const newToken = await getFreshAccessToken();
      headers.set("Authorization", `Bearer ${newToken ?? accessToken}`);
      return;
    }
  } catch (error) {
    console.error("Token validation failed:", error);
  }

  headers.set("Authorization", `Bearer ${accessToken}`);
};

const request = async <T = any>(
  path: string,
  config: ApiRequestConfig = {},
): Promise<ApiResponse<T>> => {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cleanupSignal = () => {};

  try {
    const url = resolveURL(path, config);
    const { body, headers } = buildBodyAndHeaders(config);
    await addAuthHeader(url, headers);
    timeout = setTimeout(() => {
      const reason =
        typeof DOMException === "undefined"
          ? Object.assign(new Error("Request timed out"), {
              name: "TimeoutError",
            })
          : new DOMException("Request timed out", "TimeoutError");
      controller.abort(reason);
    }, normalizeTimeout(config.timeout));
    const composed = composeAbortSignals([config.signal, controller.signal]);
    cleanupSignal = composed.cleanup;
    const {
      baseURL: _baseURL,
      data: _data,
      params: _params,
      responseType: _responseType,
      timeout: _timeout,
      _retryCount,
      ...requestInit
    } = config;
    const response = await fetch(url, {
      ...requestInit,
      body,
      headers,
      credentials: config.credentials ?? "include",
      signal: composed.signal,
    });
    const data = await parseResponse<T>(
      response,
      config.responseType ?? "json",
    );
    const apiResponse = {
      data,
      status: response.status,
      headers: response.headers,
    };

    if (response.ok) {
      return apiResponse;
    }

    if (
      shouldAttemptAuthRefresh(url, response.status, config._retryCount ?? 0)
    ) {
      const newToken = await getFreshAccessToken();
      if (newToken) {
        return request<T>(path, {
          ...config,
          headers: {
            ...Object.fromEntries(headers.entries()),
            Authorization: `Bearer ${newToken}`,
          },
          _retryCount: (config._retryCount ?? 0) + 1,
        });
      }
    }

    throw new ApiError(
      `Request failed with status ${response.status}`,
      config,
      apiResponse,
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      error instanceof Error ? error.message : "Request failed",
      config,
    );
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    cleanupSignal();
  }
};

const api = {
  request,
  get: <T = any>(url: string, config?: ApiRequestConfig) =>
    request<T>(url, { ...config, method: "GET" }),
  post: <T = any>(url: string, data?: unknown, config?: ApiRequestConfig) =>
    request<T>(url, { ...config, method: "POST", data }),
  put: <T = any>(url: string, data?: unknown, config?: ApiRequestConfig) =>
    request<T>(url, { ...config, method: "PUT", data }),
  patch: <T = any>(url: string, data?: unknown, config?: ApiRequestConfig) =>
    request<T>(url, { ...config, method: "PATCH", data }),
  delete: <T = any>(url: string, config?: ApiRequestConfig) =>
    request<T>(url, { ...config, method: "DELETE" }),
};

export default api;
