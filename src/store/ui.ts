import { create } from "zustand";
import { DEFAULT_SETTINGS, type Settings } from "../../shared/types/data";

export type TabLayout = Settings["tabLayout"];

interface UiStore {
  /** Latest persisted settings (defaults until the first load finishes). */
  settings: Settings;
  tabLayout: TabLayout;
  sidebarPinned: boolean;
  sidebarHover: boolean;
  aiPanelOpen: boolean;
  findOpen: boolean;
  shieldBarOpen: boolean;
  setFindOpen(v: boolean): void;
  setShieldBarOpen(v: boolean): void;
  /** Applies persisted settings (from SQLite) to the UI state. */
  applySettings(s: Settings): void;
  setTabLayout(l: TabLayout): void;
  toggleSidebarPinned(): void;
  setSidebarHover(v: boolean): void;
  toggleAiPanel(): void;
  setAiPanelOpen(v: boolean): void;
}

const persist = (patch: Partial<Settings>) => void window.sidb.data.settings.set({ patch }).catch(() => undefined);

export const useUi = create<UiStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  tabLayout: "horizontal",
  sidebarPinned: true,
  sidebarHover: false,
  aiPanelOpen: false,
  findOpen: false,
  shieldBarOpen: false,
  setFindOpen: (findOpen) => set({ findOpen }),
  setShieldBarOpen: (shieldBarOpen) => set({ shieldBarOpen }),
  applySettings: (settings) => set({ settings, tabLayout: settings.tabLayout, sidebarPinned: settings.sidebarPinned }),
  setTabLayout: (tabLayout) => {
    set({ tabLayout });
    persist({ tabLayout });
  },
  toggleSidebarPinned: () => {
    const sidebarPinned = !get().sidebarPinned;
    set({ sidebarPinned });
    persist({ sidebarPinned });
  },
  setSidebarHover: (sidebarHover) => set({ sidebarHover }),
  toggleAiPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),
  setAiPanelOpen: (aiPanelOpen) => set({ aiPanelOpen }),
}));

/** Loads persisted UI settings and keeps them in sync with changes from other places (e.g. the Settings page). */
export function connectSettings(): () => void {
  const load = () => void window.sidb.data.settings.get().then((s) => useUi.getState().applySettings(s));
  load();
  return window.sidb.data.onChange((topic) => topic === "settings" && load());
}
