import { app, BrowserWindow, session } from "electron";
import path from "node:path";
import { installErrorLogging } from "./errors";
import { APP_USER_MODEL_ID, handleSquirrelEvent } from "./install/squirrel";
import { registerIpc } from "./ipc/register";
import { mark } from "./perf/marks";
import { guardRemoteDebugging, hardenSession, installHardening } from "./security/hardening";
import { handleUiScheme, registerUiScheme } from "./windows/uiProtocol";
import { applyGpuPreference } from "./resources/gpu";
import { getResourceMonitor } from "./resources/ResourceMonitor";
import { applyUserAgent } from "./shield/network";
import { getUpdates } from "./updates/UpdateChecker";
import { getProfiles } from "./profiles/instance";
import { getShield } from "./shield/instance";
import { createMainWindow } from "./windows/mainWindow";

mark("main-loaded");
installErrorLogging();
// Runs from source keep their data apart from the installed app: the installed app encrypts cookies (a fuse the
// development binary doesn't have), so sharing one folder would lose cookies in one or the other.
if (!app.isPackaged && !app.commandLine.hasSwitch("user-data-dir")) app.setPath("userData", path.join(app.getPath("appData"), "SIDB-dev"));
// Installer runs (Windows): only manage shortcuts, then quit. Nothing else starts.
const installerRun = handleSquirrelEvent();
guardRemoteDebugging();
installHardening();
registerUiScheme(); // before the app is ready
applyGpuPreference(); // must run before the app is ready
applyUserAgent(); // before any session is created
if (process.platform === "win32") app.setAppUserModelId(APP_USER_MODEL_ID);

if (installerRun) {
  // handleSquirrelEvent quits shortly.
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(async () => {
    mark("app-ready");
    hardenSession(session.defaultSession);
    handleUiScheme();
    // The SIDB UI itself never needs web permissions.
    session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    // Permission policy is installed per session by PermissionManager (ask by default).
    registerIpc();
    await getShield().init(); // loads cached filter engine; list updates run in the background
    mark("shield-ready");
    getResourceMonitor().start();
    getUpdates().start(); // installed builds only: at most one GitHub check a day, never downloads anything
    void createMainWindow().then(() => {
      // Developer tool: `npm run perf` measures startup, memory, tab switching and leaks. Never runs in a packaged app.
      if (!app.isPackaged && process.env.SIDB_PERF_OUT) void import("./dev/perf").then((m) => m.runPerf());
      // Developer tool: browser identity and Google sign-in diagnostics. Never runs in a packaged app.
      if (!app.isPackaged && process.env.SIDB_DIAG_OUT) void import("./dev/diag").then((m) => m.runDiag());
    });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
    });
  });

  app.on("will-quit", () => {
    getShield().dispose();
    void getProfiles().closeAll();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
