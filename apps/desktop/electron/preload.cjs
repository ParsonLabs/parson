const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__PARSON_ELECTRON__", {
  invoke(command, args) {
    return ipcRenderer.invoke("parson:invoke", command, args);
  },
  windowControls: {
    close: () => ipcRenderer.invoke("parson:window-control", "close"),
    isMaximized: () =>
      ipcRenderer.invoke("parson:window-control", "is-maximized"),
    minimize: () => ipcRenderer.invoke("parson:window-control", "minimize"),
    toggleMaximize: () =>
      ipcRenderer.invoke("parson:window-control", "toggle-maximize"),
    watchMaximized: (callback) => {
      ipcRenderer.on("parson:maximized", (_event, maximized) =>
        callback(Boolean(maximized)),
      );
    },
  },
  watchPowerResume: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("parson:power-resume", listener);
    return () => ipcRenderer.removeListener("parson:power-resume", listener);
  },
  startup: {
    openLogs: () => ipcRenderer.invoke("parson:startup-action", "open-logs"),
    retry: () => ipcRenderer.invoke("parson:startup-action", "retry"),
  },
});
