const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  compareVersions,
  getInstallState,
  installAppImage,
  installationPaths,
  quoteDesktopArgument,
} = require("./linux-installer.cjs");

async function fixture() {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "parson-installer-test-"),
  );
  const environment = {
    HOME: path.join(root, "home"),
    XDG_DATA_HOME: path.join(root, "data"),
  };
  await fs.promises.mkdir(environment.HOME, { recursive: true });
  return {
    environment,
    paths: installationPaths(environment),
    root,
  };
}

test("reports unavailable outside an AppImage", () => {
  assert.deepEqual(getInstallState({ environment: {} }), {
    available: false,
  });
});

test("quotes desktop executable paths", () => {
  assert.equal(
    quoteDesktopArgument('/tmp/application folder/$current"name'),
    '"/tmp/application folder/\\$current\\"name"',
  );
});

test("compares packaged versions without assuming a specific release", () => {
  assert.equal(compareVersions("1.4.2", "1.5.0"), -1);
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1);
  assert.equal(compareVersions("3.1.4", "3.1.4"), 0);
  assert.equal(compareVersions("development", "3.1.4"), null);
});

test("installs and integrates an AppImage without elevated permissions", async (t) => {
  const context = await fixture();
  t.after(() => fs.promises.rm(context.root, { recursive: true, force: true }));

  const source = path.join(context.root, "download.AppImage");
  const icon = path.join(context.root, "icon.png");
  await fs.promises.writeFile(source, "new executable");
  await fs.promises.writeFile(icon, "image");
  await fs.promises.mkdir(path.dirname(context.paths.desktopShortcut), {
    recursive: true,
  });
  await fs.promises.writeFile(
    context.paths.desktopShortcut,
    "[Desktop Entry]\nName=Parson\nExec=/old/location\n",
  );

  await installAppImage({
    environment: context.environment,
    iconSource: icon,
    sourcePath: source,
    version: "2.4.6",
  });

  assert.equal(
    await fs.promises.readFile(context.paths.application, "utf8"),
    "new executable",
  );
  assert.equal(
    (await fs.promises.stat(context.paths.application)).mode & 0o777,
    0o755,
  );
  assert.equal(await fs.promises.readFile(context.paths.icon, "utf8"), "image");

  const desktopEntry = await fs.promises.readFile(
    context.paths.desktopEntry,
    "utf8",
  );
  assert.match(desktopEntry, /^Exec=".*Parson\.AppImage" %U$/m);
  assert.match(desktopEntry, /^X-AppImage-Version=2\.4\.6$/m);
  assert.equal(
    await fs.promises.readFile(context.paths.desktopShortcut, "utf8"),
    desktopEntry,
  );
  assert.deepEqual(
    JSON.parse(await fs.promises.readFile(context.paths.metadata, "utf8")),
    { version: "2.4.6" },
  );
});

test("detects and atomically replaces an installed version", async (t) => {
  const context = await fixture();
  t.after(() => fs.promises.rm(context.root, { recursive: true, force: true }));

  const first = path.join(context.root, "first.AppImage");
  const second = path.join(context.root, "second.AppImage");
  await fs.promises.writeFile(first, "first");
  await fs.promises.writeFile(second, "second");
  await installAppImage({
    environment: context.environment,
    sourcePath: first,
    version: "1.2.3",
  });

  const state = getInstallState({
    environment: context.environment,
    sourcePath: second,
  });
  assert.equal(state.available, true);
  assert.equal(state.installed, true);
  assert.equal(state.installedVersion, "1.2.3");
  assert.equal(state.isCanonical, false);

  await installAppImage({
    environment: context.environment,
    sourcePath: second,
    version: "1.2.4",
  });
  assert.equal(
    await fs.promises.readFile(context.paths.application, "utf8"),
    "second",
  );
  const stagedFiles = (
    await fs.promises.readdir(path.dirname(context.paths.application))
  ).filter((entry) => entry.startsWith(".parson-stage-"));
  assert.deepEqual(stagedFiles, []);
});

test("does not overwrite an unrelated desktop shortcut", async (t) => {
  const context = await fixture();
  t.after(() => fs.promises.rm(context.root, { recursive: true, force: true }));

  const source = path.join(context.root, "download.AppImage");
  const unrelated = "[Desktop Entry]\nName=Another application\n";
  await fs.promises.writeFile(source, "executable");
  await fs.promises.mkdir(path.dirname(context.paths.desktopShortcut), {
    recursive: true,
  });
  await fs.promises.writeFile(context.paths.desktopShortcut, unrelated);

  await installAppImage({
    environment: context.environment,
    sourcePath: source,
    version: "3.0.0",
  });
  assert.equal(
    await fs.promises.readFile(context.paths.desktopShortcut, "utf8"),
    unrelated,
  );
});
