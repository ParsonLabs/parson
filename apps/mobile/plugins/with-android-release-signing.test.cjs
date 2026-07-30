const assert = require("node:assert/strict");
const test = require("node:test");

const { transformBuildGradle } = require("./with-android-release-signing.js");

test("replaces the public debug identity for release builds", () => {
  const input = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;
  const output = transformBuildGradle(input);
  assert.match(output, /PARSON_UPLOAD_STORE_FILE/);
  assert.match(
    output,
    /release\s*\{[\s\S]*signingConfig signingConfigs\.release/,
  );
  assert.match(output, /debug\s*\{[\s\S]*signingConfig signingConfigs\.debug/);
  assert.equal(transformBuildGradle(output), output);
});
