import { describe, expect, test } from "bun:test";

import { isInsecureHttpOrigin } from "@parson/music-sdk";

describe("connection security notice", () => {
  test("warns for non-loopback HTTP origins", () => {
    expect(isInsecureHttpOrigin("http://192.168.1.25:1993")).toBeTrue();
    expect(isInsecureHttpOrigin("http://music-room.local:1993")).toBeTrue();
  });

  test("does not warn for HTTPS or device-local desktop origins", () => {
    expect(isInsecureHttpOrigin("https://music.example")).toBeFalse();
    expect(isInsecureHttpOrigin("http://localhost:1993")).toBeFalse();
    expect(isInsecureHttpOrigin("http://127.0.0.1:1993")).toBeFalse();
    expect(isInsecureHttpOrigin("http://[::1]:1993")).toBeFalse();
  });
});
