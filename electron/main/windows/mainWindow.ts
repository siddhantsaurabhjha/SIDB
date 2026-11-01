import { BrowserWindow, session, shell } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { IPC } from "../../../shared/ipc/channels";
import type { DataTopic } from "../../../shared/types/data";
import { isSafeWebUrl } from "../../../shared/url";
import { DownloadManager } from "../downloads/DownloadManager";
import { FaviconService } from "../favicons/FaviconService";
import { PermissionManager } from "../permissions/PermissionManager";
import { getProfiles } from "../profiles/instance";
import { peekAi } from "../ai/instance";
import { getShield } from "../shield/instance";
import { TabManager } from "../tabs/TabManager";
import { mark } from "../perf/marks";
import { backgroundFor, overlayFor } from "./appearance";
import { isUiUrl, registerContext, unregisterContext, type WindowContext } from "./registry";
import { UI_URL } from "../../../shared/uiUrl";

const DEV_URL = process.env.SIDB_DEV_URL;
const SESSION_SAVE_DEBOUNCE_MS = 1500;

export interface WindowOptions {
  isPrivate?: boolean;
  /** Profile to open. Defaults to the first profile. */
  profileId?: string;
}

export async function createMainWindow({ isPrivate = false, profileId }: WindowOptions = {}): Promise<BrowserWindow> {
  const profiles = getProfiles();
  const profile = await profiles.runtime(profileId ?? profiles.defaultProfileId());

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 520,
    show: false,
    backgroundColor: backgroundFor(isPrivate),
    title: isPrivate ? "SIDB (Private)" : `SIDB - ${profile.info.name}`,
    icon: path.join(__dirname, "../../resources/icons/icon.png"),
    titleBarStyle: "hidden",
    titleBarOverlay: overlayFor(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // The privileged UI window must never navigate away or open windows of its own.
  win.webContents.on("will-navigate", (e, url) => {
    if (!isUiUrl(url)) e.preventDefault();
  });
  win.webContents.on("will-redirect", (e, url) => {
    if (!isUiUrl(url)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeWebUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  const sendToUi = (channel: string, payload: unknown) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
  };
  const sendTopic = (topic: DataTopic) => sendToUi(IPC.evData, topic);

  // Private windows get a throwaway in-memory session (no "persist:" prefix), never shared with normal browsing.
  const webSession = isPrivate ? session.fromPartition(`private-${randomUUID()}`) : profile.session;
  if (isPrivate) {
    getShield().attachSession(webSession, profile); // same Shield rules and exceptions as the profile
  }
  // Private windows read the profile's icon cache but keep anything new in memory, so private visits leave no trace on disk.
  const favicons = isPrivate ? new FaviconService({ dir: null, parent: profile.favicons }) : profile.favicons;
  const downloads = isPrivate ? new DownloadManager(webSession, null, () => profile.settings.getAll(), () => sendTopic("downloads")) : profile.downloads;

  // eslint-disable-next-line prefer-const -- tabs and permissions reference each other
  let tabs: TabManager;
  const permissions = new PermissionManager(
    webSession,
    (wc) => tabs.tabIdFor(wc),
    (prompts) => sendToUi(IPC.evPermissions, prompts),
    isPrivate
      ? null
      : {
          load: () => profile.sitePermissions.list(),
          save: (origin, kind, decision) => profile.sitePermissions.set(origin, kind, decision),
        },
    (tabId) => tabs.noteCapture(tabId),
  );

  let sessionReady = false; // don't overwrite the saved session before startup restore has run
  let saveTimer: NodeJS.Timeout | null = null;
  const saveSessionNow = () => {
    if (isPrivate || !sessionReady) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    void profile.sessions.save(tabs.sessionTabs(), tabs.sessionGroups()).catch(() => undefined);
  };

  tabs = new TabManager(
    win,
    webSession,
    {
      snapshot: (s) => sendToUi(IPC.evTabsState, s),
      findResult: (r) => sendToUi(IPC.evFindResult, r),
      command: (c) => sendToUi(IPC.evCommand, c),
      tabReset: (id) => permissions.dropForTab(id),
      newPrivateWindow: () => void createMainWindow({ isPrivate: true, profileId: profile.info.id }),
      searchEngine: () => profile.settings.peek().searchEngine,
      // Nothing about a private window is ever written to the profile database.
      visited: (url, title) => {
        if (isPrivate) return;
        void profile.history
          .record(url, title)
          .then(() => profile.emit("history"))
          .catch(() => undefined);
      },
      titleUpdated: (url, title) => {
        if (!isPrivate) void profile.history.updateMeta(url, { title }).catch(() => undefined);
      },
      tabClosed: (url, title) => {
        if (!isPrivate) void profile.sessions.addClosed(url, title).then(() => profile.emit("history")).catch(() => undefined);
      },
      sessionChanged: () => {
        if (isPrivate || !sessionReady) return;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(saveSessionNow, SESSION_SAVE_DEBOUNCE_MS);
      },
      shieldMode: (pageUrl) => {
        if (!profile.settings.peek().shieldEnabled) return "off";
        try {
          return profile.shieldData.isException(new URL(pageUrl).hostname) ? "site-off" : "on";
        } catch {
          return "on";
        }
      },
      blockPopupsFor: (pageUrl) => {
        const s = profile.settings.peek();
        if (!s.shieldEnabled || !s.blockPopups) return false;
        try {
          return !profile.shieldData.isException(new URL(pageUrl).hostname);
        } catch {
          return true;
        }
      },
      popupBlocked: () => getShield().noteBlockedPopup(profile),
      allowUnsafe: (url) => getShield().allowUnsafe(url),
      favicons: (pageUrl, urls) => void favicons.learn(pageUrl, urls),
      renameGroup: (groupId) => sendToUi(IPC.evRenameGroup, groupId),
      overlay: (snapshot) => sendToUi(IPC.evOverlay, snapshot),
      reopenClosed: () => {
        if (isPrivate) return;
        void profile.sessions
          .takeClosed()
          .then((t) => {
            if (t) tabs.create(t.url, true);
          })
          .catch(() => undefined);
      },
    },
    isPrivate,
  );

  const ctx: WindowContext = { win, tabs, permissions, profile, downloads, favicons, isPrivate };
  registerContext(ctx);

  const offData = profile.subscribe(sendTopic);
  const offGlobal = profiles.onGlobalChange(sendTopic);

  // Shortcuts also need to work while the SIDB UI itself has focus.
  win.webContents.on("before-input-event", (event, input) => {
    if (tabs.handleInput(input)) event.preventDefault();
  });

  win.once("ready-to-show", () => {
    mark(`window-shown${isPrivate ? "-private" : ""}`);
    win.show();
  });
  // Read now: once the window is destroyed, touching win.webContents throws.
  const uiContentsId = win.webContents.id;
  win.on("close", saveSessionNow);
  win.on("closed", () => {
    peekAi()?.abortWindow(uiContentsId);
    unregisterContext(ctx);
    offData();
    offGlobal();
    tabs.dispose();
    if (isPrivate) {
      // Wipe everything the private session held. Downloaded files on disk are left alone.
      // A response still in flight at close can set a cookie after the first wipe, so wipe once more shortly after.
      const wipe = () => {
        void webSession.clearStorageData().catch(() => undefined);
        void webSession.clearCache().catch(() => undefined);
        void webSession.clearAuthCache().catch(() => undefined);
        void webSession.clearHostResolverCache().catch(() => undefined);
      };
      wipe();
      setTimeout(wipe, 2000).unref();
    }
  });

  win.webContents.once("did-finish-load", () => {
    mark(`ui-loaded${isPrivate ? "-private" : ""}`);
    void (async () => {
      let opened = false;
      if (!isPrivate) {
        const settings = await profile.settings.getAll();
        if (settings.startup === "restore") {
          opened = tabs.restore(await profile.sessions.load(), await profile.sessions.loadGroups());
        } else if (settings.startup === "urls" && settings.startupUrls.length > 0) {
          settings.startupUrls.slice(0, 10).forEach((u, i) => tabs.create(u, i === 0));
          opened = true;
        }
      }
      if (!opened && tabs.snapshot().tabs.length === 0) tabs.create("sidb://newtab", true);
      sessionReady = true;
      mark(`tabs-ready${isPrivate ? "-private" : ""}`);
    })();
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadURL(UI_URL);

  return win;
}
