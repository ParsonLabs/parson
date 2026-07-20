const { spawnSync } = require("node:child_process");
const { existsSync, readdirSync, rmSync } = require("node:fs");
const path = require("node:path");

const desktopDirectory = path.resolve(__dirname, "..");
const outputDirectory = path.resolve(
  desktopDirectory,
  "../../target/release/bundle/electron",
);

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

if (process.platform === "linux") {
  cleanOutput(
    (name) =>
      name === "linux-unpacked" ||
      name.endsWith(".AppImage") ||
      name.endsWith(".deb"),
  );
  run("bash", [path.join(__dirname, "build-linux.sh")]);
} else if (process.platform === "win32") {
  cleanOutput((name) => name === "win-unpacked" || name.endsWith("-setup.exe"));
  const args = [require.resolve("electron-builder/cli.js"), "--win", "nsis"];
  if (process.env.PARSON_REQUIRE_CODE_SIGNING === "true") {
    args.push("--config.forceCodeSigning=true");
  }
  run(process.execPath, args);
} else {
  throw new Error(
    `Desktop packaging is not configured for ${process.platform}.`,
  );
}
