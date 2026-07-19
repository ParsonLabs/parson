const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");

const transitionDurationMs = 180;

const animations = {
  "rns_no_animation_medium.xml": `<?xml version="1.0" encoding="utf-8"?>
<alpha xmlns:android="http://schemas.android.com/apk/res/android"
    android:fromAlpha="1.0"
    android:toAlpha="1.0"
    android:duration="${transitionDurationMs}" />
`,
  "rns_slide_in_from_bottom.xml": `<?xml version="1.0" encoding="utf-8"?>
<translate xmlns:android="http://schemas.android.com/apk/res/android"
    android:fromYDelta="100%"
    android:toYDelta="0%"
    android:duration="${transitionDurationMs}" />
`,
  "rns_slide_out_to_bottom.xml": `<?xml version="1.0" encoding="utf-8"?>
<translate xmlns:android="http://schemas.android.com/apk/res/android"
    android:fromYDelta="0%"
    android:toYDelta="100%"
    android:duration="${transitionDurationMs}" />
`,
};

module.exports = (config) =>
  withDangerousMod(config, [
    "android",
    async (nextConfig) => {
      const animationDirectory = path.join(
        nextConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "anim",
      );
      await fs.mkdir(animationDirectory, { recursive: true });
      await Promise.all(
        Object.entries(animations).map(([name, contents]) =>
          fs.writeFile(path.join(animationDirectory, name), contents),
        ),
      );
      return nextConfig;
    },
  ]);
