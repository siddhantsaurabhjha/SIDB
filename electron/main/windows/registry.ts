import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { isUiUrl as isUiUrlFor } from "../../../shared/uiUrl";
import type { DownloadManager } from "../downloads/DownloadManager";
import type { FaviconService } from "../favicons/FaviconService";
import type { PermissionManager } from "../permissions/PermissionManager";
import type { ProfileRuntime } from "../profiles/ProfileManager";
import type { TabManager } from "../tabs/TabManager";

export interface WindowContext {
  win: BrowserWindow;
  tabs: TabManager;
  permissions: PermissionManager;
  profile: ProfileRuntime;
  /** The profile's download manager, or a memory-only one in private windows. */
  downloads: DownloadManager;
  /** The profile's icon cache, or a memory-only one in private windows. */
  favicons: FaviconService;
  isPrivate: boolean;
}

const contexts = new Map<number, WindowContext>();

export function contextOf(win: BrowserWindow): WindowContext | undefined {
  return contexts.get(win.webContents.id);
}

export function registerContext(ctx: WindowContext): void {
  contexts.set(ctx.win.webContents.id, ctx);
}

/** Safe to call after the window is destroyed (its webContents can no longer be read then). */
export function unregisterContext(ctx: WindowContext): void {
  for (const [id, c] of contexts) if (c === ctx) contexts.delete(id);
}

/** An open normal (non-private) window of the given profile, if any. */
export function findWindowForProfile(profileId: string): WindowContext | undefined {
  for (const ctx of contexts.values()) {
    if (!ctx.isPrivate && ctx.profile.info.id === profileId && !ctx.win.isDestroyed()) return ctx;
  }
  return undefined;
}

/** Finds the browser tab (and its window) that owns a web contents, if it is one of ours. */
export function findTabByWebContents(wc: Electron.WebContents): { ctx: WindowContext; tabId: string } | null {
  for (const ctx of contexts.values()) {
    const tabId = ctx.tabs.tabIdFor(wc);
    if (tabId) return { ctx, tabId };
  }
  return null;
}

const DEV_URL = process.env.SIDB_DEV_URL;

/** True for the SIDB UI document: `sidb-app://ui/index.html`, or the Vite dev server during development. */
export function isUiUrl(url: string): boolean {
  return isUiUrlFor(url, DEV_URL);
}

/** Resolves the window for an IPC event, only if it came from that window's own UI frame showing the SIDB UI. */
export function trustedContext(event: IpcMainEvent | IpcMainInvokeEvent): WindowContext | null {
  const ctx = contexts.get(event.sender.id);
  if (!ctx || ctx.win.isDestroyed()) return null;
  const frame = event.senderFrame;
  if (!frame || frame !== ctx.win.webContents.mainFrame) return null;
  return isUiUrl(frame.url) ? ctx : null;
}
