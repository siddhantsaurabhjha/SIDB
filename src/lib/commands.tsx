import { Bookmark, Camera, Clock, Copy, Download, FileText, Home, Layers, Moon, PanelLeft, Pin, Plus, QrCode, RotateCw, ScanSearch, Search, Settings, Shield, Sparkles, Sun, VenetianMask, Volume2, X, ZoomIn, ZoomOut, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { TabState, TabsSnapshot } from "../../shared/types/browser";
import type { Settings as AppSettings } from "../../shared/types/data";
import { useAi } from "../store/ai";
import { useDialogs } from "../store/dialogs";
import { useToast } from "../store/toast";
import { useUi } from "../store/ui";

export interface PaletteItem {
  id: string;
  title: string;
  hint?: string;
  section: "Tabs" | "Commands" | "Bookmarks" | "History" | "Go";
  icon: ReactNode;
  run: () => void;
}

export interface CommandEnv {
  tab: TabState | undefined;
  snapshot: TabsSnapshot;
  isPrivate: boolean;
  settings: AppSettings;
}

const icon = (Icon: LucideIcon) => <Icon size={15} />;

/** Screenshot results are reported in the toast strip. */
async function screenshot(mode: "visible" | "full", dest: "file" | "clipboard"): Promise<void> {
  const toast = useToast.getState();
  try {
    const r = await window.sidb.data.capture.page({ mode, dest });
    if (r.ok) toast.show(r.path ? `${r.message} ${r.path}` : r.message);
    else if (r.message !== "Cancelled.") toast.show(r.message, "error");
  } catch {
    toast.show("Could not take the screenshot.", "error");
  }
}

const setSetting = (patch: Partial<AppSettings>) => void window.sidb.data.settings.set({ patch });

export function buildCommands(env: CommandEnv): PaletteItem[] {
  const { tab, isPrivate, settings } = env;
  const api = window.sidb.tabs;
  const page = tab && !tab.internal && !tab.error && !tab.warning;
  const go = (url: string) => tab && void api.navigate(tab.id, url);
  const items: PaletteItem[] = [];
  const add = (id: string, title: string, Icon: LucideIcon, run: () => void, hint?: string) => items.push({ id, title, hint, section: "Commands", icon: icon(Icon), run });

  add("tab.new", "New tab", Plus, () => void api.create(), "Ctrl+T");
  add("window.private", "New private window", VenetianMask, () => window.sidb.window.newPrivate(), "Ctrl+Shift+N");
  add("tab.reopen", "Reopen closed tab", RotateCw, () => void window.sidb.data.history.reopenClosed(), "Ctrl+Shift+T");
  if (tab) {
    add("tab.duplicate", "Duplicate tab", Copy, () => void api.duplicate(tab.id));
    add("tab.close", "Close tab", X, () => void api.close(tab.id), "Ctrl+W");
    add("tab.pin", tab.pinned ? "Unpin tab" : "Pin tab", Pin, () => void api.pin(tab.id, !tab.pinned));
    if (page) add("tab.mute", tab.muted ? "Unmute tab" : "Mute tab", Volume2, () => void api.mute(tab.id, !tab.muted));
    if (!tab.pinned && page !== undefined) {
      add("tab.group.new", "Add tab to a new group", Layers, () => void api.groupNew(tab.id));
      if (tab.groupId) add("tab.group.remove", "Remove tab from its group", Layers, () => void api.groupRemove(tab.id));
    }
  }
  if (page && tab) {
    add("page.reload", "Reload page", RotateCw, () => void api.reload(tab.id), "Ctrl+R");
    add("page.find", "Find in page", Search, () => useUi.getState().setFindOpen(true), "Ctrl+F");
    add("page.zoomIn", "Zoom in", ZoomIn, () => void api.zoom(tab.id, "in"), "Ctrl +");
    add("page.zoomOut", "Zoom out", ZoomOut, () => void api.zoom(tab.id, "out"), "Ctrl -");
    add("page.zoomReset", "Reset zoom", ZoomIn, () => void api.zoom(tab.id, "reset"), "Ctrl 0");
    add("page.bookmark", "Bookmark this page", Bookmark, () => void window.sidb.data.bookmarks.add({ title: tab.title, url: tab.url, favicon: tab.favicon }).then(() => useToast.getState().show("Bookmark added.")).catch(() => useToast.getState().show("Could not add the bookmark.", "error")));
    add("page.qr", "QR code for this page", QrCode, () => useDialogs.getState().openQr(tab.url));
    add("shot.visible", "Screenshot: save visible area", Camera, () => void screenshot("visible", "file"), "Ctrl+Shift+S");
    add("shot.full", "Screenshot: save whole page", Camera, () => void screenshot("full", "file"));
    add("shot.copy", "Screenshot: copy visible area", Camera, () => void screenshot("visible", "clipboard"));
    add("shot.copyFull", "Screenshot: copy whole page", Camera, () => void screenshot("full", "clipboard"));
    if (!isPrivate) {
      add("ai.summarize", "SIDB AI: summarize this page", Sparkles, () => {
        useUi.getState().setAiPanelOpen(true);
        useAi.getState().send({ action: "summarize", text: "", label: `Summarize this page: ${tab.title}`, usePage: true });
      });
    }
  }
  add("qr.blank", "QR code generator", QrCode, () => useDialogs.getState().openQr(""));

  add("go.new", "Go to New Tab page", Home, () => go("sidb://newtab"));
  add("go.bookmarks", "Open Bookmarks", Bookmark, () => go("sidb://bookmarks"));
  add("go.history", "Open History", Clock, () => go("sidb://history"));
  add("go.downloads", "Open Downloads", Download, () => go("sidb://downloads"));
  add("go.shield", "Open Shield", Shield, () => go("sidb://shield"));
  add("go.ai", "Open SIDB AI workspace", Sparkles, () => go("sidb://ai"));
  add("go.settings", "Open Settings", Settings, () => go("sidb://settings"));

  add("view.sidebar", "Toggle sidebar", PanelLeft, () => useUi.getState().toggleSidebarPinned(), "Ctrl+B");
  add("view.ai", "Toggle AI panel", Sparkles, () => useUi.getState().toggleAiPanel());
  add("view.bookmarksBar", settings.bookmarksBar ? "Hide bookmarks bar" : "Show bookmarks bar", Bookmark, () => setSetting({ bookmarksBar: !settings.bookmarksBar }), "Ctrl+Shift+B");
  add("view.tabLayout", settings.tabLayout === "horizontal" ? "Switch to vertical tabs" : "Switch to horizontal tabs", Layers, () => useUi.getState().setTabLayout(settings.tabLayout === "horizontal" ? "vertical" : "horizontal"));
  add("theme.dark", "Theme: dark", Moon, () => setSetting({ theme: "dark" }));
  add("theme.light", "Theme: light", Sun, () => setSetting({ theme: "light" }));
  add("theme.system", "Theme: follow system", ScanSearch, () => setSetting({ theme: "system" }));
  add("doc.shield", settings.shieldEnabled ? "Turn Shield off (all sites)" : "Turn Shield on", FileText, () => setSetting({ shieldEnabled: !settings.shieldEnabled }));
  return items;
}
