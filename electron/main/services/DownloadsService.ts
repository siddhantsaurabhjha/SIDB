import fs from "node:fs";
import path from "node:path";
import { desc, eq, inArray } from "drizzle-orm";
import { downloadRecords } from "../../../database/schema";
import type { DownloadItem, DownloadState } from "../../../shared/types/data";
import type { Db } from "../db/database";

type Row = typeof downloadRecords.$inferSelect;

export function toItem(row: Row): DownloadItem {
  return {
    ...row,
    state: row.state,
    speed: 0,
    exists: row.state === "completed" ? fs.existsSync(row.savePath) : false,
  };
}

const RISKY_EXT = new Set([".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".ps1", ".vbs", ".js", ".jar", ".apk", ".dmg", ".pkg", ".sh", ".appimage", ".deb", ".rpm"]);

/** Risk-based hint shown next to a download. This is a warning, not a malware verdict. */
export function riskWarningFor(fileName: string, sourceUrl: string): string | null {
  const ext = path.extname(fileName).toLowerCase();
  const insecure = sourceUrl.startsWith("http://");
  if (RISKY_EXT.has(ext) && insecure) return "Executable file from an insecure (http) source";
  if (RISKY_EXT.has(ext)) return "Executable or script file. Only open it if you trust the source";
  if (insecure) return "Downloaded over an insecure (http) connection";
  return null;
}

/** Picks "name (1).ext" style names so an existing file is never overwritten. */
export function uniquePath(dir: string, fileName: string, exists: (p: string) => boolean = fs.existsSync): string {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = path.join(dir, fileName);
  for (let i = 1; exists(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

export class DownloadsService {
  constructor(private readonly db: Db) {}

  async insert(item: DownloadItem): Promise<void> {
    const { speed: _s, exists: _e, ...row } = item;
    await this.db.orm.insert(downloadRecords).values(row);
  }

  async update(id: string, patch: Partial<{ savePath: string; fileName: string; totalBytes: number; receivedBytes: number; state: DownloadState; completedAt: number | null }>): Promise<void> {
    await this.db.orm.update(downloadRecords).set(patch).where(eq(downloadRecords.id, id));
  }

  async list(): Promise<DownloadItem[]> {
    const rows = await this.db.orm.select().from(downloadRecords).orderBy(desc(downloadRecords.startedAt));
    return rows.map(toItem);
  }

  /** Removes the record only. The downloaded file is never deleted. */
  async remove(id: string): Promise<void> {
    await this.db.orm.delete(downloadRecords).where(eq(downloadRecords.id, id));
  }

  async clearFinished(): Promise<void> {
    await this.db.orm.delete(downloadRecords).where(inArray(downloadRecords.state, ["completed", "cancelled", "failed"]));
  }

  /** Downloads that were running when the app last exited can never resume; mark them failed. */
  async failStale(): Promise<void> {
    await this.db.orm
      .update(downloadRecords)
      .set({ state: "failed" })
      .where(inArray(downloadRecords.state, ["in_progress", "paused"]));
  }

  async get(id: string): Promise<DownloadItem | null> {
    const [row] = await this.db.orm.select().from(downloadRecords).where(eq(downloadRecords.id, id)).limit(1);
    return row ? toItem(row) : null;
  }
}
