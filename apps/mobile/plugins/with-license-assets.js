const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");
const {
  generateThirdPartyNotices,
} = require("../../../tools/generate-third-party-notices.cjs");

const LICENSE_FILES = ["LICENSE", "THIRD_PARTY_NOTICES.md"];

function copyLicenseAssets(projectRoot, platformProjectRoot) {
  const workspace = path.resolve(projectRoot, "../..");
  const destination = path.join(
    platformProjectRoot,
    "app",
    "src",
    "main",
    "assets",
    "licenses",
  );
  fs.mkdirSync(destination, { recursive: true });
  const notices = path.join(workspace, "THIRD_PARTY_NOTICES.md");
  if (!fs.existsSync(notices)) {
    generateThirdPartyNotices(notices);
  }
  for (const filename of LICENSE_FILES) {
    const source = path.join(workspace, filename);
    if (!fs.existsSync(source)) {
      throw new Error(`Required distribution license is missing: ${source}`);
    }
    fs.copyFileSync(source, path.join(destination, filename));
  }
}

const plugin = (config) =>
  withDangerousMod(config, [
    "android",
    async (nextConfig) => {
      copyLicenseAssets(
        nextConfig.modRequest.projectRoot,
        nextConfig.modRequest.platformProjectRoot,
      );
      return nextConfig;
    },
  ]);

plugin.copyLicenseAssets = copyLicenseAssets;
module.exports = plugin;
