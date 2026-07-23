const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APPLICATION_ID = "com.parsonlabs.parson";
const DESKTOP_FILE = `${APPLICATION_ID}.desktop`;
const APPIMAGE_FILE = "Parson.AppImage";

function homeDirectory(environment = process.env) {
  return environment.HOME || os.homedir();
}

function dataDirectory(environment = process.env) {
  return (
    environment.XDG_DATA_HOME ||
    path.join(homeDirectory(environment), ".local", "share")
  );
}

function installationPaths(environment = process.env) {
  const home = homeDirectory(environment);
  const data = dataDirectory(environment);
  return {
    application: path.join(home, ".local", "opt", "parson", APPIMAGE_FILE),
    desktopEntry: path.join(data, "applications", DESKTOP_FILE),
    desktopShortcut: path.join(home, "Desktop", "Parson.desktop"),
    icon: path.join(
      data,
      "icons",
      "hicolor",
      "512x512",
      "apps",
      `${APPLICATION_ID}.png`,
    ),
    metadata: path.join(home, ".local", "opt", "parson", "installation.json"),
  };
}

function existingRealPath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function readInstalledVersion(metadataPath) {
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    return typeof metadata.version === "string" ? metadata.version : null;
  } catch {
    return null;
  }
}

function compareVersions(left, right) {
  const parse = (value) => {
    const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}

function getInstallState({
  environment = process.env,
  sourcePath = environment.APPIMAGE,
} = {}) {
  if (!sourcePath) return { available: false };
  const source = path.resolve(sourcePath);
  let sourceStats;
  try {
    sourceStats = fs.statSync(source);
  } catch {
    return { available: false };
  }
  if (!sourceStats.isFile()) return { available: false };

  const paths = installationPaths(environment);
  const installed = fs.existsSync(paths.application);
  return {
    available: true,
    installed,
    installedVersion: readInstalledVersion(paths.metadata),
    isCanonical:
      existingRealPath(source) === existingRealPath(paths.application),
    paths,
    source,
  };
}

function quoteDesktopArgument(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("`", "\\`").replaceAll("$", "\\$")}"`;
}

function desktopEntry(applicationPath, version) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Parson",
    "Comment=Play and manage your music library",
    `Exec=${quoteDesktopArgument(applicationPath)} %U`,
    `Icon=${APPLICATION_ID}`,
    "Terminal=false",
    "Categories=AudioVideo;Audio;Player;",
    "MimeType=x-scheme-handler/parson;",
    "StartupWMClass=Parson",
    `X-AppImage-Version=${version}`,
    "X-Parson-Desktop=true",
    "",
  ].join("\n");
}

async function atomicWrite(destination, contents, mode) {
  const parent = path.dirname(destination);
  await fs.promises.mkdir(parent, { recursive: true });
  const stage = await fs.promises.mkdtemp(path.join(parent, ".parson-stage-"));
  const stagedFile = path.join(stage, path.basename(destination));
  try {
    await fs.promises.writeFile(stagedFile, contents, { mode });
    const handle = await fs.promises.open(stagedFile, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(stagedFile, destination);
  } finally {
    await fs.promises.rm(stage, { recursive: true, force: true });
  }
}

async function atomicCopy(source, destination, mode) {
  const parent = path.dirname(destination);
  await fs.promises.mkdir(parent, { recursive: true });
  const stage = await fs.promises.mkdtemp(path.join(parent, ".parson-stage-"));
  const stagedFile = path.join(stage, path.basename(destination));
  try {
    await fs.promises.copyFile(source, stagedFile);
    await fs.promises.chmod(stagedFile, mode);
    const handle = await fs.promises.open(stagedFile, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(stagedFile, destination);
  } finally {
    await fs.promises.rm(stage, { recursive: true, force: true });
  }
}

async function updateExistingDesktopShortcut(paths, entry) {
  let current;
  try {
    current = await fs.promises.readFile(paths.desktopShortcut, "utf8");
  } catch {
    return false;
  }
  if (
    !current.includes("X-Parson-Desktop=true") &&
    !/^Name=Parson$/m.test(current)
  ) {
    return false;
  }
  await atomicWrite(paths.desktopShortcut, entry, 0o755);
  return true;
}

async function integrateInstallation({
  environment = process.env,
  iconSource,
  version,
}) {
  const paths = installationPaths(environment);
  const entry = desktopEntry(paths.application, version);
  await atomicWrite(paths.desktopEntry, entry, 0o644);
  if (iconSource) await atomicCopy(iconSource, paths.icon, 0o644);
  await atomicWrite(
    paths.metadata,
    `${JSON.stringify({ version }, null, 2)}\n`,
    0o644,
  );
  await updateExistingDesktopShortcut(paths, entry);
  return paths;
}

async function installAppImage({
  environment = process.env,
  iconSource,
  sourcePath,
  version,
}) {
  const paths = installationPaths(environment);
  if (existingRealPath(sourcePath) !== existingRealPath(paths.application)) {
    await atomicCopy(sourcePath, paths.application, 0o755);
  } else {
    await fs.promises.chmod(paths.application, 0o755);
  }
  await integrateInstallation({ environment, iconSource, version });
  return paths;
}

module.exports = {
  APPLICATION_ID,
  DESKTOP_FILE,
  compareVersions,
  desktopEntry,
  getInstallState,
  installAppImage,
  installationPaths,
  integrateInstallation,
  quoteDesktopArgument,
};
