const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createUpdates, updateSupport } = require("./updates.cjs");
test("downloads updates without restarting playback and stops the backend before installation", async () => {
  const updater = new EventEmitter();
  const calls = [];
  let checks = 0;
  updater.checkForUpdates = async () => {
    checks++;
  };
  updater.quitAndInstall = () => calls.push("install");
  const service = createUpdates({
    updater,
    version: "1.0.0",
    publish: () => {},
    stopBackend: async () => calls.push("stop"),
  });
  await Promise.all([service.check(), service.check()]);
  assert.equal(checks, 1);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.allowDowngrade, false);
  updater.emit("update-available", { version: "1.0.1" });
  updater.emit("download-progress", { percent: 25.7 });
  assert.equal(service.state().percent, 25);
  updater.emit("update-downloaded", { version: "1.0.1" });
  assert.equal(service.state().status, "ready");
  assert.deepEqual(calls, []);
  await service.install();
  assert.deepEqual(calls, ["stop", "install"]);
});
test("unsupported distributions do not initialize an updater", async () => {
  const service = createUpdates({
    updater: null,
    version: "1.0.0",
    unsupported: "Manual update",
    publish: () => {},
  });
  assert.equal((await service.check()).status, "manual");
  await assert.rejects(service.install(), /No update/);
  assert.equal(
    updateSupport({ packaged: true, platform: "win32", environment: {} }),
    null,
  );
  assert.ok(updateSupport({ packaged: false, environment: {} }));
  assert.ok(
    updateSupport({
      packaged: true,
      platform: "win32",
      environment: { PORTABLE_EXECUTABLE_DIR: "test" },
    }),
  );
  assert.ok(
    updateSupport({ packaged: true, platform: "linux", environment: {} }),
  );
  assert.equal(
    updateSupport({
      packaged: true,
      platform: "linux",
      environment: { APPIMAGE: "test" },
    }),
    null,
  );
  assert.ok(
    updateSupport({
      packaged: true,
      platform: "darwin",
      environment: {},
      macSigned: false,
    }),
  );
});
test("failed checks can be retried without exposing internal error details", async () => {
  const updater = new EventEmitter();
  let count = 0;
  updater.checkForUpdates = async () => {
    if (++count === 1) {
      throw new Error("internal");
    }
    updater.emit("update-not-available");
  };
  const service = createUpdates({
    updater,
    version: "1.0.0",
    publish: () => {},
  });
  assert.equal((await service.check()).status, "error");
  assert.equal((await service.check()).status, "current");
});

test("an installer error restarts the stopped backend", async () => {
  const updater = new EventEmitter();
  const calls = [];
  updater.quitAndInstall = () =>
    updater.emit("error", new Error("installer failed"));
  const service = createUpdates({
    updater,
    version: "1.0.0",
    publish: () => {},
    stopBackend: async () => calls.push("stop"),
    restartBackend: async () => calls.push("restart"),
  });
  updater.emit("update-downloaded", { version: "1.0.1" });
  await service.install();
  assert.equal(service.state().status, "error");
  assert.deepEqual(calls, ["stop", "restart"]);
});

test("download rejections are handled without an unhandled promise", async () => {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => ({
    downloadPromise: Promise.reject(new Error("download failed")),
  });
  const service = createUpdates({
    updater,
    version: "1.0.0",
    publish: () => {},
  });
  assert.equal((await service.check()).status, "error");
});
