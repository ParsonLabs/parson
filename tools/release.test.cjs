const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { versionFiles, versionParts, checkVersions } = require("./release.cjs");
const { generate } = require("./update-metadata.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parson-release-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("synchronises packages, Expo build numbers and Rust locks without changing dependency versions", (t) => {
  const root = fixture(t);
  const put = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), value);
  };
  put("package.json", '{"version":"1.0.0"}');
  put(
    "apps/mobile/package.json",
    '{"version":"1.0.0","dependencies":{"test":"9.0.0"}}',
  );
  put("apps/mobile/app.json", '{"expo":{"version":"1.0.0","ios":{}}}');
  fs.mkdirSync(path.join(root, "packages"));
  put(
    "crates/backend/Cargo.toml",
    '[package]\nname = "server"\nversion = "1.0.0"\n[dependencies]\ntest = "9"\n',
  );
  put(
    "Cargo.lock",
    '[[package]]\nname = "server"\nversion = "1.0.0"\n\n[[package]]\nname = "test"\nversion = "9.0.0"\n',
  );
  const changes = versionFiles(root, "2.3.4");
  const mobile = JSON.parse(changes.get("apps/mobile/app.json"));
  assert.equal(mobile.expo.ios.buildNumber, "2003004");
  assert.equal(
    JSON.parse(changes.get("apps/mobile/package.json")).dependencies.test,
    "9.0.0",
  );
  assert.match(changes.get("Cargo.lock"), /name = "test"\nversion = "9.0.0"/);
  assert.throws(() => checkVersions(root, "2.3.4"));
  for (const [file, contents] of changes) {
    fs.writeFileSync(path.join(root, file), contents);
  }
  checkVersions(root, "2.3.4");
  for (const version of [
    "1.0",
    "1.0.1-beta",
    "01.2.3",
    "1.1000.0",
    "2001.0.0",
    "1.2.3;echo test",
  ]) {
    assert.throws(() => versionParts(version));
  }
});
test("generates complete update channels with verified hashes and correct architectures", async (t) => {
  const root = fixture(t);
  for (const name of [
    "x64-setup.exe",
    "arm64-setup.exe",
    "x64.zip",
    "arm64.zip",
    "x86_64.AppImage",
    "arm64.AppImage",
  ]) {
    fs.writeFileSync(path.join(root, `Parson_2.3.4_${name}`), name);
  }
  await generate(root, "2.3.4");
  const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file)));
  assert.equal(read("latest.yml").files.length, 2);
  assert.equal(
    read("latest-linux-arm64.yml").files[0].url,
    "Parson_2.3.4_arm64.AppImage",
  );
  assert.equal(
    read("latest-linux.yml").files[0].url,
    "Parson_2.3.4_x86_64.AppImage",
  );
  assert.match(read("latest.yml").files[0].sha512, /^[A-Za-z0-9+/]{86}==$/);
  fs.unlinkSync(path.join(root, "Parson_2.3.4_arm64-setup.exe"));
  await assert.rejects(generate(root, "2.3.4"), /expected 2 artifacts/);
});
