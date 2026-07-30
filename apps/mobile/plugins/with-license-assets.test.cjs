const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { copyLicenseAssets } = require("./with-license-assets.js");

test("copies GPL and third-party notices into Android assets", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "parson-license-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const projectRoot = path.join(workspace, "apps", "mobile");
  const androidRoot = path.join(projectRoot, "android");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(workspace, "LICENSE"), "GPL text");
  fs.writeFileSync(path.join(workspace, "THIRD_PARTY_NOTICES.md"), "notices");

  copyLicenseAssets(projectRoot, androidRoot);

  const destination = path.join(
    androidRoot,
    "app",
    "src",
    "main",
    "assets",
    "licenses",
  );
  assert.equal(
    fs.readFileSync(path.join(destination, "LICENSE"), "utf8"),
    "GPL text",
  );
  assert.equal(
    fs.readFileSync(path.join(destination, "THIRD_PARTY_NOTICES.md"), "utf8"),
    "notices",
  );
});
