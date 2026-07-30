const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  shell,
} = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  APPLICATION_ID,
  compareVersions,
  getInstallState,
  installAppImage,
  integrateInstallation,
} = require("./linux-installer.cjs");
const { relaunchInstalledApp } = require("./linux-relaunch.cjs");
const { isAllowedNavigation } = require("./navigation.cjs");
const {
  isParsonManifest,
  isTrustedBackendManifest,
} = require("./backend-trust.cjs");
const { classifyStartupFailure } = require("./failure-state.cjs");

const DEFAULT_PORT = 1993;
let backendPort = DEFAULT_PORT;
let backendOrigin = `http://127.0.0.1:${DEFAULT_PORT}`;
let backendInstanceKey = "";
const ALLOWED_LOCAL_PAGES = ["startup.html", "startup-error.html"].map(
  (name) => pathToFileURL(path.join(__dirname, name)).href,
);
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

function refreshDesktopIntegration(applicationsDirectory) {
  for (const [command, args] of [
    ["update-desktop-database", [applicationsDirectory]],
    [
      "xdg-mime",
      ["default", `${APPLICATION_ID}.desktop`, "x-scheme-handler/parson"],
    ],
  ]) {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
  }
}

async function offerLinuxInstallation() {
  if (process.platform !== "linux" || !app.isPackaged) return false;
  const state = getInstallState();
  if (!state.available) return false;

  const iconSource = path.join(process.resourcesPath, "parson.png");
  const version = app.getVersion();
  if (state.isCanonical) {
    try {
      await integrateInstallation({ iconSource, version });
    } catch (error) {
      console.error("Could not refresh Linux desktop integration", error);
    }
    return false;
  }

  const comparison = state.installedVersion
    ? compareVersions(state.installedVersion, version)
    : null;
  const alreadyCurrent = state.installed && comparison === 0;
  const installedIsNewer = state.installed && comparison === 1;
  const action =
    alreadyCurrent || installedIsNewer
      ? "Open installed"
      : state.installed
        ? "Update"
        : "Install";
  const versionDetail = installedIsNewer
    ? `A newer version (${state.installedVersion}) is already installed.`
    : alreadyCurrent
      ? `Version ${version} is already installed.`
      : state.installedVersion
        ? `Version ${state.installedVersion} is installed.`
        : state.installed
          ? "An existing installation was found."
          : "Install Parson for your user account.";
  const choice = process.argv.includes("--install")
    ? 0
    : dialog.showMessageBoxSync({
        type: "info",
        title: `${action} Parson`,
        message:
          alreadyCurrent || installedIsNewer
            ? versionDetail
            : `${action} Parson ${version}?`,
        detail:
          alreadyCurrent || installedIsNewer
            ? "You can open the installed copy or run this file once."
            : `${versionDetail}\n\nNo administrator password is required. Parson will add itself to your applications and restart.`,
        buttons: [action, "Run once"],
        defaultId: 0,
        cancelId: 1,
      });
  if (choice !== 0) return false;

  try {
    const paths =
      alreadyCurrent || installedIsNewer
        ? await integrateInstallation({
            iconSource,
            version: state.installedVersion,
          })
        : await installAppImage({
            iconSource,
            sourcePath: state.source,
            version,
          });
    refreshDesktopIntegration(path.dirname(paths.desktopEntry));
    relaunchInstalledApp({
      application: paths.application,
      electronApp: app,
    });
    return true;
  } catch (error) {
    dialog.showMessageBoxSync({
      type: "error",
      title: `${action} failed`,
      message:
        alreadyCurrent || installedIsNewer
          ? "Parson could not open the installed copy."
          : `Parson could not ${action.toLowerCase()} itself.`,
      detail: error instanceof Error ? error.message : String(error),
      buttons: ["Continue"],
    });
    return false;
  }
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

function backendFailureDetail(logPath, status, startOffset = 0) {
  try {
    const contents = fs.readFileSync(logPath, "utf8");
    const currentRun = contents.slice(startOffset);
    const tail = currentRun.slice(-8_000).trim();
    return tail ? `${status}\n\nRecent backend log:\n${tail}` : status;
  } catch {
    return status;
  }
}

function loadDesktopInstanceKey() {
  const keyPath = path.join(app.getPath("userData"), "desktop-instance.key");
  let invalidKeyPath = null;
  try {
    const existing = fs.readFileSync(keyPath, "utf8").trim();
    if (/^[a-f0-9]{64}$/i.test(existing)) return existing.toLowerCase();
    invalidKeyPath = `${keyPath}.invalid-${Date.now()}`;
    fs.renameSync(keyPath, invalidKeyPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(`Could not read the desktop identity key: ${error}`);
    }
  }
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  const key = randomBytes(32).toString("hex");
  const temporary = `${keyPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${key}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, keyPath);
  } catch (error) {
    try {
      fs.rmSync(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") {
        console.error(
          "Could not remove the temporary desktop identity key",
          cleanupError,
        );
      }
    }
    if (invalidKeyPath) {
      try {
        fs.renameSync(invalidKeyPath, keyPath);
      } catch (restoreError) {
        console.error(
          "Could not restore the invalid desktop identity key",
          restoreError,
        );
      }
    }
    throw new Error(`Could not create the desktop identity key: ${error}`);
  }
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
  return key;
}

async function probeBackend(origin = backendOrigin) {
  const challenge = randomBytes(32).toString("hex");
  try {
    const response = await fetch(`${origin}/.well-known/parson`, {
      signal: AbortSignal.timeout(750),
      cache: "no-store",
      headers: { "x-parson-desktop-challenge": challenge },
    });
    if (!response.ok) return { kind: "other" };
    const manifest = await response.json();
    if (isTrustedBackendManifest(manifest, backendInstanceKey, challenge)) {
      return { kind: "trusted" };
    }
    return { kind: isParsonManifest(manifest) ? "untrusted-parson" : "other" };
  } catch {
    return { kind: "unreachable" };
  }
}

function portIsListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (listening) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function availableLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Could not allocate a local port."));
        else resolve(port);
      });
    });
  });
}

async function startBackend() {
  if (backend && !backend.killed) {
    const current = await probeBackend(backendOrigin);
    if (current.kind === "trusted") return;
    throw new Error(
      "The running Parson backend did not pass its desktop authentication check.",
    );
  }
  const defaultOrigin = `http://127.0.0.1:${DEFAULT_PORT}`;
  const existing = await probeBackend(defaultOrigin);
  if (existing.kind === "trusted") {
    backendPort = DEFAULT_PORT;
    backendOrigin = defaultOrigin;
    return;
  }
  if (existing.kind === "untrusted-parson") {
    throw new Error(
      "Port 1993 is occupied by a Parson server that this desktop app did not start. Stop that server before opening Parson Desktop.",
    );
  }
  if (
    existing.kind === "unreachable" &&
    (await portIsListening(DEFAULT_PORT))
  ) {
    throw new Error(
      "Port 1993 is occupied by a service that did not answer Parson's desktop authentication check. Stop that service or configure it to use another port.",
    );
  }
  if (existing.kind === "other") {
    backendPort = await availableLoopbackPort();
    backendOrigin = `http://127.0.0.1:${backendPort}`;
  } else {
    backendPort = DEFAULT_PORT;
    backendOrigin = defaultOrigin;
  }
  const executable = backendExecutable();
  if (!fs.existsSync(executable)) {
    throw new Error(`The packaged Parson backend is missing: ${executable}`);
  }
  const logsDirectory = app.getPath("logs");
  fs.mkdirSync(logsDirectory, { recursive: true });
  const logPath = path.join(logsDirectory, "backend.log");
  rotateBackendLog(logPath);
  const logStartOffset = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
  const log = fs.openSync(logPath, "a");
  try {
    backend = spawn(executable, [], {
      cwd: path.dirname(executable),
      windowsHide: true,
      env: {
        ...process.env,
        PARSON_BIND_ADDRESS: "0.0.0.0",
        PARSON_DESKTOP_INSTANCE_TOKEN: backendInstanceKey,
        PARSON_PORT: String(backendPort),
        PARSON_PUBLIC_URL: backendOrigin,
      },
      stdio: ["ignore", log, log],
    });
  } finally {
    fs.closeSync(log);
  }
  let backendStartError = null;
  backend.once("error", (error) => {
    backendStartError = error;
    backend = null;
  });
  backend.once("exit", (code, signal) => {
    backend = null;
    if (!quitting && !mainWindow?.isDestroyed()) {
      const detail = backendFailureDetail(
        logPath,
        `Backend stopped (${code ?? signal ?? "unknown"}).`,
        logStartOffset,
      );
      void showStartupFailure(classifyStartupFailure(detail), detail);
    }
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = await probeBackend();
    if (status.kind === "trusted") return;
    if (status.kind === "untrusted-parson") {
      throw new Error(
        "The local Parson backend failed desktop authentication.",
      );
    }
    if (backendStartError) {
      throw new Error(
        `The Parson backend could not start: ${backendStartError.message}`,
      );
    }
    if (!backend) throw new Error("The Parson backend stopped during startup.");
    await new Promise((resolve) => setTimeout(resolve, STARTUP_POLL_MS));
  }
  throw new Error("The Parson backend did not become ready within 30 seconds.");
}

async function showStartupFailure(kind, detail) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.loadFile(path.join(__dirname, "startup-error.html"), {
    query: { detail: String(detail || ""), kind },
  });
}

async function loadApplication() {
  await mainWindow.loadFile(path.join(__dirname, "startup.html"));
  try {
    await startBackend();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await showStartupFailure(classifyStartupFailure(detail), detail);
    return false;
  }
  try {
    await mainWindow.loadURL(backendOrigin);
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await showStartupFailure("webview_failed", detail);
    return false;
  }
}

async function stopBackendForRetry() {
  const processToStop = backend;
  if (!processToStop || processToStop.killed) return;
  backend = null;
  processToStop.removeAllListeners("exit");
  processToStop.removeAllListeners("error");
  processToStop.once("error", () => {});
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1_500);
    processToStop.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    processToStop.kill("SIGTERM");
  });
}

function installDesktopBridge() {
  ipcMain.handle("parson:window-control", (event, action) => {
    if (
      !isAllowedNavigation(
        event.senderFrame.url,
        backendOrigin,
        ALLOWED_LOCAL_PAGES,
      )
    ) {
      throw new Error("Window controls are unavailable to untrusted content.");
    }
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
    if (new URL(event.senderFrame.url).origin !== backendOrigin) {
      throw new Error(
        "Desktop commands are only available to the local Parson app.",
      );
    }
    switch (command) {
      case "platform":
        if (process.platform === "win32") return "windows";
        if (process.platform === "darwin") return "macos";
        return "linux";
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

  ipcMain.handle("parson:startup-action", async (event, action) => {
    if (
      !isAllowedNavigation(
        event.senderFrame.url,
        backendOrigin,
        ALLOWED_LOCAL_PAGES,
      )
    ) {
      throw new Error("Startup recovery is unavailable to untrusted content.");
    }
    if (action === "open-logs") {
      shell.openPath(app.getPath("logs"));
      return true;
    }
    if (action === "retry") {
      await stopBackendForRetry();
      return loadApplication();
    }
    throw new Error(`Unknown startup action: ${action}`);
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
    frame: process.platform === "darwin",
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
    try {
      const candidate = new URL(url);
      if (candidate.protocol === "http:" || candidate.protocol === "https:") {
        void shell.openExternal(candidate.href);
      }
    } catch {}
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigation(url, backendOrigin, ALLOWED_LOCAL_PAGES)) return;
    event.preventDefault();
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    if (quitting || mainWindow?.isDestroyed()) return;
    void showStartupFailure(
      "webview_failed",
      `Renderer stopped: ${details.reason}`,
    );
  });
  await loadApplication();
}

if (primary) {
  app
    .whenReady()
    .then(async () => {
      app.setName("Parson");
      backendInstanceKey = loadDesktopInstanceKey();
      if (process.platform !== "darwin") Menu.setApplicationMenu(null);
      if (await offerLinuxInstallation()) return;
      app.setAsDefaultProtocolClient("parson");
      installDesktopBridge();
      const publishPowerResume = () => {
        if (!mainWindow?.isDestroyed())
          mainWindow.webContents.send("parson:power-resume");
      };
      powerMonitor.on("resume", publishPowerResume);
      powerMonitor.on("unlock-screen", publishPowerResume);
      await createWindow();
    })
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Parson desktop initialization failed", error);
      dialog.showErrorBox("Parson could not start", detail);
      app.quit();
    });
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow().catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Parson window restoration failed", error);
      dialog.showErrorBox("Parson could not restore its window", detail);
    });
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  quitting = true;
  if (backend && !backend.killed) backend.kill("SIGTERM");
});
