const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const patches = [
  ["braces@3.0.3", "GHSA-vfj7-8cjw-p6xm"],
  ["node-forge@1.4.0", "GHSA-86w9-cpqp-85rv"],
  ["sprintf-js@1.1.3", "GHSA-hp3w-g68c-fv3c"],
];
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);

for (const [dependency] of patches) {
  const file = packageJson.patchedDependencies?.[dependency];
  if (!file || !fs.existsSync(path.join(root, file))) {
    throw new Error(`Required security patch is missing: ${dependency}`);
  }
}

execFileSync(
  process.execPath,
  [
    "--test",
    path.join(__dirname, "security-patches.test.cjs"),
    path.join(__dirname, "dependency-compatibility.test.cjs"),
  ],
  {
    cwd: root,
    stdio: "inherit",
  },
);

console.log(
  "Verified local security fixes for advisories without upstream releases:",
);
for (const [dependency, advisory] of patches) {
  console.log(`  ${dependency}: ${advisory}`);
}

const executable = process.platform === "win32" ? "bun.exe" : "bun";
const result = spawnSync(
  executable,
  ["audit", ...patches.flatMap(([, advisory]) => ["--ignore", advisory])],
  {
    cwd: root,
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
