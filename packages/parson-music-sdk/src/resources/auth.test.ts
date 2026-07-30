import { afterEach, expect, mock, test } from "bun:test";

import { configureApiRuntime } from "../core/http";
import {
  checkDevicePairing,
  login,
  refreshToken,
  startDevicePairing,
  validPasswordLength,
  validUsername,
} from "./auth";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  configureApiRuntime(null);
});

test("password limits count Unicode characters rather than UTF-16 bytes", () => {
  expect(validPasswordLength("🔐".repeat(8))).toBeTrue();
  expect(validPasswordLength("🔐".repeat(2))).toBeFalse();
  expect(validPasswordLength("x".repeat(257))).toBeFalse();
});

test("username limits match backend character and control rules", () => {
  expect(validUsername("synthetic-user")).toBeTrue();
  expect(validUsername("Δ".repeat(64))).toBeTrue();
  expect(validUsername(" synthetic-user")).toBeFalse();
  expect(validUsername("synthetic\nuser")).toBeFalse();
  expect(validUsername("x".repeat(65))).toBeFalse();
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

test("device pairing start and polling never send an existing account token", async () => {
  configureApiRuntime({
    getAccessToken: () => "existing-account-token",
    getServerUrl: () => "https://music.test",
  });
  const requests: string[] = [];
  globalThis.fetch = mock(async (input, init) => {
    requests.push(String(input));
    expect(new Headers(init?.headers).has("authorization")).toBeFalse();
    if (String(input).endsWith("/auth/pairing/start")) {
      return Response.json({
        pairingId: "pairing-id",
        secret: "poll-secret",
        code: "123456",
        expiresIn: 180,
      });
    }
    return Response.json({ status: false, pending: true }, { status: 202 });
  }) as typeof fetch;

  const pairing = await startDevicePairing("Pixel");
  const status = await checkDevicePairing(pairing.pairingId, pairing.secret);

  expect(pairing.code).toBe("123456");
  expect(status.pending).toBeTrue();
  expect(requests).toHaveLength(2);
});
