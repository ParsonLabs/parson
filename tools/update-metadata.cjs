const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { versionParts } = require("./release.cjs");

const channels = [
  { name: "latest.yml", pattern: /_.*-setup\.exe$/, artifactCount: 2 },
  { name: "latest-mac.yml", pattern: /_(x64|arm64)\.zip$/, artifactCount: 2 },
  { name: "latest-linux.yml", pattern: /_x86_64\.AppImage$/, artifactCount: 1 },
  {
    name: "latest-linux-arm64.yml",
    pattern: /_arm64\.AppImage$/,
    artifactCount: 1,
  },
];

async function sha512(file) {
  const hash = createHash("sha512");
  for await (const chunk of fs.createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest("base64");
}

async function generate(directory, version) {
  versionParts(version);
  const names = fs.readdirSync(directory);
  const artifactPrefix = `Parson_${version}_`;

  for (const channel of channels) {
    const assets = names
      .filter(
        (name) => name.startsWith(artifactPrefix) && channel.pattern.test(name),
      )
      .sort(
        (left, right) =>
          Number(left.includes("arm64")) - Number(right.includes("arm64")),
      );

    if (assets.length !== channel.artifactCount) {
      throw new Error(
        `${channel.name}: expected ${channel.artifactCount} artifacts, found ${assets.length}`,
      );
    }

    const files = await Promise.all(
      assets.map(async (name) => {
        const file = path.join(directory, name);
        return {
          url: name,
          size: fs.statSync(file).size,
          sha512: await sha512(file),
        };
      }),
    );
    const manifest = {
      version,
      files,
      path: files[0].url,
      sha512: files[0].sha512,
      releaseDate: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(directory, channel.name),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }
}

if (require.main === module) {
  generate(path.resolve(process.argv[2]), process.argv[3]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { generate };
