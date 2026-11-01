import { useEffect } from "react";
import { AiPanel } from "./components/AiPanel";
import { BookmarksBar } from "./components/BookmarksBar";
import { CommandPalette } from "./components/CommandPalette";
import { QrDialog } from "./components/QrDialog";
import { ToastBar } from "./components/ToastBar";
import { connectOverlay, useDialogs } from "./store/dialogs";
import { ContentArea } from "./components/ContentArea";
import { FindBar } from "./components/FindBar";
import { MemoryBar } from "./components/MemoryBar";
import { CompatBar } from "./components/CompatBar";
import { UpdateNotice } from "./components/UpdateNotice";
import { useLive } from "./hooks/useLive";
import { PermissionBar } from "./components/PermissionBar";
import { ShieldBar } from "./components/ShieldBar";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { Toolbar } from "./components/Toolbar";
import { VerticalTabs } from "./components/VerticalTabs";
import { connectAi } from "./store/ai";
import { connectTabs, selectActiveTab, useTabs } from "./store/tabs";
import { connectSettings, useUi } from "./store/ui";

export default function App() {
  const layout = useUi((s) => s.tabLayout);
  const aiOpen = useUi((s) => s.aiPanelOpen);
  const findOpen = useUi((s) => s.findOpen);
  const shieldBarOpen = useUi((s) => s.shieldBarOpen);
  const isPrivate = useTabs((s) => s.isPrivate);
  const activeInternal = useTabs((s) => selectActiveTab(s)?.internal ?? true);

  useEffect(() => connectTabs(), []);
  useEffect(() => connectSettings(), []);
  useEffect(() => connectAi(), []);
  useEffect(() => connectOverlay(), []);
  const bookmarksBar = useUi((s) => s.settings.bookmarksBar);

  // Theme and accent colour come from settings. "System" follows the operating system.
  const theme = useUi((s) => s.settings.theme);
  const accent = useUi((s) => s.settings.accent);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.style.setProperty("--color-accent", accent);
  }, [accent]);

  // Memory pressure (for the low-memory strip) and power source (battery = fewer animations and effects).
  const resources = useLive(() => window.sidb.data.resources.summary(), ["resources"]);
  const onBattery = resources.data?.onBattery ?? false;
  useEffect(() => {
    if (onBattery) document.documentElement.dataset.power = "battery";
    else delete document.documentElement.dataset.power;
  }, [onBattery]);

  // Commands forwarded by the main process (global shortcuts).
  useEffect(
    () =>
      window.sidb.onCommand((cmd) => {
        const ui = useUi.getState();
        if (cmd === "focus-address") window.dispatchEvent(new Event("sidb:focus-address"));
        else if (cmd === "find") ui.setFindOpen(true);
        else if (cmd === "escape") ui.setFindOpen(false);
        else if (cmd === "toggle-sidebar") ui.toggleSidebarPinned();
        else if (cmd === "palette") useDialogs.getState().openPalette("all");
        else if (cmd === "tab-search") useDialogs.getState().openPalette("tabs");
        else if (cmd === "screenshot") useDialogs.getState().openPalette("all", "Screenshot");
        else if (cmd === "toggle-bookmarks-bar") void window.sidb.data.settings.set({ patch: { bookmarksBar: !ui.settings.bookmarksBar } });
      }),
    [],
  );

  // Find only makes sense on a web page.
  useEffect(() => {
    if (activeInternal) {
      useUi.getState().setFindOpen(false);
      useUi.getState().setShieldBarOpen(false);
    }
  }, [activeInternal]);

  return (
    <div className={`flex h-full flex-col ${isPrivate ? "bg-app-private" : "bg-app"}`}>
      <TitleBar />
      <Toolbar />
      {bookmarksBar && <BookmarksBar />}
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {layout === "vertical" && <VerticalTabs />}
        <div className="flex min-w-0 flex-1 flex-col">
          <PermissionBar />
          <CompatBar />
          {resources.data && <MemoryBar pressure={resources.data.pressure} />}
          <ToastBar />
          {findOpen && !activeInternal && <FindBar />}
          {shieldBarOpen && !activeInternal && <ShieldBar />}
          <ContentArea />
        </div>
        {aiOpen && <AiPanel />}
      </div>
      <CommandPalette />
      {!isPrivate && <UpdateNotice />}
      <QrDialog />
    </div>
  );
}
