const assert = require("node:assert/strict");
const test = require("node:test");

const {
  transformAndroidStyles,
} = require("./with-android-style-compatibility.js");

test("marks generated framework style attributes with their minimum API", () => {
  const styles = {
    resources: {
      style: [
        {
          item: [
            { $: { name: "android:windowLightNavigationBar" } },
            { $: { name: "android:windowSplashScreenBehavior" } },
            { $: { name: "colorPrimary" } },
          ],
        },
      ],
    },
  };
  transformAndroidStyles(styles);
  assert.equal(styles.resources.style[0].item[0].$["tools:targetApi"], "27");
  assert.equal(styles.resources.style[0].item[1].$["tools:targetApi"], "33");
  assert.equal(
    styles.resources.style[0].item[2].$["tools:targetApi"],
    undefined,
  );
});
