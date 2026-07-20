import { describe, expect, test } from "bun:test";

import {
  parseDiscoveryManifest,
  parseDiscoveryManifestResponse,
  serverIdentityChanged,
} from "./discovery-manifest";

const manifest = {
  protocol: "parson",
  protocolVersion: 1,
  instanceId: "library-a",
  name: "Home Library",
  product: "parson-music",
  serverVersion: "1.0.0",
};

describe("discovery manifests", () => {
  test("accepts a complete compatible manifest", () => {
    expect(parseDiscoveryManifest(manifest)).toEqual(manifest);
  });

  test("rejects malformed, incompatible, and identity-free manifests", () => {
    for (const value of [
      null,
      {},
      { ...manifest, protocolVersion: 2 },
      { ...manifest, product: "lookalike" },
      { ...manifest, instanceId: "  " },
      { ...manifest, name: 42 },
      { ...manifest, serverVersion: null },
    ]) {
      expect(() => parseDiscoveryManifest(value)).toThrow(
        "This is not a compatible Parson library.",
      );
    }
  });

  test("rejects HTTP errors, malformed JSON, and oversized bodies", async () => {
    await expect(
      parseDiscoveryManifestResponse(new Response(null, { status: 503 })),
    ).rejects.toThrow("Library returned HTTP 503.");
    await expect(
      parseDiscoveryManifestResponse(new Response("not-json")),
    ).rejects.toThrow("The library returned an invalid manifest.");
    await expect(
      parseDiscoveryManifestResponse(
        new Response(JSON.stringify(manifest), {
          headers: { "content-length": String(64 * 1024 + 1) },
        }),
      ),
    ).rejects.toThrow("The library manifest is unexpectedly large.");
    await expect(
      parseDiscoveryManifestResponse(
        new Response(
          JSON.stringify({ ...manifest, padding: "é".repeat(40_000) }),
        ),
      ),
    ).rejects.toThrow("The library manifest is unexpectedly large.");
  });
});

describe("server identity transitions", () => {
  test("does not treat the first connection or an unchanged server as a transition", () => {
    expect(
      serverIdentityChanged(
        { origin: null, instanceId: null },
        { origin: "https://music.test", instanceId: "library-a" },
      ),
    ).toBeFalse();
    expect(
      serverIdentityChanged(
        { origin: "https://music.test", instanceId: "library-a" },
        { origin: "https://music.test", instanceId: "library-a" },
      ),
    ).toBeFalse();
  });

  test("detects both a new origin and a replaced instance at one origin", () => {
    expect(
      serverIdentityChanged(
        { origin: "https://music.test", instanceId: "library-a" },
        { origin: "https://other.test", instanceId: "library-a" },
      ),
    ).toBeTrue();
    expect(
      serverIdentityChanged(
        { origin: "https://music.test", instanceId: "library-a" },
        { origin: "https://music.test", instanceId: "library-b" },
      ),
    ).toBeTrue();
  });
});
