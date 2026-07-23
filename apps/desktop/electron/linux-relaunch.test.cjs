const assert = require("node:assert/strict");
const test = require("node:test");

const { relaunchInstalledApp } = require("./linux-relaunch.cjs");

test("relaunches the installed application after the current instance exits", () => {
  const calls = [];
  const electronApp = {
    quit() {
      calls.push(["quit"]);
    },
    relaunch(options) {
      calls.push(["relaunch", options]);
    },
  };

  relaunchInstalledApp({
    application: "/tmp/installed application",
    electronApp,
  });

  assert.deepEqual(calls, [
    [
      "relaunch",
      {
        execPath: "/tmp/installed application",
        args: [],
      },
    ],
    ["quit"],
  ]);
});
