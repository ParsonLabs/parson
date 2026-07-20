const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
} = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 1993;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const STARTUP_POLL_MS = 10;
let backend = null;
let mainWindow = null;
let quitting = false;

const primary = app.requestSingleInstanceLock();
if (!primary) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function backendExecutable() {
  const executable = `parson-music-server${process.platform === "win32" ? ".exe" : ""}`;
  if (app.isPackaged) return path.join(process.resourcesPath, executable);
  return path.join(__dirname, "bin", executable);
}

function rotateBackendLog(logPath) {
  try {
    if (fs.statSync(logPath).size <= 2 * 1024 * 1024) return;
    fs.renameSync(logPath, `${logPath}.previous`);
  } catch (error) {
    if (error?.code !== "ENOENT")
      console.error("Could not rotate backend log", error);
  }
}

async function isParsonReady() {
  try {
    const response = await fetch(`${ORIGIN}/.well-known/parson`, {
      signal: AbortSignal.timeout(750),
      cache: "no-store",
    });
    if (!response.ok) return false;
    const manifest = await response.json();
    return (
      manifest.protocol === "parson" && manifest.product === "parson-music"
    );
  } catch {
    return false;
  }
}

async function startBackend() {
  if (await isParsonReady()) return;
  const executable = backendExecutable();
  if (!fs.existsSync(executable)) {
    throw new Error(`The packaged Parson backend is missing: ${executable}`);
  }
  const logsDirectory = app.getPath("logs");
  fs.mkdirSync(logsDirectory, { recursive: true });
  const logPath = path.join(logsDirectory, "backend.log");
  rotateBackendLog(logPath);
  const log = fs.openSync(logPath, "a");
  backend = spawn(executable, [], {
    cwd: path.dirname(executable),
    windowsHide: true,
    env: {
      ...process.env,
      PARSON_BIND_ADDRESS: "0.0.0.0",
      PARSON_PORT: String(PORT),
      PARSON_PUBLIC_URL: ORIGIN,
    },
    stdio: ["ignore", log, log],
  });
  fs.closeSync(log);
  backend.once("exit", (code, signal) => {
    backend = null;
    if (!quitting && !mainWindow?.isDestroyed()) {
      void mainWindow.loadFile(path.join(__dirname, "startup-error.html"), {
        query: { detail: `Backend stopped (${code ?? signal ?? "unknown"}).` },
      });
    }
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isParsonReady()) return;
    if (!backend) throw new Error("The Parson backend stopped during startup.");
    await new Promise((resolve) => setTimeout(resolve, STARTUP_POLL_MS));
  }
  throw new Error("The Parson backend did not become ready within 30 seconds.");
}

function installDesktopBridge() {
  ipcMain.handle("parson:window-control", (event, action) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) return false;
    switch (action) {
      case "minimize":
        window.minimize();
        return true;
      case "toggle-maximize":
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
        return window.isMaximized();
      case "is-maximized":
        return window.isMaximized();
      case "close":
        window.close();
        return true;
      default:
        throw new Error(`Unknown window control: ${action}`);
    }
  });

  ipcMain.handle("parson:invoke", async (event, command, args = {}) => {
    if (new URL(event.senderFrame.url).origin !== ORIGIN) {
      throw new Error(
        "Desktop commands are only available to the local Parson app.",
      );
    }
    switch (command) {
      case "platform":
        return process.platform === "win32" ? "windows" : "linux";
      case "select_music_folder": {
        const selection = await dialog.showOpenDialog(mainWindow, {
          properties: ["openDirectory", "createDirectory"],
          title: "Choose your music folder",
        });
        return selection.canceled ? null : (selection.filePaths[0] ?? null);
      }
      case "show_track_in_file_manager": {
        const target = typeof args.path === "string" ? args.path : "";
        if (!target || !fs.existsSync(target))
          throw new Error("A valid track path is required.");
        shell.showItemInFolder(target);
        return true;
      }
      default:
        throw new Error(`Unknown desktop command: ${command}`);
    }
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: true,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    frame: false,
    title: "Parson",
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "parson.png")
      : path.join(__dirname, "../../web/public/icons/icon-512.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  const publishMaximizedState = () => {
    if (!mainWindow?.isDestroyed()) {
      mainWindow.webContents.send("parson:maximized", mainWindow.isMaximized());
    }
  };
  mainWindow.on("maximize", publishMaximizedState);
  mainWindow.on("unmaximize", publishMaximizedState);
  mainWindow.maximize();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://"))
      void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(ORIGIN) || url.startsWith("file:")) return;
    event.preventDefault();
  });
  await mainWindow.loadFile(path.join(__dirname, "startup.html"));
  try {
    await startBackend();
    await mainWindow.loadURL(ORIGIN);
  } catch (error) {
    await mainWindow.loadFile(path.join(__dirname, "startup-error.html"), {
      query: { detail: error instanceof Error ? error.message : String(error) },
    });
  }
}

if (primary) {
  app.whenReady().then(async () => {
    app.setName("Parson");
    Menu.setApplicationMenu(null);
    app.setAsDefaultProtocolClient("parson");
    installDesktopBridge();
    await createWindow();
  });
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  quitting = true;
  if (backend && !backend.killed) backend.kill("SIGTERM");
});
