const { withAndroidStyles } = require("expo/config-plugins");

const minimumApis = new Map([
  ["android:windowLightNavigationBar", "27"],
  ["android:windowSplashScreenBehavior", "33"],
]);

function transformAndroidStyles(styles) {
  for (const style of styles.resources?.style ?? []) {
    for (const item of style.item ?? []) {
      const api = minimumApis.get(item.$?.name);
      if (api) item.$["tools:targetApi"] = api;
    }
  }
  return styles;
}

const plugin = (config) =>
  withAndroidStyles(config, (nextConfig) => {
    nextConfig.modResults = transformAndroidStyles(nextConfig.modResults);
    return nextConfig;
  });

plugin.transformAndroidStyles = transformAndroidStyles;
module.exports = plugin;
