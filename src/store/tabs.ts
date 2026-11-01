import { create } from "zustand";
import type { FindResult, PermissionPrompt, TabState, TabsSnapshot } from "../../shared/types/browser";

interface TabsStore extends TabsSnapshot {
  ready: boolean;
  prompts: PermissionPrompt[];
  findResult: FindResult | null;
  apply(snapshot: TabsSnapshot): void;
}

export const useTabs = create<TabsStore>((set) => ({
  tabs: [],
  activeTabId: null,
  isPrivate: false,
  groups: [],
  ready: false,
  prompts: [],
  findResult: null,
  apply: (snapshot) => set({ ...snapshot, ready: true }),
}));

export const selectActiveTab = (s: TabsSnapshot): TabState | undefined => s.tabs.find((t) => t.id === s.activeTabId);

/** Pulls initial state and subscribes to main-process updates. Returns an unsubscribe fn. */
export function connectTabs(): () => void {
  const api = window.sidb;
  const offs = [
    api.tabs.onState((snap) => useTabs.getState().apply(snap)),
    api.permissions.onChange((prompts) => useTabs.setState({ prompts })),
    api.find.onResult((findResult) => useTabs.setState({ findResult })),
  ];
  void api.tabs.list().then((snap) => useTabs.getState().apply(snap));
  void api.permissions.list().then((prompts) => useTabs.setState({ prompts }));
  return () => offs.forEach((off) => off());
}
