import { describe, expect, test } from "bun:test";
import { normalizeServerOrigin } from "./server-connection";

describe("Parson server origins", () => {
  test("uses the official port for plain local hostnames", () => {
    expect(normalizeServerOrigin("music-room.local")).toBe(
      "http://music-room.local:1993",
    );
    expect(normalizeServerOrigin("192.168.1.20")).toBe(
      "http://192.168.1.20:1993",
    );
  });

  test("preserves explicit ports and production HTTPS origins", () => {
    expect(normalizeServerOrigin("http://music.local:8123/path")).toBe(
      "http://music.local:8123",
    );
    expect(normalizeServerOrigin("https://parson.dev/library")).toBe(
      "https://parson.dev",
    );
  });

  test("rejects non-web and credential-bearing origins", () => {
    expect(normalizeServerOrigin("file:///music")).toBe("");
    expect(normalizeServerOrigin("http://user:password@music.local")).toBe("");
  });
});
