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
});
