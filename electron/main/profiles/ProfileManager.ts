import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app, session as electronSession, type Session } from "electron";
import type { DataTopic, ProfileInfo } from "../../../shared/types/data";
import { openDatabase, type Db } from "../db/database";
import { FaviconService } from "../favicons/FaviconService";
import { applyDns } from "../shield/network";
import { applyTheme } from "../windows/appearance";
import { getShield } from "../shield/instance";
import { DownloadManager } from "../downloads/DownloadManager";
import { AiConversationsService } from "../services/AiConversationsService";
import { BackupService } from "../services/BackupService";
import { BookmarksService } from "../services/BookmarksService";
import { DownloadsService } from "../services/DownloadsService";
import { HistoryService } from "../services/HistoryService";
import { SessionService, ShortcutsService } from "../services/SessionService";
import { SettingsService } from "../services/SettingsService";
import { ShieldDataService } from "../services/ShieldDataService";
import { SitePermissionsService } from "../services/SitePermissionsService";

const COLORS = ["#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];
const AUTO_BACKUP_EVERY_MS = 24 * 3600_000;
const AUTO_BACKUP_DELAY_MS = 60_000; // stay out of the way of startup and early browsing

export interface ProfileRuntime {
  info: ProfileInfo;
  /** Folder holding this profile's database, browser data, backups and wallpaper. */
  dir: string;
  db: Db;
  session: Session;
  settings: SettingsService;
  bookmarks: BookmarksService;
  history: HistoryService;
  shortcuts: ShortcutsService;
  sessions: SessionService;
  sitePermissions: SitePermissionsService;
  shieldData: ShieldDataService;
  aiConversations: AiConversationsService;
  /** Website icons for this profile, cached in its own folder. */
  favicons: FaviconService;
  backup: BackupService;
  downloadsStore: DownloadsService;
  downloads: DownloadManager;
  /** Subscribe to data changes made in this profile. Returns an unsubscribe function. */
  subscribe(listener: (topic: DataTopic) => void): () => void;
  emit(topic: DataTopic): void;
}

/** Profile root: <userData>/profiles/<id>/{browser-data, sidb.db, backups}. Paths come from the OS app-data location. */
export class ProfileManager {
  private readonly root = path.join(app.getPath("userData"), "profiles");
  private readonly indexFile = path.join(app.getPath("userData"), "profiles.json");
  private runtimes = new Map<string, Promise<ProfileRuntime>>();
  private listeners = new Set<(topic: DataTopic) => void>();

  list(): ProfileInfo[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexFile, "utf8")) as ProfileInfo[];
      const valid = parsed.filter((p) => typeof p.id === "string" && /^[a-z0-9-]{1,64}$/.test(p.id) && typeof p.name === "string");
      if (valid.length) return valid;
    } catch {
      /* first run or unreadable index: fall through to default */
    }
    const initial: ProfileInfo[] = [{ id: "personal", name: "Personal", color: COLORS[0] }];
    this.writeIndex(initial);
    return initial;
  }

  defaultProfileId(): string {
    return this.list()[0].id;
  }

  create(name: string): ProfileInfo {
    const clean = name.trim().slice(0, 30);
    if (!clean) throw new Error("Profile name is required");
    const profiles = this.list();
    if (profiles.some((p) => p.name.toLowerCase() === clean.toLowerCase())) throw new Error("A profile with that name already exists");
    const info: ProfileInfo = { id: `p-${randomUUID().slice(0, 8)}`, name: clean, color: COLORS[profiles.length % COLORS.length] };
    this.writeIndex([...profiles, info]);
    this.broadcast("profiles");
    return info;
  }

  /** Tell every open window that global (not per-profile) data changed. */
  broadcast(topic: DataTopic): void {
    this.listeners.forEach((l) => l(topic));
  }

  onGlobalChange(listener: (topic: DataTopic) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private writeIndex(profiles: ProfileInfo[]): void {
    fs.mkdirSync(path.dirname(this.indexFile), { recursive: true });
    const tmp = `${this.indexFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(profiles, null, 2));
    fs.renameSync(tmp, this.indexFile); // atomic replace
  }

  runtime(id: string): Promise<ProfileRuntime> {
    let existing = this.runtimes.get(id);
    if (!existing) {
      existing = this.create_(id);
      this.runtimes.set(id, existing);
      existing.catch(() => this.runtimes.delete(id));
    }
    return existing;
  }

  private async create_(id: string): Promise<ProfileRuntime> {
    const info = this.list().find((p) => p.id === id);
    if (!info) throw new Error(`Unknown profile ${id}`);

    const dir = path.join(this.root, info.id);
    const browserData = path.join(dir, "browser-data");
    fs.mkdirSync(browserData, { recursive: true });
    fs.mkdirSync(path.join(dir, "backups"), { recursive: true });

    const migrations = path.join(app.getAppPath(), "database", "migrations");
    const db = await openDatabase(path.join(dir, "sidb.db"), migrations);

    const listeners = new Set<(topic: DataTopic) => void>();
    const emit = (topic: DataTopic) => listeners.forEach((l) => l(topic));

    const settings = new SettingsService(db);
    await settings.getAll();
    const shieldData = new ShieldDataService(db);
    await shieldData.load();
    void shieldData.pruneStats().catch(() => undefined);
    const favicons = new FaviconService({ dir: path.join(dir, "favicons") });
    setTimeout(() => favicons.prune(), 30_000).unref(); // keep the cache small, without slowing startup
    const downloadsStore = new DownloadsService(db);
    await downloadsStore.failStale();

    // Chromium cookies, cache and site storage live inside this profile's own folder.
    const ses = electronSession.fromPath(browserData);
    const downloads = new DownloadManager(ses, downloadsStore, () => settings.getAll(), () => emit("downloads"));
    const backup = new BackupService(db, path.join(dir, "backups"));

    const runtime: ProfileRuntime = {
      info,
      dir,
      db,
      session: ses,
      settings,
      bookmarks: new BookmarksService(db),
      history: new HistoryService(db),
      shortcuts: new ShortcutsService(db),
      sessions: new SessionService(db),
      sitePermissions: new SitePermissionsService(db),
      shieldData,
      aiConversations: new AiConversationsService(db),
      favicons,
      backup,
      downloadsStore,
      downloads,
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      emit,
    };

    getShield().attachSession(ses, runtime); // the user agent comes from the app-wide default (applyUserAgent)
    const initial = await settings.getAll();
    applyDns(initial);
    applyTheme(initial.theme);

    // Daily automatic backup, started late so it never competes with startup.
    const timer = setTimeout(async () => {
      try {
        const last = await backup.lastAutoBackupAt();
        if (!last || Date.now() - last > AUTO_BACKUP_EVERY_MS) await backup.create("auto");
      } catch (e) {
        console.warn("[sidb] automatic backup failed:", e instanceof Error ? e.message : e);
      }
    }, AUTO_BACKUP_DELAY_MS);
    timer.unref();

    return runtime;
  }

  /** Closes databases cleanly on quit. */
  async closeAll(): Promise<void> {
    for (const p of this.runtimes.values()) {
      try {
        (await p).db.close();
      } catch {
        /* already closed */
      }
    }
  }
}
