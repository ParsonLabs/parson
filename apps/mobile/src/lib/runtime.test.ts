import { afterEach, expect, mock, test } from "bun:test";

import {
  applyImageSignature,
  embeddedWebClientTarget,
  configureNativeRuntime,
  freshAuthorizationHeaders,
  imageRequestHeaders,
  normalizeOrigin,
} from "./runtime";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  configureNativeRuntime({
    origin: null,
    refreshToken: null,
    refreshTokenChanged: null,
    token: null,
    tokenChanged: null,
    unauthorized: null,
  });
});

const token = (expiresInSeconds: number, name: string) => {
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds }),
  );
  return `${name}.${payload}.signature`;
};

test("plain local addresses use the Parson port", () => {
  expect(normalizeOrigin("192.168.1.10")).toBe("http://192.168.1.10:1993");
  expect(normalizeOrigin("http://music.local:8123/path")).toBe(
    "http://music.local:8123",
  );
  expect(normalizeOrigin("https://music.example")).toBe(
    "https://music.example",
  );
});

test("Expo web continues on the server origin for HttpOnly authentication", () => {
  expect(
    embeddedWebClientTarget(
      "web",
      "http://localhost:8081",
      "http://music.local:1993",
    ),
  ).toBe("http://music.local:1993");
  expect(
    embeddedWebClientTarget(
      "web",
      "http://music.local:1993",
      "http://music.local:1993",
    ),
  ).toBeNull();
  expect(
    embeddedWebClientTarget(
      "android",
      "http://localhost",
      "http://music.local:1993",
    ),
  ).toBeNull();
});

test("artwork authorization is sent only to the connected Parson origin", () => {
  configureNativeRuntime({
    origin: "https://music.example",
    token: "private-access-token",
  });

  expect(
    imageRequestHeaders("https://music.example/media/images/cover.jpg"),
  ).toEqual({ Authorization: "Bearer private-access-token" });
  expect(
    imageRequestHeaders("https://artwork-provider.example/cover.jpg"),
  ).toEqual({});
  expect(imageRequestHeaders("not a URL")).toEqual({});
});

test("signed lock-screen artwork preserves the encoded image path", () => {
  expect(
    applyImageSignature(
      "https://music.example/media/images/%2Fmusic%2Fcover.jpg",
      123,
      "abc",
    ),
  ).toBe(
    "https://music.example/media/images/%2Fmusic%2Fcover.jpg?expires=123&image_signature=abc",
  );
});

test("a refresh finishing after a server switch cannot authorize old media work", async () => {
  let releaseResponse: ((response: Response) => void) | undefined;
  globalThis.fetch = mock(
    async () =>
      await new Promise<Response>((resolve) => {
        releaseResponse = resolve;
      }),
  ) as typeof fetch;
  configureNativeRuntime({
    origin: "https://old-library.test",
    refreshToken: "old-refresh-token",
    token: token(5, "old"),
  });

  const pendingHeaders = freshAuthorizationHeaders();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const newAccessToken = token(300, "new");
  configureNativeRuntime({
    origin: "https://new-library.test",
    refreshToken: "new-refresh-token",
    token: newAccessToken,
  });
  releaseResponse?.(
    Response.json({
      status: true,
      access_token: token(300, "stale"),
      refresh_token: "rotated-old-refresh-token",
    }),
  );

  expect(await pendingHeaders).toEqual({});
  expect(await freshAuthorizationHeaders()).toEqual({
    Authorization: `Bearer ${newAccessToken}`,
  });
});
