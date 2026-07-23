const { spawnSync } = require("node:child_process");
const { existsSync, readdirSync, rmSync } = require("node:fs");
const path = require("node:path");

const desktopDirectory = path.resolve(__dirname, "..");
const outputDirectory = path.resolve(
  desktopDirectory,
  "../../target/release/bundle/electron",
);
const requestedArchitecture = process.env.PARSON_BUILD_ARCH || process.arch;
const targetPlatform = process.env.PARSON_BUILD_PLATFORM || process.platform;
const architecture =
  requestedArchitecture === "x86_64" || requestedArchitecture === "amd64"
    ? "x64"
    : requestedArchitecture === "aarch64"
      ? "arm64"
      : requestedArchitecture;

if (architecture !== "x64" && architecture !== "arm64") {
  throw new Error(
    `Desktop packaging does not support ${requestedArchitecture}.`,
  );
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopDirectory,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function cleanOutput(predicate) {
  if (!existsSync(outputDirectory)) return;
  for (const entry of readdirSync(outputDirectory, { withFileTypes: true })) {
    if (!predicate(entry.name)) continue;
    rmSync(path.join(outputDirectory, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

if (targetPlatform === "linux") {
  cleanOutput(
    (name) =>
      (name.startsWith("linux") && name.endsWith("-unpacked")) ||
      name.endsWith(".AppImage") ||
      name.endsWith(".deb"),
  );
  run("bash", [path.join(__dirname, "build-linux.sh")]);
} else if (targetPlatform === "win32") {
  cleanOutput(
    (name) =>
      (name.startsWith("win") && name.endsWith("-unpacked")) ||
      name.endsWith("-setup.exe") ||
      name.endsWith("-portable.exe"),
  );
  const args = [
    require.resolve("electron-builder/cli.js"),
    "--win",
    "nsis",
    "portable",
    `--${architecture}`,
  ];
  if (process.env.PARSON_REQUIRE_CODE_SIGNING === "true") {
    args.push("--config.forceCodeSigning=true");
  }
  run(process.execPath, args);
} else {
  throw new Error(`Desktop packaging is not configured for ${targetPlatform}.`);
}
