import { randomUUID } from "node:crypto";
import { BrowserWindow, Menu, WebContentsView, clipboard, shell, type Input, type Session, type WebContents } from "electron";
import { googleSigninRejection } from "../../../shared/compat";
import { GROUP_COLORS, type ContentBounds, type FindResult, type TabGroup, type TabState, type TabsSnapshot, type UiCommand } from "../../../shared/types/browser";
import type { SearchEngineId } from "../../../shared/constants/search";
import { placeInGroup, placeOutOfGroup } from "./groups";
import { protectedReason, sleepCandidates, type SleepCandidate } from "../../../shared/resources";
import { internalPageOf, isInternalUrl, isSafeWebUrl, normalizeInput } from "../../../shared/url";

interface Tab {
  state: TabState;
  view: WebContentsView | null;
  /** Restored from a previous session but not loaded yet; loads when first activated. */
  lazy: boolean;
  /** Time of the last click or key press inside the page, used to tell user-opened popups from unwanted ones. */
  lastGesture: number;
  /** When the tab was last the active one (for "least recently used first"). */
  lastActiveAt: number;
  /** The page was given camera, microphone or screen access since it last navigated. Such tabs never sleep. */
  capturing: boolean;
  /** Back/forward list (with scroll and form state) kept while the tab sleeps, restored when it wakes. */
  savedHistory: { entries: Electron.NavigationEntry[]; index: number } | null;
  /** Where a sign-in Google refused was heading; kept here so the UI can never choose what gets opened. */
  signinContinueUrl: string | null;
}

export interface SavedTabInfo {
  url: string;
  title: string;
  pinned: boolean;
  active: boolean;
  zoom: number;
  groupId?: string | null;
}

export interface TabEvents {
  snapshot(snapshot: TabsSnapshot): void;
  findResult(result: FindResult): void;
  command(command: UiCommand): void;
  /** A tab closed or started a new main-frame navigation (pending permission prompts become invalid). */
  tabReset(tabId: string): void;
  newPrivateWindow(): void;
  searchEngine(): SearchEngineId;
  /** A main-frame page was committed. The window owner decides whether to store it (never for private windows). */
  visited(url: string, title: string): void;
  titleUpdated(url: string, title: string): void;
  tabClosed(url: string, title: string): void;
  sessionChanged(): void;
  reopenClosed(): void;
  shieldMode(pageUrl: string): "on" | "site-off" | "off";
  /** True when window.open() calls without a recent user gesture should be blocked on this page. */
  blockPopupsFor(pageUrl: string): boolean;
  popupBlocked(): void;
  /** The user chose to open a page Safe Browsing flagged; do not flag it again for a while. */
  allowUnsafe(url: string): void;
  /** A page told us which icons it declares (web addresses only). */
  favicons(pageUrl: string, iconUrls: string[]): void;
  /** The user picked "Rename group" in the native menu; the UI shows an inline editor. */
  renameGroup(groupId: string): void;
  /** The page area is hidden behind a UI overlay; `snapshot` is a picture of the page to show instead. */
  overlay(snapshot: string | null): void;
}

const NEWTAB = "sidb://newtab";
const POPUP_GESTURE_WINDOW_MS = 1500;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

function stepZoom(current: number, dir: "in" | "out"): number {
  if (dir === "in") return ZOOM_STEPS.find((z) => z > current + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? ZOOM_STEPS[0];
}

/**
 * Owns all tabs of one browser window. Each web tab is a WebContentsView layered over the
 * window's React UI; internal sidb:// tabs have no view and are drawn by the renderer.
 */
export class TabManager {
  private tabs: Tab[] = [];
  private activeId: string | null = null;
  private bounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
  private emitScheduled = false;
  private htmlFullscreenTabId: string | null = null;
  private weEnteredWindowFullscreen = false;
  private groups = new Map<string, TabGroup>();
  private overlayOpen = false;
  private overlayToken = 0;
  private snapshotCache: { tabId: string | null; at: number; data: string | null } | null = null;

  constructor(
    private readonly window: BrowserWindow,
    private readonly session: Session,
    private readonly events: TabEvents,
    private readonly isPrivate: boolean,
  ) {
    window.on("resize", () => this.layout());
  }

  snapshot(): TabsSnapshot {
    return { tabs: this.tabs.map((t) => ({ ...t.state })), activeTabId: this.activeId, isPrivate: this.isPrivate, groups: [...this.groups.values()].map((g) => ({ ...g })) };
  }

  tabIdFor(wc: WebContents): string | null {
    return this.tabs.find((t) => t.view?.webContents === wc)?.state.id ?? null;
  }

  create(url: string = NEWTAB, activate = true, opts: { lazy?: boolean; title?: string; pinned?: boolean; zoom?: number; groupId?: string | null } = {}): string {
    const target = normalizeInput(url, this.events.searchEngine());
    const id = randomUUID();
    const lazy = !!opts.lazy && !activate && !isInternalUrl(target);
    const tab: Tab = {
      view: null,
      lazy,
      lastGesture: 0,
      lastActiveAt: Date.now(),
      capturing: false,
      savedHistory: null,
      signinContinueUrl: null,
      state: {
        id,
        url: target,
        title: opts.title || this.titleFor(target),
        favicon: null,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        pinned: !!opts.pinned,
        muted: false,
        audible: false,
        internal: isInternalUrl(target),
        security: "none",
        zoom: opts.zoom ?? 1,
        error: null,
        blocked: 0,
        popupsBlocked: 0,
        shield: "on",
        warning: null,
        groupId: opts.groupId && this.groups.has(opts.groupId) ? opts.groupId : null,
      },
    };
    this.tabs.push(tab);
    if (!tab.state.internal && !lazy) this.attachView(tab, target);
    this.refreshSecurity(tab);
    if (activate || this.activeId === null) this.activate(id);
    else this.emit();
    return id;
  }

  close(id: string): void {
    const index = this.tabs.findIndex((t) => t.state.id === id);
    if (index === -1) return;
    const [tab] = this.tabs.splice(index, 1);
    if (!tab.state.internal) this.events.tabClosed(tab.state.url, tab.state.title);
    this.destroyView(tab);
    this.events.tabReset(id);
    this.dropEmptyGroups();

    if (this.tabs.length === 0) {
      // Never leave the window without a tab.
      this.activeId = null;
      this.create(NEWTAB, true);
      return;
    }
    if (this.activeId === id) {
      const next = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.activeId = null;
      this.activate(next.state.id);
    } else {
      this.emit();
    }
  }

  activate(id: string): void {
    const tab = this.find(id);
    if (!tab) return;
    const previous = this.activeId ? this.find(this.activeId) : undefined;
    if (previous) previous.lastActiveAt = Date.now();
    this.activeId = id;
    tab.lastActiveAt = Date.now();
    const g = tab.state.groupId ? this.groups.get(tab.state.groupId) : undefined;
    if (g?.collapsed) g.collapsed = false; // selecting a tab inside a collapsed group opens it
    if (tab.lazy) {
      tab.lazy = false;
      tab.state.sleeping = false;
      this.attachView(tab, tab.state.url);
    }
    this.layout();
    this.emit();
    // Give keyboard focus to the page so typing works immediately.
    if (tab.view && !tab.state.error) tab.view.webContents.focus();
  }

  activateRelative(delta: number): void {
    if (this.tabs.length < 2) return;
    const i = this.tabs.findIndex((t) => t.state.id === this.activeId);
    this.activate(this.tabs[(i + delta + this.tabs.length) % this.tabs.length].state.id);
  }

  navigate(id: string, input: string): void {
    const tab = this.find(id);
    if (tab) this.navigateTab(tab, normalizeInput(input, this.events.searchEngine()));
  }

  back(id: string): void {
    const wc = this.find(id)?.view?.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  forward(id: string): void {
    const wc = this.find(id)?.view?.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(id: string): void {
    const tab = this.find(id);
    if (!tab?.view) return;
    if (tab.state.warning) return;
    const failedUrl = tab.state.error?.url;
    tab.state.error = null;
    if (failedUrl && isSafeWebUrl(failedUrl)) void tab.view.webContents.loadURL(failedUrl).catch(() => undefined);
    else tab.view.webContents.reload();
    this.layout();
    this.emit();
  }

  /**
   * The user pressed "Continue in default browser" on the Google sign-in notice. Opens where that sign-in was heading
   * in the operating system's default browser. Only ever on this explicit click; ordinary browsing is never redirected.
   */
  continueSigninExternally(id: string): boolean {
    const tab = this.find(id);
    const url = tab?.state.notice?.kind === "google-signin-blocked" ? tab.signinContinueUrl : null;
    if (!url || !isSafeWebUrl(url) || !url.startsWith("https://")) return false;
    void shell.openExternal(url).catch(() => undefined);
    return true;
  }

  /** Google refused the sign-in because SIDB is built on an embedded framework. Explain it; never work around it. */
  private updateNotice(tab: Tab, url: string): void {
    const rejected = googleSigninRejection(url);
    tab.signinContinueUrl = rejected?.continueUrl ?? null;
    tab.state.notice = rejected ? { kind: "google-signin-blocked", site: rejected.site } : null;
  }

  dismissNotice(id: string): void {
    const tab = this.find(id);
    if (!tab?.state.notice) return;
    tab.state.notice = null;
    tab.signinContinueUrl = null;
    this.emit();
  }

  /** Called by Shield for every request it blocks on this tab. */
  noteBlocked(id: string): void {
    const tab = this.find(id);
    if (!tab) return;
    tab.state.blocked++;
    this.emit();
  }

  /** Safe Browsing flagged a navigation: show the warning page instead of loading the site. */
  flagThreat(id: string, url: string, threats: string[]): void {
    const tab = this.find(id);
    if (!tab) return;
    tab.state.warning = { url, threats };
    tab.state.url = url;
    tab.state.title = "Warning: dangerous site";
    tab.state.loading = false;
    tab.state.error = null;
    tab.state.internal = false;
    this.refreshSecurity(tab);
    this.layout();
    this.emit();
  }

  /** The user explicitly chose to continue to a flagged site. */
  proceedAnyway(id: string): void {
    const tab = this.find(id);
    const url = tab?.state.warning?.url;
    if (!tab || !url) return;
    this.events.allowUnsafe(url);
    tab.state.warning = null;
    this.navigateTab(tab, url);
  }

  stop(id: string): void {
    this.find(id)?.view?.webContents.stop();
  }

  duplicate(id: string): void {
    const tab = this.find(id);
    if (tab) this.create(tab.state.url, true);
  }

  setPinned(id: string, pinned: boolean): void {
    const tab = this.find(id);
    if (!tab || tab.state.pinned === pinned) return;
    tab.state.pinned = pinned;
    if (pinned) tab.state.groupId = null; // pinned tabs live outside groups
    this.dropEmptyGroups();
    // Keep pinned tabs grouped at the front.
    this.tabs = [...this.tabs.filter((t) => t.state.pinned), ...this.tabs.filter((t) => !t.state.pinned)];
    this.emit();
  }

  setMuted(id: string, muted: boolean): void {
    const tab = this.find(id);
    if (!tab) return;
    tab.state.muted = muted;
    tab.view?.webContents.setAudioMuted(muted);
    this.emit();
  }

  move(id: string, toIndex: number): void {
    const from = this.tabs.findIndex((t) => t.state.id === id);
    if (from === -1) return;
    const pinnedCount = this.tabs.filter((t) => t.state.pinned).length;
    const moving = this.tabs[from];
    // Pinned and unpinned tabs may not cross each other.
    const min = moving.state.pinned ? 0 : pinnedCount;
    const max = moving.state.pinned ? pinnedCount - 1 : this.tabs.length - 1;
    const to = Math.max(min, Math.min(max, toIndex));
    if (to === from) return;
    this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, moving);
    this.emit();
  }

  zoom(id: string, action: "in" | "out" | "reset"): void {
    const tab = this.find(id);
    const wc = tab?.view?.webContents;
    if (!tab || !wc) return;
    const next = action === "reset" ? 1 : stepZoom(wc.getZoomFactor(), action);
    wc.setZoomFactor(next);
    tab.state.zoom = next;
    this.emit();
  }

  findStart(id: string, text: string, opts: { forward?: boolean; findNext?: boolean } = {}): void {
    this.find(id)?.view?.webContents.findInPage(text, { forward: opts.forward ?? true, findNext: opts.findNext ?? false });
  }

  findStop(id: string): void {
    const wc = this.find(id)?.view?.webContents;
    if (wc && !wc.isDestroyed()) wc.stopFindInPage("clearSelection");
  }

  /** The active tab's page, if it is a loaded normal web page (not an internal page, error or warning). */
  activeWebContents(): WebContents | null {
    const tab = this.activeId ? this.find(this.activeId) : undefined;
    if (!tab || !tab.view || tab.state.internal || tab.state.error || tab.state.warning) return null;
    const wc = tab.view.webContents;
    return wc.isDestroyed() ? null : wc;
  }

  /** Tabs to persist for session restore. */
  sessionTabs(): SavedTabInfo[] {
    return this.tabs
      .filter((t) => t.state.internal ? t.state.url !== NEWTAB : true)
      .map((t) => ({ url: t.state.url, title: t.state.title, pinned: t.state.pinned, active: t.state.id === this.activeId, zoom: t.state.zoom, groupId: t.state.groupId }));
  }

  /** Restores saved tabs: the active one loads now, the others stay unloaded until selected. */
  restore(saved: SavedTabInfo[], groups: TabGroup[] = []): boolean {
    if (saved.length === 0) return false;
    for (const g of groups) this.groups.set(g.id, { ...g });
    const activeIndex = Math.max(0, saved.findIndex((s) => s.active));
    saved.forEach((s, i) => {
      this.create(s.url, i === activeIndex, { lazy: true, title: s.title, pinned: s.pinned, zoom: s.zoom, groupId: s.groupId });
    });
    this.dropEmptyGroups();
    return true;
  }

  sessionGroups(): TabGroup[] {
    return [...this.groups.values()].map((g) => ({ ...g }));
  }

  // --- tab groups ------------------------------------------------------------------------------

  /** Puts the tab into a new group named "Group N" and returns the group id. */
  createGroup(tabId: string, name?: string): string | null {
    const tab = this.find(tabId);
    if (!tab || tab.state.pinned) return null;
    const id = randomUUID();
    const color = GROUP_COLORS[this.groups.size % GROUP_COLORS.length];
    this.groups.set(id, { id, name: name?.trim().slice(0, 30) || `Group ${this.groups.size + 1}`, color, collapsed: false });
    this.addToGroup(tabId, id);
    return id;
  }

  /** Moves the tab next to the other tabs of the group so a group is always one block. */
  addToGroup(tabId: string, groupId: string): void {
    const tab = this.find(tabId);
    if (!tab || tab.state.pinned || !this.groups.has(groupId)) return;
    this.tabs = placeInGroup(this.tabs, tabId, groupId);
    this.dropEmptyGroups();
    this.emit();
  }

  /** Takes the tab out of its group and leaves it just after the group. */
  removeFromGroup(tabId: string): void {
    if (!this.find(tabId)?.state.groupId) return;
    this.tabs = placeOutOfGroup(this.tabs, tabId);
    this.dropEmptyGroups();
    this.emit();
  }

  updateGroup(groupId: string, patch: { name?: string; color?: string; collapsed?: boolean }): void {
    const g = this.groups.get(groupId);
    if (!g) return;
    if (patch.name !== undefined) g.name = patch.name.trim().slice(0, 30) || g.name;
    if (patch.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(patch.color)) g.color = patch.color;
    if (patch.collapsed !== undefined) g.collapsed = patch.collapsed; // the strip still shows the active tab of a collapsed group
    this.emit();
  }

  ungroup(groupId: string): void {
    for (const t of this.tabs) if (t.state.groupId === groupId) t.state.groupId = null;
    this.groups.delete(groupId);
    this.emit();
  }

  closeGroup(groupId: string): void {
    for (const id of this.tabs.filter((t) => t.state.groupId === groupId).map((t) => t.state.id)) this.close(id);
  }

  private dropEmptyGroups(): void {
    for (const id of [...this.groups.keys()]) {
      if (!this.tabs.some((t) => t.state.groupId === id)) this.groups.delete(id);
    }
  }

  closeOthers(tabId: string): void {
    for (const t of this.tabs.filter((x) => x.state.id !== tabId && !x.state.pinned)) this.close(t.state.id);
  }

  closeToRight(tabId: string): void {
    const i = this.tabs.findIndex((t) => t.state.id === tabId);
    if (i === -1) return;
    for (const t of this.tabs.slice(i + 1).filter((x) => !x.state.pinned)) this.close(t.state.id);
  }

  // --- native menus (they draw above web pages, unlike HTML menus) -----------------------------

  showTabMenu(tabId: string): void {
    const tab = this.find(tabId);
    if (!tab) return;
    const groupItems: Electron.MenuItemConstructorOptions[] = [];
    if (!tab.state.pinned) {
      groupItems.push({ label: "Add to new group", click: () => this.createGroup(tabId) });
      for (const g of this.groups.values()) {
        if (g.id !== tab.state.groupId) groupItems.push({ label: `Add to "${g.name}"`, click: () => this.addToGroup(tabId, g.id) });
      }
      if (tab.state.groupId) groupItems.push({ label: "Remove from group", click: () => this.removeFromGroup(tabId) });
    }
    const idx = this.tabs.findIndex((t) => t === tab);
    Menu.buildFromTemplate([
      { label: tab.state.pinned ? "Unpin tab" : "Pin tab", click: () => this.setPinned(tabId, !tab.state.pinned) },
      { label: tab.state.muted ? "Unmute tab" : "Mute tab", enabled: !tab.state.internal, click: () => this.setMuted(tabId, !tab.state.muted) },
      { label: "Duplicate tab", click: () => this.duplicate(tabId) },
      { label: "Reload", enabled: !tab.state.internal, click: () => this.reload(tabId) },
      { label: "Sleep tab (free memory)", enabled: protectedReason(this.sleepInfo(tab)) === null, click: () => this.sleep(tabId) },
      { label: "Sleep all background tabs", enabled: this.sleepableCount() > 0, click: () => this.sleepBackground() },
      { type: "separator" },
      ...groupItems,
      { type: "separator" },
      { label: "Close tab", click: () => this.close(tabId) },
      { label: "Close other tabs", enabled: this.tabs.length > 1, click: () => this.closeOthers(tabId) },
      { label: "Close tabs to the right", enabled: idx < this.tabs.length - 1, click: () => this.closeToRight(tabId) },
      { label: "Reopen closed tab", click: () => this.events.reopenClosed() },
    ]).popup({ window: this.window });
  }

  showGroupMenu(groupId: string): void {
    const g = this.groups.get(groupId);
    if (!g) return;
    Menu.buildFromTemplate([
      { label: g.collapsed ? "Expand group" : "Collapse group", click: () => this.updateGroup(groupId, { collapsed: !g.collapsed }) },
      { label: "Rename group", click: () => this.events.renameGroup(groupId) },
      {
        label: "Color",
        submenu: GROUP_COLORS.map((c) => ({ label: c, type: "radio" as const, checked: c.toLowerCase() === g.color.toLowerCase(), click: () => this.updateGroup(groupId, { color: c }) })),
      },
      { type: "separator" },
      { label: "Ungroup", click: () => this.ungroup(groupId) },
      { label: "Close group", click: () => this.closeGroup(groupId) },
    ]).popup({ window: this.window });
  }

  // --- overlay: hide the page while an HTML dialog (palette, QR...) is open --------------------

  /**
   * Web pages are separate native views that sit above the SIDB UI, so an HTML dialog would be hidden behind
   * them. While a dialog is open the page is replaced by a picture of itself.
   */
  async setOverlay(open: boolean): Promise<void> {
    const token = ++this.overlayToken;
    if (!open) {
      this.overlayOpen = false;
      this.layout();
      this.events.overlay(null);
      return;
    }
    // A picture taken moments ago (when the address bar got focus) avoids a visible gap while the new one is captured.
    const cached = this.snapshotCache;
    const fresh = cached && cached.tabId === this.activeId && Date.now() - cached.at < 3000;
    const snapshot = fresh ? cached.data : await this.captureSnapshot();
    if (token !== this.overlayToken) return; // closed again while capturing
    this.overlayOpen = true;
    this.layout();
    this.events.overlay(snapshot);
  }

  /** Takes the picture ahead of time, so opening a dropdown over the page is instant. */
  async prepareOverlay(): Promise<void> {
    if (this.overlayOpen) return;
    const tabId = this.activeId;
    const data = await this.captureSnapshot();
    if (data && tabId === this.activeId && !this.overlayOpen) this.snapshotCache = { tabId, at: Date.now(), data };
  }

  private async captureSnapshot(): Promise<string | null> {
    const wc = this.activeWebContents();
    if (!wc) return null;
    try {
      const image = await wc.capturePage();
      const size = image.getSize();
      const scaled = size.width > 1400 ? image.resize({ width: 1400 }) : image;
      return `data:image/jpeg;base64,${scaled.toJPEG(60).toString("base64")}`;
    } catch {
      return null;
    }
  }

  setBounds(bounds: ContentBounds): void {
    this.bounds = bounds;
    this.layout();
  }

  /**
   * Browser-level keyboard shortcuts. Attached to the UI and to every web view so they work
   * wherever focus is. Returns true when the key was consumed.
   */
  handleInput(input: Input): boolean {
    if (input.type !== "keyDown") return false;
    const key = input.key.toLowerCase();
    const mod = input.control || input.meta;
    const active = this.activeId ? this.find(this.activeId) : undefined;
    const ui = (c: UiCommand) => {
      this.window.webContents.focus();
      this.events.command(c);
    };

    if (key === "escape") {
      this.events.command("escape");
      return false; // let pages see Escape too
    }
    if (key === "f5" && active) return this.reload(active.state.id), true;
    if (key === "f11") return this.window.setFullScreen(!this.window.isFullScreen()), true;
    if (input.alt && !mod && (key === "arrowleft" || key === "arrowright") && active) {
      return key === "arrowleft" ? this.back(active.state.id) : this.forward(active.state.id), true;
    }
    if (!mod) return false;

    if (input.shift && key === "n") return this.events.newPrivateWindow(), true;
    if (input.shift && key === "t") return this.events.reopenClosed(), true;
    if (key === "tab") return this.activateRelative(input.shift ? -1 : 1), true;
    if (!input.shift && /^[1-9]$/.test(key)) {
      const target = key === "9" ? this.tabs[this.tabs.length - 1] : this.tabs[Number(key) - 1];
      if (target) this.activate(target.state.id);
      return true;
    }
    switch (key) {
      case "t":
        return this.create(), true;
      case "w":
        return active ? (this.close(active.state.id), true) : false;
      case "l":
        return ui("focus-address"), true;
      case "f":
        return active && !active.state.internal ? (ui("find"), true) : false;
      case "b":
        return ui(input.shift ? "toggle-bookmarks-bar" : "toggle-sidebar"), true;
      case "k":
        return ui("palette"), true;
      case "p":
        return input.shift ? (ui("palette"), true) : false;
      case "a":
        return input.shift ? (ui("tab-search"), true) : false;
      case "s":
        return input.shift ? (ui("screenshot"), true) : false;
      case "r":
        return active ? (this.reload(active.state.id), true) : false;
      case "=":
      case "+":
        return active ? (this.zoom(active.state.id, "in"), true) : false;
      case "-":
      case "_":
        return active ? (this.zoom(active.state.id, "out"), true) : false;
      case "0":
        return active ? (this.zoom(active.state.id, "reset"), true) : false;
      default:
        return false;
    }
  }

  dispose(): void {
    for (const tab of this.tabs) this.destroyView(tab);
    this.tabs = [];
  }

  // ---------------------------------------------------------------------------------------------

  private find(id: string): Tab | undefined {
    return this.tabs.find((t) => t.state.id === id);
  }

  private titleFor(url: string): string {
    const page = internalPageOf(url);
    if (!page) return url;
    return page === "newtab" ? "New Tab" : page === "ai" ? "SIDB AI" : page[0].toUpperCase() + page.slice(1);
  }

  private navigateTab(tab: Tab, target: string): void {
    if (isInternalUrl(target)) {
      // Switching to an internal page drops the web view (its history is not kept for now).
      this.destroyView(tab);
      this.events.tabReset(tab.state.id);
      Object.assign(tab.state, {
        url: target,
        title: this.titleFor(target),
        favicon: null,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        audible: false,
        internal: true,
        zoom: 1,
        error: null,
        warning: null,
        blocked: 0,
        popupsBlocked: 0,
      });
      this.refreshSecurity(tab);
      this.layout();
      this.emit();
      return;
    }
    if (!isSafeWebUrl(target)) return;

    tab.state.error = null;
    tab.state.warning = null;
    if (!tab.view) this.attachView(tab, target);
    else void tab.view.webContents.loadURL(target).catch(() => undefined);
    tab.state.internal = false;
    tab.state.url = target;
    tab.state.title = target;
    this.refreshSecurity(tab);
    this.layout();
    this.emit();
  }

  private attachView(tab: Tab, url: string): void {
    const view = new WebContentsView({
      webPreferences: {
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        // Web pages never get the SIDB preload bridge.
      },
    });
    tab.view = view;
    tab.state.internal = false;
    this.window.contentView.addChildView(view);
    this.wire(tab, view);
    if (tab.state.zoom !== 1) view.webContents.once("dom-ready", () => view.webContents.setZoomFactor(tab.state.zoom));
    if (tab.state.muted) view.webContents.setAudioMuted(true);
    this.layout();
    const saved = tab.savedHistory;
    tab.savedHistory = null;
    if (saved) {
      // Waking from sleep: bring back the back/forward list, scroll position and form state.
      void view.webContents.navigationHistory.restore(saved).catch(() => undefined);
    } else {
      void view.webContents.loadURL(url).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------ sleeping tabs ----------
  // Only ever on the user's request (a button or menu item). SIDB never unloads tabs on its own.

  private sleepInfo(tab: Tab): SleepCandidate {
    return {
      id: tab.state.id,
      active: tab.state.id === this.activeId,
      pinned: tab.state.pinned,
      audible: tab.state.audible,
      loading: tab.state.loading,
      capturing: tab.capturing,
      idle: !tab.view || tab.state.internal,
      lastActiveAt: tab.lastActiveAt,
    };
  }

  /** Unloads a background tab to free its memory. Returns false when the tab is protected. */
  sleep(id: string): boolean {
    const tab = this.find(id);
    if (!tab?.view || protectedReason(this.sleepInfo(tab)) !== null) return false;
    const wc = tab.view.webContents;
    try {
      const entries = wc.navigationHistory.getAllEntries();
      const index = wc.navigationHistory.getActiveIndex();
      // Only plain web pages are restored; anything else falls back to loading the current address.
      tab.savedHistory = entries.length > 0 && entries.every((e) => isSafeWebUrl(e.url)) && index >= 0 && index < entries.length ? { entries, index } : null;
    } catch {
      tab.savedHistory = null;
    }
    this.destroyView(tab);
    this.events.tabReset(id);
    tab.lazy = true;
    tab.state.sleeping = true;
    tab.state.loading = false;
    tab.state.audible = false;
    this.emit();
    return true;
  }

  /** Puts every background tab that is safe to unload to sleep. Returns how many were put to sleep. */
  sleepBackground(): number {
    let n = 0;
    for (const id of sleepCandidates(this.tabs.map((t) => this.sleepInfo(t)))) if (this.sleep(id)) n++;
    return n;
  }

  /** How many tabs sleepBackground() would unload right now. */
  sleepableCount(): number {
    return sleepCandidates(this.tabs.map((t) => this.sleepInfo(t))).length;
  }

  /** The page in this tab was granted camera, microphone or screen access. */
  noteCapture(id: string): void {
    const tab = this.find(id);
    if (tab) tab.capturing = true;
  }

  /** Per-tab facts for the Performance panel: renderer process id (null when there is none) and protection. */
  resourceTabs(): Array<{ id: string; title: string; url: string; sleeping: boolean; pid: number | null; protectedReason: string | null }> {
    return this.tabs.map((t) => {
      let pid: number | null = null;
      try {
        pid = t.view && !t.view.webContents.isDestroyed() ? t.view.webContents.getOSProcessId() : null;
      } catch {
        pid = null;
      }
      return { id: t.state.id, title: t.state.title, url: t.state.url, sleeping: !!t.state.sleeping, pid, protectedReason: protectedReason(this.sleepInfo(t)) };
    });
  }

  private destroyView(tab: Tab): void {
    const view = tab.view;
    if (!view) return;
    tab.view = null;
    if (this.htmlFullscreenTabId === tab.state.id) this.leaveHtmlFullscreen();
    try {
      this.window.contentView.removeChildView(view);
    } catch {
      /* window may already be closing */
    }
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  private wire(tab: Tab, view: WebContentsView): void {
    const wc = view.webContents;
    const sync = () => {
      if (wc.isDestroyed()) return;
      tab.state.canGoBack = wc.navigationHistory.canGoBack();
      tab.state.canGoForward = wc.navigationHistory.canGoForward();
      tab.state.zoom = wc.getZoomFactor();
      this.refreshSecurity(tab);
      this.emit();
    };

    wc.on("before-input-event", (event, input) => {
      if (this.handleInput(input)) event.preventDefault();
    });

    wc.on("did-start-loading", () => {
      tab.state.loading = true;
      this.emit();
    });
    wc.on("did-stop-loading", () => {
      tab.state.loading = false;
      sync();
    });
    wc.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      this.events.tabReset(tab.state.id);
      tab.capturing = false; // a new page has to ask again
      if (tab.state.notice) {
        tab.state.notice = null;
        tab.signinContinueUrl = null;
        this.emit();
      }
      if (!tab.state.warning) {
        tab.state.blocked = 0;
        tab.state.popupsBlocked = 0;
      }
      if (tab.state.error) {
        tab.state.error = null;
        this.layout();
        this.emit();
      }
    });
    wc.on("did-navigate", (_e, url) => {
      tab.state.url = url;
      this.updateNotice(tab, url);
      this.events.visited(url, wc.getTitle());
      sync();
    });
    wc.on("did-navigate-in-page", (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      tab.state.url = url;
      this.updateNotice(tab, url); // Google's sign-in is a single-page app: its rejection page arrives this way
      sync();
    });
    wc.on("page-title-updated", (_e, title) => {
      tab.state.title = title || tab.state.url;
      if (title) this.events.titleUpdated(tab.state.url, title);
      this.emit();
    });
    wc.on("page-favicon-updated", (_e, favicons) => {
      tab.state.favicon = favicons.find((f) => /^https?:|^data:image\//.test(f)) ?? null;
      const declared = favicons.filter((f) => /^https?:\/\//i.test(f));
      if (declared.length && !tab.state.internal) this.events.favicons(wc.getURL(), declared);
      this.emit();
    });
    wc.on("audio-state-changed", (e) => {
      tab.state.audible = e.audible;
      this.emit();
    });

    // Failed main-frame loads (-3 = aborted by a newer navigation) show the SIDB error page.
    wc.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || tab.state.warning) return; // -3: superseded; warning: we cancelled it on purpose
      tab.state.loading = false;
      tab.state.url = url || tab.state.url;
      tab.state.error = { code, description, url: url || tab.state.url };
      this.refreshSecurity(tab);
      this.layout();
      this.emit();
    });
    wc.on("render-process-gone", (_e, details) => {
      tab.state.loading = false;
      tab.state.error = { code: -1, description: `The page crashed (${details.reason})`, url: tab.state.url };
      this.layout();
      this.emit();
    });

    // Find in page results.
    wc.on("found-in-page", (_e, result) => {
      if (result.finalUpdate) {
        this.events.findResult({ tabId: tab.state.id, activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches });
      }
    });

    // Ctrl + mouse wheel zoom.
    wc.on("zoom-changed", (_e, direction) => this.zoom(tab.state.id, direction));

    // Pages may only navigate to http(s).
    wc.on("will-navigate", (e, url) => {
      if (!isSafeWebUrl(url)) e.preventDefault();
    });
    // Popups / target=_blank open as a new foreground tab when they are safe web URLs.
    wc.on("input-event", (_e, ev) => {
      if (ev.type === "mouseDown" || ev.type === "keyDown" || ev.type === "touchStart") tab.lastGesture = Date.now();
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (!isSafeWebUrl(url)) return { action: "deny" };
      const userInitiated = Date.now() - tab.lastGesture < POPUP_GESTURE_WINDOW_MS;
      if (!userInitiated && this.events.blockPopupsFor(tab.state.url)) {
        tab.state.popupsBlocked++;
        this.events.popupBlocked();
        this.emit();
        return { action: "deny" };
      }
      queueMicrotask(() => this.create(url, true));
      return { action: "deny" };
    });

    // Page-initiated fullscreen (e.g. video players).
    wc.on("enter-html-full-screen", () => {
      this.htmlFullscreenTabId = tab.state.id;
      this.weEnteredWindowFullscreen = !this.window.isFullScreen();
      if (this.weEnteredWindowFullscreen) this.window.setFullScreen(true);
      this.layout();
    });
    wc.on("leave-html-full-screen", () => this.leaveHtmlFullscreen());

    wc.on("context-menu", (_e, params) => this.showContextMenu(tab, wc, params));
  }

  private leaveHtmlFullscreen(): void {
    if (this.htmlFullscreenTabId === null) return;
    this.htmlFullscreenTabId = null;
    if (this.weEnteredWindowFullscreen && !this.window.isDestroyed()) this.window.setFullScreen(false);
    this.weEnteredWindowFullscreen = false;
    this.layout();
  }

  private showContextMenu(tab: Tab, wc: WebContents, params: Electron.ContextMenuParams): void {
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (params.linkURL && isSafeWebUrl(params.linkURL)) {
      items.push(
        { label: "Open link in new tab", click: () => this.create(params.linkURL, false) },
        { label: "Copy link address", click: () => clipboard.writeText(params.linkURL) },
        { type: "separator" },
      );
    }
    if (params.mediaType === "image" && params.srcURL) {
      items.push({ label: "Copy image address", click: () => clipboard.writeText(params.srcURL) }, { type: "separator" });
    }
    if (params.isEditable) {
      items.push(
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      );
    } else if (params.selectionText) {
      items.push({ role: "copy" });
    }
    if (!params.isEditable) {
      items.push(
        { label: "Back", enabled: wc.navigationHistory.canGoBack(), click: () => this.back(tab.state.id) },
        { label: "Forward", enabled: wc.navigationHistory.canGoForward(), click: () => this.forward(tab.state.id) },
        { label: "Reload", click: () => this.reload(tab.state.id) },
      );
    }
    Menu.buildFromTemplate(items).popup({ window: this.window });
  }

  private refreshSecurity(tab: Tab): void {
    const { url, internal, error } = tab.state;
    tab.state.security = internal
      ? "internal"
      : error
        ? "none"
        : url.startsWith("https://")
          ? "secure"
          : url.startsWith("http://")
            ? "insecure"
            : "none";
  }

  private layout(): void {
    const full = this.htmlFullscreenTabId;
    const { x, y, width, height } = this.bounds;
    for (const tab of this.tabs) {
      if (!tab.view) continue;
      const visible = tab.state.id === this.activeId && !tab.state.internal && !tab.state.error && !tab.state.warning && !this.overlayOpen;
      tab.view.setVisible(visible);
      if (!visible) continue;
      if (full === tab.state.id) {
        const b = this.window.contentView.getBounds();
        tab.view.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
      } else {
        tab.view.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
      }
    }
  }

  /** Coalesce bursts of events into a single IPC message per tick. */
  private emit(): void {
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    queueMicrotask(() => {
      this.emitScheduled = false;
      for (const t of this.tabs) t.state.shield = t.state.internal ? "on" : this.events.shieldMode(t.state.url);
      this.events.snapshot(this.snapshot());
      this.events.sessionChanged();
    });
  }
}
