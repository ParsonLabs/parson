function relaunchInstalledApp({ application, electronApp }) {
  electronApp.relaunch({
    execPath: application,
    args: [],
  });
  electronApp.quit();
}

module.exports = {
  relaunchInstalledApp,
};
