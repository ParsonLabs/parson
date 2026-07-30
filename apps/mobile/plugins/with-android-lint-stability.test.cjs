const assert = require("node:assert/strict");
const test = require("node:test");

const {
  transformProjectBuildGradle,
} = require("./with-android-lint-stability.js");

test("disables only the crashing Reanimated and Worklets lint tasks", () => {
  const input = 'apply plugin: "expo-root-project"\n';
  const output = transformProjectBuildGradle(input);
  assert.match(
    output,
    /subproject\.name in \["react-native-reanimated", "react-native-worklets"\]/,
  );
  assert.match(output, /task\.name\.startsWith\("lintAnalyze"\)/);
  assert.doesNotMatch(output, /lintVital.*enabled = false/);
  assert.equal(transformProjectBuildGradle(output), output);
});
