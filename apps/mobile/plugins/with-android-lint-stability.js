const { withProjectBuildGradle } = require("expo/config-plugins");

const marker = "// Parson: Android lint workaround for react-native-worklets";
const workaround = `

${marker}
// AGP 8.12's Kotlin UAST crashes while analyzing the Reanimated/Worklets
// Kotlin build scripts. Keep application lint enabled and skip only those
// broken third-party analysis tasks until the upstream toolchain is fixed.
subprojects { subproject ->
    if (subproject.name in ["react-native-reanimated", "react-native-worklets"]) {
        subproject.tasks.configureEach { task ->
            if (task.name.startsWith("lintAnalyze")) {
                task.enabled = false
            }
        }
    }
}
`;

function transformProjectBuildGradle(contents) {
  if (contents.includes(marker)) return contents;
  return `${contents.trimEnd()}${workaround}`;
}

const plugin = (config) =>
  withProjectBuildGradle(config, (nextConfig) => {
    nextConfig.modResults.contents = transformProjectBuildGradle(
      nextConfig.modResults.contents,
    );
    return nextConfig;
  });

plugin.transformProjectBuildGradle = transformProjectBuildGradle;
module.exports = plugin;
