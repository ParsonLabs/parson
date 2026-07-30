const test = require("node:test");
const assert = require("node:assert/strict");

const { isAllowedNavigation } = require("./navigation.cjs");

const origin = "http://127.0.0.1:1993";

test("allows only the exact Parson origin", () => {
  assert.equal(isAllowedNavigation(`${origin}/album?id=1`, origin), true);
  assert.equal(
    isAllowedNavigation("http://127.0.0.1:1993.attacker.example/", origin),
    false,
  );
  assert.equal(isAllowedNavigation("http://127.0.0.1:1994/", origin), false);
  assert.equal(isAllowedNavigation("not a URL", origin), false);
});

test("allows only explicitly listed packaged startup pages", () => {
  const allowed = ["file:///opt/parson/startup-error.html"];
  assert.equal(
    isAllowedNavigation(
      "file:///opt/parson/startup-error.html?detail=failed",
      origin,
      allowed,
    ),
    true,
  );
  assert.equal(
    isAllowedNavigation("file:///home/listener/.ssh/id_rsa", origin, allowed),
    false,
  );
});
