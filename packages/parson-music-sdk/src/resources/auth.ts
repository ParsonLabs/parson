import api, { isApiError } from "../core/http";
import { deleteCookie, getCookie, setCookie } from "cookies-next";

const ACCESS_TOKEN_COOKIE = "plm_accessToken";
const REFRESH_TOKEN_COOKIE = "plm_refreshToken";

function usesRemoteBrowserServer(): boolean {
  try {
    const configured = globalThis.localStorage?.getItem("server_url");
    const current = globalThis.location?.origin;
    return Boolean(
      configured && current && new URL(configured).origin !== current,
    );
  } catch {
    return false;
  }
}

function persistRemoteBrowserTokens(response: AuthResponse): void {
  if (!usesRemoteBrowserServer() || !response.status) return;
  const secure = globalThis.location?.protocol === "https:";
  if (response.access_token) {
    setCookie(ACCESS_TOKEN_COOKIE, response.access_token, {
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
      secure,
    });
  }
  if (response.refresh_token) {
    setCookie(REFRESH_TOKEN_COOKIE, response.refresh_token, {
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
      secure,
    });
  }
}

export interface AuthCredentials {
  username: string;
  password: string;
  role?: string;
}

export interface AuthResponse {
  status: boolean;
  access_token?: string;
  refresh_token?: string;
  claims?: SessionResponse["claims"];
  message?: string;
  transient?: boolean;
  requestId?: string;
}

export interface AuthRequestOptions {
  native?: boolean;
  refreshToken?: string;
}

const authRequestHeaders = (
  options?: AuthRequestOptions,
): Record<string, string> | undefined => {
  const headers: Record<string, string> = {};
  if (options?.native) headers["X-Parson-Client"] = "native";
  if (options?.refreshToken)
    headers.Authorization = `Bearer ${options.refreshToken}`;
  return Object.keys(headers).length ? headers : undefined;
};

export interface SessionResponse {
  status: boolean;
  claims?: {
    sub: string;
    exp: number;
    username: string;
    bitrate: number;
    token_type: string;
    role: string;
  };
  message?: string;
  transient?: boolean;
  requestId?: string;
}

export interface MediaTokenResponse {
  status: boolean;
  media_token?: string;
  expires_at?: number;
}

let mediaToken: string | null = null;
let mediaTokenExpiresAt = 0;

export function getMediaToken(): string | null {
  if (
    !mediaToken ||
    mediaTokenExpiresAt <= Math.floor(Date.now() / 1000) + 60
  ) {
    mediaToken = null;
    mediaTokenExpiresAt = 0;
    return null;
  }
  return mediaToken;
}

export async function refreshMediaToken(): Promise<MediaTokenResponse> {
  const response = await api.post<MediaTokenResponse>("/media/stream-token");
  const value = response.data;
  if (
    value.status &&
    value.media_token &&
    typeof value.expires_at === "number" &&
    Number.isFinite(value.expires_at)
  ) {
    mediaToken = value.media_token;
    mediaTokenExpiresAt = value.expires_at;
  } else {
    mediaToken = null;
    mediaTokenExpiresAt = 0;
  }
  return value;
}

export function clearMediaToken(): void {
  mediaToken = null;
  mediaTokenExpiresAt = 0;
}

function failure(error: unknown, message: string): AuthResponse {
  const data = isApiError(error) ? error.response?.data : undefined;
  const reference =
    isApiError(error) && error.requestId
      ? ` Reference: ${error.requestId}`
      : "";
  return {
    status: false,
    message:
      typeof data === "object" && data && "message" in data
        ? `${String(data.message)}${reference}`
        : `${message}${reference}`,
    transient:
      !isApiError(error) ||
      !error.response ||
      error.response.status >= 500 ||
      error.response.status === 408 ||
      error.response.status === 429,
    requestId: isApiError(error) ? error.requestId : undefined,
  };
}

export async function register(
  credentials: AuthCredentials,
): Promise<AuthResponse> {
  try {
    return (await api.post<AuthResponse>("/auth/register", credentials)).data;
  } catch (error) {
    return failure(error, "Account creation failed");
  }
}

export async function login(
  credentials: AuthCredentials,
  options?: AuthRequestOptions,
): Promise<AuthResponse> {
  try {
    const remoteBrowser = usesRemoteBrowserServer();
    const response = (
      await api.post<AuthResponse>("/auth/login", credentials, {
        headers: authRequestHeaders(
          remoteBrowser ? { ...options, native: true } : options,
        ),
      })
    ).data;
    persistRemoteBrowserTokens(response);
    return response;
  } catch (error) {
    return failure(error, "Sign in failed");
  }
}

export async function isValid(): Promise<SessionResponse> {
  try {
    return (await api.get<SessionResponse>("/auth/session")).data;
  } catch (error) {
    return failure(error, "Session validation failed");
  }
}

export async function refreshToken(
  options?: AuthRequestOptions,
): Promise<AuthResponse> {
  try {
    const remoteBrowser = usesRemoteBrowserServer();
    const response = (
      await api.post<AuthResponse>("/auth/refresh", undefined, {
        headers: authRequestHeaders(
          remoteBrowser
            ? {
                ...options,
                native: true,
                refreshToken:
                  options?.refreshToken ||
                  String(getCookie(REFRESH_TOKEN_COOKIE) || ""),
              }
            : options,
        ),
      })
    ).data;
    persistRemoteBrowserTokens(response);
    return response;
  } catch (error) {
    return failure(error, "Session refresh failed");
  }
}

export async function logout(): Promise<void> {
  try {
    await api.post("/auth/logout");
  } finally {
    clearMediaToken();
    deleteCookie(ACCESS_TOKEN_COOKIE, { path: "/" });
    deleteCookie(REFRESH_TOKEN_COOKIE, { path: "/" });
  }
}
