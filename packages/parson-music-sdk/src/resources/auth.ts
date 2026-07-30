import api, { isApiError } from "../core/http";

export interface AuthCredentials {
  username: string;
  password: string;
  role?: string;
}

export function validPasswordLength(value: string): boolean {
  const characters = Array.from(value).length;
  return characters >= 8 && characters <= 256;
}

export function validUsername(value: string): boolean {
  const characters = Array.from(value);
  return (
    characters.length >= 1 &&
    characters.length <= 64 &&
    value.trim() === value &&
    characters.every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 0x1f && !(codePoint >= 0x7f && codePoint <= 0x9f);
    })
  );
}

export function isInsecureHttpOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:") return false;
    const hostname = url.hostname.toLowerCase();
    return !(
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.startsWith("127.")
    );
  } catch {
    return false;
  }
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
    session_id?: string;
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

export interface PairingStartResponse {
  pairingId: string;
  secret: string;
  code: string;
  expiresIn: number;
}

export interface PairingStatusResponse extends AuthResponse {
  pending?: boolean;
  expired?: boolean;
}

export interface PairingApprovalResponse {
  status: boolean;
  deviceName?: string;
  username?: string;
  message?: string;
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
    return (
      await api.post<AuthResponse>("/auth/login", credentials, {
        headers: authRequestHeaders(options),
      })
    ).data;
  } catch (error) {
    return failure(error, "Sign in failed");
  }
}

export async function startDevicePairing(
  deviceName: string,
): Promise<PairingStartResponse> {
  return (
    await api.post<PairingStartResponse>(
      "/auth/pairing/start",
      { device_name: deviceName },
      { skipAuth: true },
    )
  ).data;
}

export async function checkDevicePairing(
  pairingId: string,
  secret: string,
): Promise<PairingStatusResponse> {
  try {
    return (
      await api.post<PairingStatusResponse>(
        "/auth/pairing/status",
        { pairing_id: pairingId, secret },
        { skipAuth: true, timeout: 5_000 },
      )
    ).data;
  } catch (error) {
    const data = isApiError(error) ? error.response?.data : undefined;
    if (typeof data === "object" && data) return data as PairingStatusResponse;
    return failure(error, "Could not check pairing");
  }
}

export async function approveDevicePairing(
  code: string,
): Promise<PairingApprovalResponse> {
  try {
    return (
      await api.post<PairingApprovalResponse>("/auth/pairing/approve", {
        code,
      })
    ).data;
  } catch (error) {
    return failure(error, "Could not approve this device");
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
    return (
      await api.post<AuthResponse>("/auth/refresh", undefined, {
        headers: authRequestHeaders(options),
      })
    ).data;
  } catch (error) {
    return failure(error, "Session refresh failed");
  }
}

export async function logout(): Promise<void> {
  try {
    await api.post("/auth/logout");
  } finally {
    clearMediaToken();
  }
}
