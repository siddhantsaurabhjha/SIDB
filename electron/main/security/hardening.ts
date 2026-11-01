import { app, type Session, type WebContents } from "electron";
import { refuseRemoteDebugging } from "./remoteDebugging";

/**
 * App-wide safety nets, installed once before any window exists. They cover every web contents and session,
 * including ones created later (tabs, private windows, popups), so a missing per-feature check cannot open a hole.
 */
export function installHardening(): void {
  app.on("web-contents-created", (_e, wc) => hardenContents(wc));
  app.on("session-created", (ses) => hardenSession(ses)); // idempotent
}

/**
 * Malware that steals browser cookies starts browsers with --remote-debugging-port to read them. Like Chrome 136+,
 * a packaged SIDB ignores remote debugging for the normal profile folder; it still works with a separate
 * --user-data-dir (for development and testing). Must run before the app is ready.
 */
export function guardRemoteDebugging(): boolean {
  const cl = app.commandLine;
  if (!refuseRemoteDebugging(app.isPackaged, (s) => cl.hasSwitch(s))) return false;
  cl.removeSwitch("remote-debugging-port");
  cl.removeSwitch("remote-debugging-pipe");
  console.warn("[sidb] remote debugging is only allowed with a separate --user-data-dir; ignored");
  return true;
}

export function hardenContents(wc: WebContents): void {
  // SIDB never uses <webview>; refuse it everywhere so a compromised page or UI bug cannot create one.
  wc.on("will-attach-webview", (e) => e.preventDefault());
  // Default: no new windows. Tabs and the UI install their own handlers, which replace this one.
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  // Web Bluetooth device chooser: SIDB has no picker for it, so never pick a device.
  wc.on("select-bluetooth-device", (e, _devices, callback) => {
    e.preventDefault();
    callback("");
  });
}

const hardened = new WeakSet<Session>();

export function hardenSession(ses: Session): void {
  if (hardened.has(ses)) return;
  hardened.add(ses);
  // USB, HID and serial devices are never granted to websites.
  ses.setDevicePermissionHandler(() => false);
  ses.on("select-hid-device", (e, _details, callback) => {
    e.preventDefault();
    callback();
  });
  ses.on("select-serial-port", (e, _ports, _wc, callback) => {
    e.preventDefault();
    callback("");
  });
  ses.on("select-usb-device", (e, _details, callback) => {
    e.preventDefault();
    callback();
  });
}
