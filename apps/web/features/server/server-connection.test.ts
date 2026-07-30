import { describe, expect, test } from "bun:test";
import {
  normalizeServerOrigin,
  serverConnectionTarget,
} from "./server-connection";

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

  test("switches libraries by navigating to that server's own origin", () => {
    expect(
      serverConnectionTarget("music-room.local", "Living Room & NAS"),
    ).toBe(
      "http://music-room.local:1993/login?library=Living%20Room%20%26%20NAS",
    );
    expect(serverConnectionTarget("https://music.example")).toBe(
      "https://music.example/",
    );
  });
});
