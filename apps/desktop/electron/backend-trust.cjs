const { createHmac, timingSafeEqual } = require("node:crypto");

function expectedDesktopProof(secret, challenge) {
  return createHmac("sha256", secret).update(challenge).digest("hex");
}

function isTrustedBackendManifest(manifest, secret, challenge) {
  if (
    !manifest ||
    manifest.protocol !== "parson" ||
    manifest.product !== "parson-music" ||
    typeof manifest.desktopProof !== "string"
  ) {
    return false;
  }
  const expected = Buffer.from(expectedDesktopProof(secret, challenge), "hex");
  let candidate;
  try {
    candidate = Buffer.from(manifest.desktopProof, "hex");
  } catch {
    return false;
  }
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

function isParsonManifest(manifest) {
  return (
    manifest?.protocol === "parson" && manifest?.product === "parson-music"
  );
}

module.exports = {
  expectedDesktopProof,
  isParsonManifest,
  isTrustedBackendManifest,
};
