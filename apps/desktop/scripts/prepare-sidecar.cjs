const {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const workspace = path.resolve(__dirname, "../../..");
const binDirectory = path.join(workspace, "apps", "desktop", "electron", "bin");
const targetPlatform = process.env.PARSON_BUILD_PLATFORM || process.platform;
const windows = targetPlatform === "win32";
const executable = `parson-music-server${windows ? ".exe" : ""}`;
const rustTarget = process.env.PARSON_RUST_TARGET;
const cargoBuildSubcommands = (
  process.env.PARSON_CARGO_BUILD_SUBCOMMAND || "build"
).split(/\s+/);

function run(command, args, cwd = workspace) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

run("bun", ["run", "build"], path.join(workspace, "apps", "web"));
const cargoArgs = [
  ...cargoBuildSubcommands,
  "--manifest-path",
  path.join(workspace, "Cargo.toml"),
  "-p",
  "parson-music",
  "--release",
];
if (rustTarget) cargoArgs.push("--target", rustTarget);
run("cargo", cargoArgs);

mkdirSync(binDirectory, { recursive: true });
const otherExecutable = path.join(
  binDirectory,
  windows ? "parson-music-server" : "parson-music-server.exe",
);
if (existsSync(otherExecutable)) unlinkSync(otherExecutable);
const source = rustTarget
  ? path.join(workspace, "target", rustTarget, "release", executable)
  : path.join(workspace, "target", "release", executable);
const destination = path.join(binDirectory, executable);
copyFileSync(source, destination);
if (!windows) chmodSync(destination, 0o755);

console.log(
  `Prepared the shared Electron shell with the ${rustTarget || targetPlatform} backend.`,
);
