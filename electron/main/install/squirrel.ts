import { app } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";

/** Windows App User Model ID used by the Squirrel installer's shortcuts (taskbar grouping, notifications). */
export const APP_USER_MODEL_ID = "com.squirrel.SIDB.SIDB";

/**
 * Squirrel.Windows starts the app with a special argument while installing, updating and uninstalling. In those runs
 * SIDB only creates or removes its Start menu and desktop shortcuts, then quits without opening a window.
 * Returns true when this run is such an installer event. User data is never touched: uninstalling keeps
 * `%APPDATA%\SIDB` (profiles, history, bookmarks) so a reinstall finds everything again.
 */
export function handleSquirrelEvent(): boolean {
  if (process.platform !== "win32" || !app.isPackaged) return false;
  const event = process.argv[1];
  if (!event?.startsWith("--squirrel-")) return false;
  if (event === "--squirrel-firstrun") return false; // first normal start after install

  const updateExe = path.resolve(path.dirname(process.execPath), "..", "Update.exe");
  const exe = path.basename(process.execPath);
  const run = (args: string[]) => {
    try {
      spawn(updateExe, args, { detached: true, stdio: "ignore" }).on("error", () => undefined).unref();
    } catch {
      /* Update.exe missing: not installed by Squirrel */
    }
  };
  if (event === "--squirrel-install" || event === "--squirrel-updated") run([`--createShortcut=${exe}`]);
  else if (event === "--squirrel-uninstall") run([`--removeShortcut=${exe}`]);
  // --squirrel-obsolete (an older version being replaced) needs nothing.
  setTimeout(() => app.quit(), 1000); // give Update.exe a moment to start
  return true;
}
