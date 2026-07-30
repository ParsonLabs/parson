import { afterEach, expect, mock, test } from "bun:test";

import { configureApiRuntime } from "../core/http";
import { changeUsername } from "./users";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  configureApiRuntime(null);
});

test("native username changes request a renewed bearer token", async () => {
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3_600 }),
  );
  configureApiRuntime({
    getAccessToken: () => `header.${payload}.signature`,
    getServerUrl: () => "https://music.test",
  });
  globalThis.fetch = mock(async (_input, init) => {
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(
      `Bearer header.${payload}.signature`,
    );
    expect(headers.get("x-parson-client")).toBe("native");
    expect(JSON.parse(String(init?.body))).toEqual({
      current_password: "synthetic-current-password",
      username: "new-handle",
    });
    return Response.json({
      status: true,
      access_token: "renewed-access-token",
      claims: { sub: "7", username: "new-handle" },
    });
  }) as typeof fetch;

  const response = await changeUsername(
    "new-handle",
    "synthetic-current-password",
    { native: true },
  );

  expect(response.access_token).toBe("renewed-access-token");
  expect(response.claims?.username).toBe("new-handle");
});
