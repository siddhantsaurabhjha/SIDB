import fs from "node:fs";
import { dialog, ipcMain } from "electron";
import { z } from "zod";
import { IPC } from "../../../shared/ipc/channels";
import type { DataMethod, HistoryRange } from "../../../shared/ipc/dataApi";
import { AI_MODEL_PATTERN, type AiStatus } from "../../../shared/types/ai";
import { settingsSchema } from "../../../shared/types/data";
import { getProfiles } from "../profiles/instance";
import { getAi, NVIDIA_KEY_SECRET } from "../ai/instance";
import { capturePage, copyImage, saveImage } from "../capture/capture";
import { clearWallpaper, pickWallpaper, readWallpaper } from "../capture/wallpaper";
import { applyTheme } from "../windows/appearance";
import { modelExists } from "../ai/NvidiaClient";
import { getSecrets, getShield } from "../shield/instance";
import { RemoteSuggestions } from "../suggest/RemoteSuggestions";
import { MAX_QUERY_LENGTH, rankLocal, rankZeroInput, type SourceRow } from "../../../shared/suggest";
import { applyDns } from "../shield/network";
import { SAFE_BROWSING_SECRET } from "../shield/ShieldService";
import { startOfLocalDay } from "../services/HistoryService";
import { createMainWindow } from "../windows/mainWindow";
import { setHardwareAcceleration } from "../resources/gpu";
import { getResourceMonitor } from "../resources/ResourceMonitor";
import { getUpdates } from "../updates/UpdateChecker";
import { findWindowForProfile, trustedContext, type WindowContext } from "../windows/registry";

const id = z.string().min(1).max(64);
const none = z.undefined().or(z.object({}).strict());
const range = z.enum(["all", "today", "week", "month"]);
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

function rangeStart(r: HistoryRange): number | undefined {
  const now = Date.now();
  if (r === "today") return startOfLocalDay(now);
  if (r === "week") return now - 7 * 86_400_000;
  if (r === "month") return now - 30 * 86_400_000;
  return undefined;
}

function emitAll(ctx: WindowContext): void {
  for (const t of ["bookmarks", "history", "downloads", "settings", "shortcuts"] as const) ctx.profile.emit(t);
}

interface Entry {
  schema: z.ZodType;
  run: (ctx: WindowContext, arg: any) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any -- validated by `schema`
}

const remoteSuggestions = new RemoteSuggestions();

const methods: Record<DataMethod, Entry> = {
  "bookmarks.list": { schema: z.object({ query: z.string().max(200).optional() }).optional(), run: (c, a) => c.profile.bookmarks.list(a?.query) },
  "bookmarks.findByUrl": { schema: z.object({ url: z.string().max(4096) }), run: (c, a) => c.profile.bookmarks.findByUrl(a.url) },
  "bookmarks.add": {
    schema: z.object({ title: z.string().max(500), url: z.string().max(4096), folderId: id.nullable().optional(), favicon: z.string().max(4096).nullable().optional() }),
    run: async (c, a) => {
      const r = await c.profile.bookmarks.add(a);
      c.profile.emit("bookmarks");
      return r;
    },
  },
  "bookmarks.update": {
    schema: z.object({
      id,
      patch: z.object({
        title: z.string().max(500).optional(),
        url: z.string().max(4096).optional(),
        folderId: id.nullable().optional(),
        pinned: z.boolean().optional(),
        favorite: z.boolean().optional(),
      }),
    }),
    run: async (c, a) => {
      await c.profile.bookmarks.update(a.id, a.patch);
      c.profile.emit("bookmarks");
    },
  },
  "bookmarks.remove": {
    schema: z.object({ id }),
    run: async (c, a) => {
      await c.profile.bookmarks.remove(a.id);
      c.profile.emit("bookmarks");
    },
  },
  "bookmarks.createFolder": {
    schema: z.object({ name: z.string().max(200), parentId: id.nullable().optional() }),
    run: async (c, a) => {
      const f = await c.profile.bookmarks.createFolder(a.name, a.parentId ?? null);
      c.profile.emit("bookmarks");
      return f;
    },
  },
  "bookmarks.renameFolder": {
    schema: z.object({ id, name: z.string().max(200) }),
    run: async (c, a) => {
      await c.profile.bookmarks.renameFolder(a.id, a.name);
      c.profile.emit("bookmarks");
    },
  },
  "bookmarks.removeFolder": {
    schema: z.object({ id }),
    run: async (c, a) => {
      await c.profile.bookmarks.removeFolder(a.id);
      c.profile.emit("bookmarks");
    },
  },
  "bookmarks.importHtml": {
    schema: none,
    run: async (c) => {
      const pick = await dialog.showOpenDialog(c.win, { title: "Import bookmarks", filters: [{ name: "Bookmarks HTML", extensions: ["html", "htm"] }], properties: ["openFile"] });
      const file = pick.filePaths[0];
      if (pick.canceled || !file) return null;
      if (fs.statSync(file).size > MAX_IMPORT_BYTES) throw new Error("Bookmark file is too large");
      const result = await c.profile.bookmarks.importHtml(fs.readFileSync(file, "utf8"));
      c.profile.emit("bookmarks");
      return result;
    },
  },
  "bookmarks.exportHtml": {
    schema: none,
    run: async (c) => {
      const pick = await dialog.showSaveDialog(c.win, { title: "Export bookmarks", defaultPath: "sidb-bookmarks.html", filters: [{ name: "Bookmarks HTML", extensions: ["html"] }] });
      if (pick.canceled || !pick.filePath) return null;
      fs.writeFileSync(pick.filePath, await c.profile.bookmarks.exportHtml(), "utf8");
      return pick.filePath;
    },
  },

  "history.list": {
    schema: z.object({ query: z.string().max(200).optional(), range: range.optional(), limit: z.number().int().min(1).max(1000).optional(), offset: z.number().int().min(0).optional() }).optional(),
    run: (c, a) => c.profile.history.list({ query: a?.query, from: rangeStart(a?.range ?? "all"), limit: a?.limit, offset: a?.offset }),
  },
  "history.remove": {
    schema: z.object({ ids: z.array(id).max(5000) }),
    run: async (c, a) => {
      await c.profile.history.remove(a.ids);
      c.profile.emit("history");
    },
  },
  "history.clear": {
    schema: z.object({ range }),
    run: async (c, a) => {
      await c.profile.history.clearRange(rangeStart(a.range));
      c.profile.emit("history");
    },
  },
  "history.stats": { schema: none, run: (c) => c.profile.history.stats() },
  "history.recentlyClosed": { schema: none, run: (c) => c.profile.sessions.listClosed() },
  "history.reopenClosed": {
    schema: z.object({ id: id.optional() }).optional(),
    run: async (c, a) => {
      const tab = await c.profile.sessions.takeClosed(a?.id);
      if (tab) c.tabs.create(tab.url, true);
    },
  },

  "downloads.list": { schema: none, run: (c) => c.downloads.list() },
  "downloads.pause": { schema: z.object({ id }), run: (c, a) => c.downloads.pause(a.id) },
  "downloads.resume": { schema: z.object({ id }), run: (c, a) => c.downloads.resume(a.id) },
  "downloads.cancel": { schema: z.object({ id }), run: (c, a) => c.downloads.cancel(a.id) },
  "downloads.retry": { schema: z.object({ id }), run: (c, a) => c.downloads.retry(a.id) },
  "downloads.open": { schema: z.object({ id }), run: (c, a) => c.downloads.open(a.id) },
  "downloads.reveal": { schema: z.object({ id }), run: (c, a) => c.downloads.reveal(a.id) },
  "downloads.remove": { schema: z.object({ id }), run: (c, a) => c.downloads.remove(a.id) },
  "downloads.clearFinished": { schema: none, run: (c) => c.downloads.clearFinished() },
  "downloads.chooseFolder": {
    schema: none,
    run: async (c) => {
      const pick = await dialog.showOpenDialog(c.win, { title: "Choose download folder", properties: ["openDirectory", "createDirectory"] });
      return pick.canceled ? null : (pick.filePaths[0] ?? null);
    },
  },

  "settings.get": { schema: none, run: (c) => c.profile.settings.getAll() },
  "settings.set": {
    schema: z.object({ patch: settingsSchema.partial() }),
    run: async (c, a) => {
      const next = await c.profile.settings.set(a.patch);
      if (a.patch.secureDns !== undefined || a.patch.secureDnsProvider !== undefined) applyDns(next);
      if (a.patch.theme !== undefined) applyTheme(next.theme);
      if (a.patch.newTabBackground !== undefined) c.profile.emit("appearance");
      c.profile.emit("settings");
      c.profile.emit("shield");
      return next;
    },
  },

  "ai.status": {
    schema: none,
    run: async (c): Promise<AiStatus> => {
      const wc = c.tabs.activeWebContents();
      let page: AiStatus["page"] = null;
      if (wc && !c.isPrivate) {
        try {
          page = { title: wc.getTitle(), host: new URL(wc.getURL()).hostname.replace(/^www\./, "") };
        } catch {
          page = null;
        }
      }
      return { keySet: getSecrets().has(NVIDIA_KEY_SECRET), secureStorage: await getSecrets().isAvailable(), model: c.profile.settings.peek().aiModel, pageContextAllowed: !c.isPrivate, page };
    },
  },
  "ai.setKey": {
    schema: z.object({ key: z.string().trim().min(10).max(300).regex(/^[\w.~+/=-]+$/, "That does not look like an API key") }),
    run: async (c, a) => {
      await getSecrets().set(NVIDIA_KEY_SECRET, a.key);
      c.profile.emit("settings");
    },
  },
  "ai.clearKey": {
    schema: none,
    run: (c) => {
      getSecrets().delete(NVIDIA_KEY_SECRET);
      c.profile.emit("settings");
    },
  },
  "ai.test": { schema: none, run: (c) => getAi().test({ model: c.profile.settings.peek().aiModel, windowId: c.win.webContents.id }) },
  "ai.modelExists": { schema: z.object({ model: z.string().max(100).regex(AI_MODEL_PATTERN) }), run: (_c, a) => modelExists(a.model) },
  "ai.conversations": { schema: none, run: (c) => c.profile.aiConversations.list() },
  "ai.messages": { schema: z.object({ id }), run: (c, a) => c.profile.aiConversations.messages(a.id) },
  "ai.deleteConversation": {
    schema: z.object({ id }),
    run: async (c, a) => {
      await c.profile.aiConversations.remove(a.id);
      c.profile.emit("ai");
    },
  },
  "ai.clearConversations": {
    schema: none,
    run: async (c) => {
      await c.profile.aiConversations.clearAll();
      c.profile.emit("ai");
    },
  },

  "capture.page": { schema: z.object({ mode: z.enum(["visible", "full"]), dest: z.enum(["file", "clipboard"]) }), run: (c, a) => capturePage(c, a.mode, a.dest) },
  "capture.saveImage": { schema: z.object({ dataUrl: z.string().max(20_000_000), name: z.string().max(100) }), run: (c, a) => saveImage(c, a.dataUrl, a.name) },
  "capture.copyImage": { schema: z.object({ dataUrl: z.string().max(20_000_000) }), run: (_c, a) => copyImage(a.dataUrl) },
  "appearance.pickWallpaper": {
    schema: none,
    run: async (c) => {
      const r = await pickWallpaper(c);
      if (r.ok) {
        await c.profile.settings.set({ newTabBackground: "custom" });
        c.profile.emit("settings");
        c.profile.emit("appearance");
      }
      return r;
    },
  },
  "appearance.wallpaper": { schema: none, run: (c) => readWallpaper(c.profile.dir) },
  "appearance.clearWallpaper": {
    schema: none,
    run: async (c) => {
      clearWallpaper(c.profile.dir);
      if (c.profile.settings.peek().newTabBackground === "custom") await c.profile.settings.set({ newTabBackground: "scenery" });
      c.profile.emit("settings");
      c.profile.emit("appearance");
    },
  },

  "favicon.get": {
    schema: z.object({ url: z.string().max(2048), hint: z.string().max(2048).nullish() }),
    run: (c, a) => c.favicons.get(a.url, a.hint ? [a.hint] : []),
  },
  "favicon.clear": { schema: none, run: (c) => c.profile.favicons.clear() },
  "suggest.local": {
    schema: z.object({ query: z.string().max(MAX_QUERY_LENGTH) }),
    run: async (c, a) => {
      const q = a.query.trim();
      // Private windows never read the profile's browsing history; bookmarks are the user's own saved list.
      const history: SourceRow[] = c.isPrivate ? [] : q ? await c.profile.history.suggest(q) : await c.profile.history.mostVisited();
      const bookmarks: SourceRow[] = (await c.profile.bookmarks.list(q || undefined)).bookmarks.slice(0, q ? 40 : 8);
      const now = Date.now();
      return q ? rankLocal(q, history, bookmarks, now) : rankZeroInput(history, bookmarks, now);
    },
  },
  "suggest.remote": {
    schema: z.object({ query: z.string().max(MAX_QUERY_LENGTH) }),
    run: async (c, a) => {
      if (!c.profile.settings.peek().searchSuggestions) return { suggestions: [], error: "disabled" as const };
      return remoteSuggestions.fetch(c.win.webContents.id, c.profile.settings.peek().searchEngine, a.query);
    },
  },
  "suggest.cancelRemote": { schema: none, run: (c) => remoteSuggestions.cancel(c.win.webContents.id) },

  "updates.status": { schema: none, run: () => getUpdates().status() },
  "updates.check": { schema: none, run: () => getUpdates().check() },
  "updates.setAutoCheck": { schema: z.object({ enabled: z.boolean() }), run: (_c, a) => getUpdates().setAutoCheck(a.enabled) },
  "updates.openRelease": {
    schema: none,
    run: (c) => {
      const url = getUpdates().releaseUrl(); // validated: a github.com release page of the configured repository
      if (!url) return false;
      c.tabs.create(url, true);
      return true;
    },
  },
  "compat.continueSigninExternally": { schema: z.object({ id: z.string().uuid() }), run: (c, a) => c.tabs.continueSigninExternally(a.id) },
  "compat.dismissNotice": { schema: z.object({ id: z.string().uuid() }), run: (c, a) => c.tabs.dismissNotice(a.id) },
  "resources.summary": { schema: none, run: () => getResourceMonitor().summary() },
  "resources.stats": { schema: none, run: (c) => getResourceMonitor().stats(c) },
  "resources.sleepTab": { schema: z.object({ id: z.string().uuid() }), run: (c, a) => c.tabs.sleep(a.id) },
  "resources.sleepBackground": { schema: none, run: (c) => c.tabs.sleepBackground() },
  "resources.setHardwareAcceleration": {
    schema: z.object({ enabled: z.boolean() }),
    run: (_c, a) => {
      setHardwareAcceleration(a.enabled);
      getProfiles().broadcast("resources");
    },
  },

  "shield.status": { schema: none, run: (c) => getShield().status(c.profile) },
  "shield.updateNow": { schema: none, run: () => getShield().update(true) },
  "shield.setListEnabled": { schema: z.object({ id, enabled: z.boolean() }), run: (_c, a) => getShield().setListEnabled(a.id, a.enabled) },
  "shield.exceptions": { schema: none, run: (c) => c.profile.shieldData.listExceptions() },
  "shield.addException": {
    schema: z.object({ host: z.string().min(1).max(253) }),
    run: async (c, a) => {
      const host = await c.profile.shieldData.addException(a.host);
      c.profile.emit("shield");
      return host;
    },
  },
  "shield.removeException": {
    schema: z.object({ host: z.string().min(1).max(253) }),
    run: async (c, a) => {
      await c.profile.shieldData.removeException(a.host);
      c.profile.emit("shield");
    },
  },
  "shield.setSafeBrowsingKey": {
    schema: z.object({ key: z.string().trim().min(10).max(200).regex(/^[\w-]+$/, "That does not look like an API key") }),
    run: async (c, a) => {
      await getSecrets().set(SAFE_BROWSING_SECRET, a.key);
      c.profile.emit("shield");
    },
  },
  "shield.clearSafeBrowsingKey": {
    schema: none,
    run: (c) => {
      getSecrets().delete(SAFE_BROWSING_SECRET);
      c.profile.emit("shield");
    },
  },

  "shortcuts.list": { schema: none, run: (c) => c.profile.shortcuts.list() },
  "shortcuts.add": {
    schema: z.object({ title: z.string().max(100), url: z.string().max(4096) }),
    run: async (c, a) => {
      const s = await c.profile.shortcuts.add(a.title, a.url);
      c.profile.emit("shortcuts");
      return s;
    },
  },
  "shortcuts.update": {
    schema: z.object({ id, title: z.string().max(100).optional(), url: z.string().max(4096).optional() }),
    run: async (c, a) => {
      await c.profile.shortcuts.update(a.id, { title: a.title, url: a.url });
      c.profile.emit("shortcuts");
    },
  },
  "shortcuts.remove": {
    schema: z.object({ id }),
    run: async (c, a) => {
      await c.profile.shortcuts.remove(a.id);
      c.profile.emit("shortcuts");
    },
  },
  "shortcuts.reorder": {
    schema: z.object({ ids: z.array(id).max(200) }),
    run: async (c, a) => {
      await c.profile.shortcuts.reorder(a.ids);
      c.profile.emit("shortcuts");
    },
  },

  "profiles.list": { schema: none, run: (c) => ({ profiles: getProfiles().list(), currentId: c.profile.info.id }) },
  "profiles.create": { schema: z.object({ name: z.string().min(1).max(30) }), run: (_c, a) => getProfiles().create(a.name) },
  "profiles.open": {
    schema: z.object({ id }),
    run: async (_c, a) => {
      const existing = findWindowForProfile(a.id);
      if (existing) {
        if (existing.win.isMinimized()) existing.win.restore();
        existing.win.focus();
      } else {
        await createMainWindow({ profileId: a.id });
      }
    },
  },

  "backup.list": { schema: none, run: (c) => c.profile.backup.list() },
  "backup.create": {
    schema: none,
    run: async (c) => {
      const info = await c.profile.backup.create("manual");
      c.profile.emit("settings"); // refreshes the backup list
      return info;
    },
  },
  "backup.exportTo": {
    schema: none,
    run: async (c) => {
      const pick = await dialog.showSaveDialog(c.win, { title: "Export profile data", defaultPath: `sidb-${c.profile.info.name}-backup.db`, filters: [{ name: "SIDB backup", extensions: ["db"] }] });
      if (pick.canceled || !pick.filePath) return null;
      c.profile.backup.exportTo(pick.filePath);
      return pick.filePath;
    },
  },
  "backup.importFrom": {
    schema: none,
    run: async (c) => {
      const pick = await dialog.showOpenDialog(c.win, { title: "Import profile data", filters: [{ name: "SIDB backup", extensions: ["db"] }], properties: ["openFile"] });
      const file = pick.filePaths[0];
      if (pick.canceled || !file) return false;
      const confirm = await dialog.showMessageBox(c.win, {
        type: "warning",
        buttons: ["Replace my data", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        title: "Import backup",
        message: `Replace the data in profile "${c.profile.info.name}"?`,
        detail: "Bookmarks, history, download records, settings, shortcuts and site permissions will be replaced by the backup. A safety copy of the current data is saved first. Cookies and logins are not affected.",
      });
      if (confirm.response !== 0) return false;
      await c.profile.backup.importFrom(file);
      c.profile.settings.invalidate();
      await c.profile.settings.getAll();
      emitAll(c);
      return true;
    },
  },
};

export function registerDataHandlers(): void {
  ipcMain.handle(IPC.dataCall, async (event, name: unknown, raw: unknown) => {
    const ctx = trustedContext(event);
    if (!ctx) throw new Error("Untrusted IPC sender");
    if (typeof name !== "string" || !Object.hasOwn(methods, name)) throw new Error("Unknown data method");
    const entry = methods[name as DataMethod];
    return entry.run(ctx, entry.schema.parse(raw));
  });
}
