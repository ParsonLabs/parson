const { withAppBuildGradle } = require("expo/config-plugins");

function transformBuildGradle(contents) {
  if (contents.includes("PARSON_UPLOAD_STORE_FILE")) return contents;

  const signingHeader = "    signingConfigs {\n";
  if (!contents.includes(signingHeader)) {
    throw new Error("Could not find the Android signingConfigs block.");
  }
  const releaseSigning = `        release {
            def releaseTask = gradle.startParameter.taskNames.any {
                it.toLowerCase().contains("release")
            }
            if (releaseTask) {
                for (propertyName in [
                    "PARSON_UPLOAD_STORE_FILE",
                    "PARSON_UPLOAD_STORE_PASSWORD",
                    "PARSON_UPLOAD_KEY_ALIAS",
                    "PARSON_UPLOAD_KEY_PASSWORD"
                ]) {
                    if (!project.hasProperty(propertyName) || project.property(propertyName).toString().isBlank()) {
                        throw new GradleException("Missing required release-signing property: " + propertyName)
                    }
                }
                storeFile file(project.property("PARSON_UPLOAD_STORE_FILE"))
                storePassword project.property("PARSON_UPLOAD_STORE_PASSWORD")
                keyAlias project.property("PARSON_UPLOAD_KEY_ALIAS")
                keyPassword project.property("PARSON_UPLOAD_KEY_PASSWORD")
            }
        }
`;
  const withSigningConfig = contents.replace(
    signingHeader,
    `${signingHeader}${releaseSigning}`,
  );
  const buildTypesMarker = "    buildTypes {\n";
  const buildTypesIndex = withSigningConfig.indexOf(buildTypesMarker);
  if (buildTypesIndex < 0) {
    throw new Error("Could not find the Android buildTypes block.");
  }
  const beforeBuildTypes = withSigningConfig.slice(0, buildTypesIndex);
  const buildTypes = withSigningConfig.slice(buildTypesIndex);
  const releaseBlock =
    /(release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!releaseBlock.test(buildTypes)) {
    throw new Error("Could not find the Android release build type.");
  }
  return (
    beforeBuildTypes +
    buildTypes.replace(releaseBlock, "$1signingConfig signingConfigs.release")
  );
}

const plugin = (config) =>
  withAppBuildGradle(config, (nextConfig) => {
    nextConfig.modResults.contents = transformBuildGradle(
      nextConfig.modResults.contents,
    );
    return nextConfig;
  });

plugin.transformBuildGradle = transformBuildGradle;
module.exports = plugin;
