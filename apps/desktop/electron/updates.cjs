const updateErrorMessage = "Could not check or download the update. Try again.";

function updateSupport({ packaged, platform, environment, macSigned }) {
  if (!packaged) {
    return "Updates are available in installed releases.";
  }
  if (platform === "win32" && environment.PORTABLE_EXECUTABLE_DIR) {
    return "Download a new portable release to update.";
  }
  if (platform === "linux" && !environment.APPIMAGE) {
    return "Update Parson through your package manager.";
  }
  if (platform === "darwin" && !macSigned) {
    return "Download the latest release to update this unsigned build.";
  }
  return null;
}

function createUpdates({
  updater,
  version,
  unsupported,
  publish,
  stopBackend,
  restartBackend,
}) {
  let state = {
    status: unsupported ? "manual" : "idle",
    version,
    message: unsupported || "",
    releaseUrl: "https://github.com/ParsonLabs/Parson/releases/latest",
  };
  let checking = null;
  let installing = false;

  const update = (patch) => {
    state = { ...state, ...patch };
    publish(state);
  };

  if (!unsupported) {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;

    updater.on("checking-for-update", () =>
      update({ status: "checking", message: "" }),
    );
    updater.on("update-available", (info) =>
      update({ status: "downloading", availableVersion: info.version }),
    );
    updater.on("download-progress", (info) =>
      update({ percent: Math.floor(info.percent) }),
    );
    updater.on("update-not-available", () =>
      update({
        status: "current",
        message: "",
        availableVersion: undefined,
        percent: undefined,
      }),
    );
    updater.on("update-downloaded", (info) =>
      update({ status: "ready", availableVersion: info.version, percent: 100 }),
    );
    updater.on("error", () => {
      update({
        status: "error",
        message: updateErrorMessage,
      });
      if (installing) {
        installing = false;
        void restartBackend?.().catch(() => {});
      }
    });
  }

  async function check() {
    if (
      unsupported ||
      state.status === "downloading" ||
      state.status === "ready"
    ) {
      return state;
    }

    if (!checking) {
      checking = Promise.resolve()
        .then(() => updater.checkForUpdates())
        .then((result) => result?.downloadPromise)
        .catch(() => {
          update({ status: "error", message: updateErrorMessage });
        })
        .finally(() => {
          checking = null;
        });
    }

    await checking;
    return state;
  }

  async function install() {
    if (state.status !== "ready") {
      throw new Error("No update is ready to install.");
    }

    await stopBackend();
    installing = true;
    try {
      updater.quitAndInstall(false, true);
    } catch (error) {
      installing = false;
      await restartBackend?.();
      throw error;
    }
  }

  return { state: () => state, check, install };
}

module.exports = { createUpdates, updateSupport };
