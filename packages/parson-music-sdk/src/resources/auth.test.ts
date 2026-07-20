import { afterEach, expect, mock, test } from "bun:test";

import { configureApiRuntime } from "../core/http";
import { login, refreshToken } from "./auth";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  configureApiRuntime(null);
});

test("native login requests rotating refresh credentials", async () => {
  configureApiRuntime({ getServerUrl: () => "https://music.test" });
  globalThis.fetch = mock(async (_input, init) => {
    const headers = new Headers(init?.headers);
    expect(headers.get("x-parson-client")).toBe("native");
    return Response.json({
      status: true,
      access_token: "access",
      refresh_token: "refresh",
    });
  }) as typeof fetch;

  const response = await login(
    { username: "test-user", password: "synthetic-test-password" },
    { native: true },
  );

  expect(response.refresh_token).toBe("refresh");
});

test("native refresh sends only the explicit refresh bearer", async () => {
  configureApiRuntime({
    getAccessToken: () => "stale-access-token",
    getServerUrl: () => "https://music.test",
  });
  globalThis.fetch = mock(async (_input, init) => {
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer stored-refresh-token");
    expect(headers.get("x-parson-client")).toBe("native");
    return Response.json({ status: true, access_token: "next-access-token" });
  }) as typeof fetch;

  const response = await refreshToken({
    native: true,
    refreshToken: "stored-refresh-token",
  });

  expect(response.access_token).toBe("next-access-token");
});
