import { BrowserWindow, nativeTheme } from "electron";
import type { Settings } from "../../../shared/types/data";

export const OVERLAY_HEIGHT = 40;

export function overlayFor(): Electron.TitleBarOverlayOptions {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: "#00000000", symbolColor: dark ? "#c9c6e6" : "#2a2640", height: OVERLAY_HEIGHT };
}

export function backgroundFor(isPrivate: boolean): string {
  if (nativeTheme.shouldUseDarkColors) return isPrivate ? "#0a0614" : "#07060f";
  return "#eef0f8";
}

/** Theme is app-wide: it also makes web pages' prefers-color-scheme and native menus follow. */
export function applyTheme(theme: Settings["theme"]): void {
  nativeTheme.themeSource = theme;
  refreshWindows();
}

export function refreshWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (process.platform !== "darwin") win.setTitleBarOverlay(overlayFor());
    win.setBackgroundColor(backgroundFor(win.getTitle().includes("Private")));
  }
}
