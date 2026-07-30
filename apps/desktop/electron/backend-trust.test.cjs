const test = require("node:test");
const assert = require("node:assert/strict");

const {
  expectedDesktopProof,
  isParsonManifest,
  isTrustedBackendManifest,
} = require("./backend-trust.cjs");

test("desktop backend trust requires proof from the private instance key", () => {
  const secret = "1".repeat(64);
  const challenge = "a".repeat(64);
  const manifest = {
    protocol: "parson",
    product: "parson-music",
    desktopProof: expectedDesktopProof(secret, challenge),
  };
  assert.equal(
    manifest.desktopProof,
    "c04f7260c84377afa8e5f1ec17f05215da0a1761b0187213d5d3b6dacb168e4d",
  );
  assert.equal(isParsonManifest(manifest), true);
  assert.equal(isTrustedBackendManifest(manifest, secret, challenge), true);
  assert.equal(
    isTrustedBackendManifest(manifest, "2".repeat(64), challenge),
    false,
  );
  assert.equal(
    isTrustedBackendManifest(
      { protocol: "parson", product: "parson-music" },
      secret,
      challenge,
    ),
    false,
  );
});

test("a product-shaped response with malformed proof is rejected safely", () => {
  assert.equal(
    isTrustedBackendManifest(
      {
        protocol: "parson",
        product: "parson-music",
        desktopProof: "not-hex",
      },
      "1".repeat(64),
      "a".repeat(64),
    ),
    false,
  );
});
