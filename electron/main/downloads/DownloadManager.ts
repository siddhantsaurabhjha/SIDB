import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app, shell, type DownloadItem as ElectronDownload, type Session } from "electron";
import type { DownloadItem, Settings } from "../../../shared/types/data";
import { DownloadsService, riskWarningFor, uniquePath } from "../services/DownloadsService";

interface Live {
  item: DownloadItem;
  handle: ElectronDownload;
  lastBytes: number;
  lastTime: number;
}

/**
 * Handles Chromium downloads for one session. Metadata goes to SQLite for normal profiles;
 * private sessions keep an in-memory list only. Files are never executed and never auto-deleted.
 */
export class DownloadManager {
  private live = new Map<string, Live>();
  private memory = new Map<string, DownloadItem>(); // private sessions only
  private notifyTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly session: Session,
    private readonly store: DownloadsService | null,
    private readonly getSettings: () => Promise<Settings>,
    private readonly notify: () => void,
  ) {
    this.session.on("will-download", (event, handle, webContents) => {
      void this.begin(event, handle, webContents?.getURL());
    });
  }

  private async begin(_event: Electron.Event, handle: ElectronDownload, _origin?: string): Promise<void> {
    const settings = await this.getSettings().catch(() => null);
    const dir = settings?.downloadDir && fs.existsSync(settings.downloadDir) ? settings.downloadDir : app.getPath("downloads");
    const sourceUrl = handle.getURL();
    const safeName = path.basename(handle.getFilename()) || "download";

    // Electron shows its own Save dialog when no save path is set.
    let savePath = "";
    if (!settings?.askWhereToSave) {
      savePath = uniquePath(dir, safeName);
      handle.setSavePath(savePath);
    }

    const item: DownloadItem = {
      id: randomUUID(),
      fileName: safeName,
      savePath,
      sourceUrl,
      mimeType: handle.getMimeType() || null,
      totalBytes: handle.getTotalBytes(),
      receivedBytes: 0,
      state: "in_progress",
      riskWarning: riskWarningFor(safeName, sourceUrl),
      startedAt: Date.now(),
      completedAt: null,
      speed: 0,
      exists: false,
    };
    const entry: Live = { item, handle, lastBytes: 0, lastTime: Date.now() };
    this.live.set(item.id, entry);
    if (this.store) await this.store.insert(item).catch(() => undefined);
    else this.memory.set(item.id, item);
    this.scheduleNotify();

    handle.on("updated", (_e, state) => {
      const now = Date.now();
      const received = handle.getReceivedBytes();
      const elapsed = (now - entry.lastTime) / 1000;
      if (elapsed >= 0.5) {
        item.speed = Math.max(0, (received - entry.lastBytes) / elapsed);
        entry.lastBytes = received;
        entry.lastTime = now;
      }
      item.receivedBytes = received;
      item.totalBytes = handle.getTotalBytes();
      const savedPath = handle.getSavePath();
      if (savedPath) {
        item.savePath = savedPath;
        item.fileName = path.basename(savedPath);
      }
      item.state = state === "interrupted" ? "failed" : handle.isPaused() ? "paused" : "in_progress";
      this.scheduleNotify();
    });

    handle.once("done", (_e, state) => {
      const savedPath = handle.getSavePath();
      if (savedPath) {
        item.savePath = savedPath;
        item.fileName = path.basename(savedPath);
      }
      item.receivedBytes = handle.getReceivedBytes();
      item.totalBytes = handle.getTotalBytes() || item.receivedBytes;
      item.speed = 0;
      item.state = state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : "failed";
      item.completedAt = item.state === "completed" ? Date.now() : null;
      item.exists = item.state === "completed" && fs.existsSync(item.savePath);
      this.live.delete(item.id);
      if (this.store) {
        void this.store
          .update(item.id, {
            savePath: item.savePath,
            fileName: item.fileName,
            totalBytes: item.totalBytes,
            receivedBytes: item.receivedBytes,
            state: item.state,
            completedAt: item.completedAt,
          })
          .catch(() => undefined);
      } else {
        this.memory.set(item.id, { ...item });
      }
      this.scheduleNotify();
    });
  }

  async list(): Promise<DownloadItem[]> {
    const base = this.store ? await this.store.list() : [...this.memory.values()].sort((a, b) => b.startedAt - a.startedAt);
    return base.map((row) => {
      const live = this.live.get(row.id);
      return live ? { ...live.item } : row;
    });
  }

  pause(id: string): void {
    this.live.get(id)?.handle.pause();
  }
  resume(id: string): void {
    const h = this.live.get(id)?.handle;
    if (h?.canResume()) h.resume();
  }
  cancel(id: string): void {
    this.live.get(id)?.handle.cancel();
  }

  /** Only reveals/opens files the user downloaded; the path comes from our own records, not from the renderer. */
  async open(id: string): Promise<void> {
    const item = (await this.list()).find((i) => i.id === id);
    if (item?.state === "completed" && fs.existsSync(item.savePath)) await shell.openPath(item.savePath);
  }

  async reveal(id: string): Promise<void> {
    const item = (await this.list()).find((i) => i.id === id);
    if (item && fs.existsSync(item.savePath)) shell.showItemInFolder(item.savePath);
  }

  async remove(id: string): Promise<void> {
    this.cancel(id);
    if (this.store) await this.store.remove(id);
    else this.memory.delete(id);
    this.scheduleNotify();
  }

  async clearFinished(): Promise<void> {
    if (this.store) await this.store.clearFinished();
    else for (const [id, i] of this.memory) if (i.state !== "in_progress" && i.state !== "paused") this.memory.delete(id);
    this.scheduleNotify();
  }

  /** Starts the same download again (Chromium picks the file name and our will-download handler records it). */
  async retry(id: string): Promise<void> {
    const url = (await this.list()).find((i) => i.id === id)?.sourceUrl;
    if (url && /^https?:\/\//i.test(url)) this.session.downloadURL(url);
  }

  /** Coalesce progress events into at most ~4 UI updates per second. */
  private scheduleNotify(): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.notify();
    }, 250);
  }
}
