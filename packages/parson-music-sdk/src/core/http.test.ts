import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  ApiError,
  composeAbortSignals,
  configureApiRuntime,
  getFreshAuthorizationHeaders,
  isAuthLifecycleURL,
  normalizeApiBaseURL,
  normalizeTimeout,
  parseResponse,
  shouldAttemptAuthRefresh,
  tokenFromRefreshResponse,
} from "./http";
import api from "./http";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  configureApiRuntime(null);
});

describe("parseResponse", () => {
  test("preserves structured JSON errors", async () => {
    const response = new Response('{"code":"database_unavailable"}', {
      status: 503,
      headers: { "content-type": "application/json" },
    });

    expect(await parseResponse<{ code: string }>(response, "json")).toEqual({
      code: "database_unavailable",
    });
  });

  test("accepts an empty error response without losing the HTTP response", async () => {
    const response = new Response(null, { status: 502 });
    expect(await parseResponse(response, "json")).toBeUndefined();
  });

  test("preserves plain-text proxy errors", async () => {
    const response = new Response("upstream unavailable", { status: 502 });
    expect(await parseResponse(response, "json")).toBe("upstream unavailable");
  });
});

test("ApiError exposes the backend request reference", () => {
  const headers = new Headers({ "x-request-id": "request-42" });
  const error = new ApiError("failed", {}, { data: {}, status: 500, headers });
  expect(error.requestId).toBe("request-42");
});

test("refresh responses use the access_token field returned by the backend", () => {
  expect(
    tokenFromRefreshResponse(
      { ok: true },
      { access_token: "new-access-token" },
    ),
  ).toBe("new-access-token");
  expect(
    tokenFromRefreshResponse({ ok: false }, { access_token: "ignored" }),
  ).toBeNull();
});

test("protected 401 responses refresh without inspecting HttpOnly cookies", () => {
  expect(
    shouldAttemptAuthRefresh("https://music.test/api/v1/library", 401, 0),
  ).toBeTrue();
  expect(
    shouldAttemptAuthRefresh("https://music.test/api/v1/library", 401, 1),
  ).toBeFalse();
  expect(
    shouldAttemptAuthRefresh("https://music.test/api/v1/auth/login", 401, 0),
  ).toBeFalse();
});

test("auth routing uses the URL path rather than query-string contents", () => {
  expect(
    isAuthLifecycleURL("https://music.test/api/v1/auth/session"),
  ).toBeTrue();
  expect(
    isAuthLifecycleURL("https://music.test/api/v1/search?q=%2Fauth%2Fsession"),
  ).toBeFalse();
});

test("session validation sends the native runtime bearer token", async () => {
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 }),
  );
  configureApiRuntime({
    getAccessToken: () => `header.${payload}.signature`,
  });
  globalThis.fetch = mock(async (_input, init) => {
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer header.${payload}.signature`,
    );
    return Response.json({ status: true });
  }) as typeof fetch;

  await api.get("/auth/session", { baseURL: "https://music.test/api/v1" });
});

test("near-expiry native sessions rotate before the protected request", async () => {
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 5 }),
  );
  let persisted = "";
  configureApiRuntime({
    getAccessToken: () => `header.${payload}.signature`,
    refreshAccessToken: async () => "rotated-access-token",
    onAccessToken: (token) => {
      persisted = token;
    },
  });
  globalThis.fetch = mock(async (_input, init) => {
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer rotated-access-token",
    );
    return Response.json({ status: true });
  }) as typeof fetch;

  await api.get("/library", { baseURL: "https://music.test/api/v1" });
  expect(persisted).toBe("rotated-access-token");
});

test("direct native media requests share the access-token freshness gate", async () => {
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 5 }),
  );
  let refreshes = 0;
  configureApiRuntime({
    getAccessToken: () => `header.${payload}.signature`,
    refreshAccessToken: async () => {
      refreshes += 1;
      return "fresh-media-token";
    },
  });

  const [first, second] = await Promise.all([
    getFreshAuthorizationHeaders(),
    getFreshAuthorizationHeaders(),
  ]);
  expect(first).toEqual({ Authorization: "Bearer fresh-media-token" });
  expect(second).toEqual({ Authorization: "Bearer fresh-media-token" });
  expect(refreshes).toBe(1);
});

test("direct native media requests remain anonymous without a session", async () => {
  configureApiRuntime({ getAccessToken: () => null });
  expect(await getFreshAuthorizationHeaders()).toEqual({});
});

test("anonymous server preflights never leak the current bearer token", async () => {
  configureApiRuntime({ getAccessToken: () => "current-server-token" });
  globalThis.fetch = mock(async (_input, init) => {
    expect(new Headers(init?.headers).has("authorization")).toBeFalse();
    expect("skipAuth" in (init ?? {})).toBeFalse();
    return Response.json({ status: true });
  }) as typeof fetch;

  await api.get("/setup/status", {
    baseURL: "https://different-server.test/api/v1",
    skipAuth: true,
  });
});

test("invalid stored server URLs fall back to the current origin", () => {
  expect(normalizeApiBaseURL("not a URL", "https://music.test")).toBe(
    "https://music.test/api/v1",
  );
  expect(normalizeApiBaseURL(null, "http://localhost:3000")).toBe(
    "http://localhost:1993/api/v1",
  );
  expect(normalizeApiBaseURL("invalid", "also invalid")).toBe(
    "http://localhost:1993/api/v1",
  );
});

test("request timeouts are finite and bounded", () => {
  expect(normalizeTimeout(Number.NaN)).toBe(10_000);
  expect(normalizeTimeout(Number.POSITIVE_INFINITY)).toBe(10_000);
  expect(normalizeTimeout(-50)).toBe(1);
  expect(normalizeTimeout(60 * 60 * 1000)).toBe(30 * 60 * 1000);
});

test("abort signals compose without AbortSignal.any", () => {
  const caller = new AbortController();
  const timeout = new AbortController();
  const composed = composeAbortSignals([caller.signal, timeout.signal]);
  expect(composed.signal.aborted).toBeFalse();
  caller.abort(new Error("cancelled by caller"));
  expect(composed.signal.aborted).toBeTrue();
  expect(composed.signal.reason).toBe(caller.signal.reason);
  composed.cleanup();

  const alreadyAborted = new AbortController();
  alreadyAborted.abort("already stopped");
  const immediate = composeAbortSignals([
    alreadyAborted.signal,
    timeout.signal,
  ]);
  expect(immediate.signal.aborted).toBeTrue();
  immediate.cleanup();
});

test("request construction failures retain the ApiError contract", async () => {
  await expect(
    api.get("/library", { baseURL: "not a valid URL" }),
  ).rejects.toBeInstanceOf(ApiError);
});

test("requests serialize query parameters and JSON bodies without leaking client config", async () => {
  const fetchMock = mock(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://music.test/api/v1/search?q=a+b&limit=5",
      );
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("include");
      expect(new Headers(init?.headers).get("content-type")).toBe(
        "application/json",
      );
      expect(init?.body).toBe(JSON.stringify({ hello: "world" }));
      expect(init).not.toHaveProperty("baseURL");
      expect(init).not.toHaveProperty("params");
      expect(init).not.toHaveProperty("timeout");
      return Response.json({ ok: true });
    },
  );
  globalThis.fetch = fetchMock as typeof fetch;

  const response = await api.post(
    "/search",
    { hello: "world" },
    { baseURL: "https://music.test/api/v1", params: { q: "a b", limit: 5 } },
  );
  expect(response.data).toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("HTTP failures preserve status, parsed body, and request reference", async () => {
  globalThis.fetch = mock(async () =>
    Response.json(
      { code: "library_indexing", message: "Try again" },
      { status: 503, headers: { "x-request-id": "req-503" } },
    ),
  ) as typeof fetch;

  try {
    await api.get("/library", { baseURL: "https://music.test/api/v1" });
    throw new Error("expected request failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError<{ code: string }>;
    expect(apiError.response?.status).toBe(503);
    expect(apiError.response?.data.code).toBe("library_indexing");
    expect(apiError.requestId).toBe("req-503");
  }
});

test("caller cancellation is normalized to ApiError and reaches fetch", async () => {
  let observedSignal: AbortSignal | undefined;
  globalThis.fetch = mock(async (_input, init) => {
    observedSignal = init?.signal ?? undefined;
    if (observedSignal?.aborted) throw observedSignal.reason;
    return await new Promise<Response>((_resolve, reject) => {
      observedSignal?.addEventListener(
        "abort",
        () => reject(observedSignal?.reason),
        { once: true },
      );
    });
  }) as typeof fetch;
  const controller = new AbortController();
  const pending = api.get("/slow", {
    baseURL: "https://music.test/api/v1",
    signal: controller.signal,
  });
  controller.abort(new Error("caller cancelled"));
  await expect(pending).rejects.toBeInstanceOf(ApiError);
  expect(observedSignal?.aborted).toBeTrue();
});
