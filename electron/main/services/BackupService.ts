import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { desc, eq } from "drizzle-orm";
import { BACKUP_TABLES, backupMetadata } from "../../../database/schema";
import type { BackupInfo } from "../../../shared/types/data";
import { SCHEMA_VERSION, type Db } from "../db/database";

const KEEP_AUTO = 5;
const quote = (p: string) => `'${p.replace(/'/g, "''")}'`;

/** Opens a database file read-only and checks that it is intact and matches our schema version. */
function validateBackupFile(file: string): void {
  const probe = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = probe.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined;
    if (integrity?.integrity_check !== "ok") throw new Error("Backup file is damaged");
    const version = (probe.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version !== SCHEMA_VERSION) throw new Error(`Unsupported backup version ${version} (expected ${SCHEMA_VERSION})`);
    const tables = new Set((probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name));
    for (const t of BACKUP_TABLES) if (!tables.has(t)) throw new Error(`Backup is missing table ${t}`);
  } finally {
    probe.close();
  }
}

/**
 * VACUUM INTO copies the whole database. Remove everything that is not meant to be in a backup
 * (AI chats, open-tab session data, recently closed tabs, statistics) so exported files never carry it.
 */
function scrubNonBackupTables(file: string): void {
  const copy = new DatabaseSync(file);
  try {
    const keep = new Set<string>([...BACKUP_TABLES, "__drizzle_migrations"]);
    const tables = (copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((t) => t.name);
    for (const name of tables) if (!keep.has(name)) copy.exec(`DELETE FROM "${name}"`);
    copy.exec("VACUUM"); // also drops the deleted pages so the removed text isn't left in free space
  } finally {
    copy.close();
  }
}

export class BackupService {
  constructor(
    private readonly db: Db,
    private readonly dir: string,
  ) {}

  /** Writes a consistent snapshot to `dest` via a temp file, so a failure never clobbers an existing file. */
  private snapshotTo(dest: string): void {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = path.join(path.dirname(dest), `.tmp-${randomUUID()}.db`);
    try {
      this.db.sqlite.exec(`VACUUM INTO ${quote(tmp)}`);
      scrubNonBackupTables(tmp);
      validateBackupFile(tmp);
      fs.renameSync(tmp, dest);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  async create(kind: "auto" | "manual"): Promise<BackupInfo> {
    const createdAt = Date.now();
    const id = randomUUID();
    const fileName = `sidb-${new Date(createdAt).toISOString().replace(/[:.]/g, "-")}-${kind}.db`;
    const dest = path.join(this.dir, fileName);
    this.snapshotTo(dest);
    const info: BackupInfo = { id, fileName, kind, sizeBytes: fs.statSync(dest).size, createdAt };
    await this.db.orm.insert(backupMetadata).values(info);
    await this.prune();
    return info;
  }

  async list(): Promise<BackupInfo[]> {
    const rows = await this.db.orm.select().from(backupMetadata).orderBy(desc(backupMetadata.createdAt));
    return rows.filter((r) => fs.existsSync(path.join(this.dir, r.fileName)));
  }

  /** Keeps the newest few automatic backups; manual ones are never deleted automatically. */
  private async prune(): Promise<void> {
    const autos = (await this.db.orm.select().from(backupMetadata).orderBy(desc(backupMetadata.createdAt))).filter((r) => r.kind === "auto");
    for (const old of autos.slice(KEEP_AUTO)) {
      fs.rmSync(path.join(this.dir, old.fileName), { force: true });
      await this.db.orm.delete(backupMetadata).where(eq(backupMetadata.id, old.id));
    }
  }

  async lastAutoBackupAt(): Promise<number | null> {
    const autos = (await this.db.orm.select().from(backupMetadata).orderBy(desc(backupMetadata.createdAt))).filter((r) => r.kind === "auto");
    return autos[0]?.createdAt ?? null;
  }

  exportTo(dest: string): void {
    this.snapshotTo(dest);
  }

  /** Replaces this profile's bookmarks, history, downloads, settings, shortcuts and site permissions with the backup's. */
  async importFrom(file: string): Promise<void> {
    validateBackupFile(file);
    await this.create("manual"); // safety copy of the current state first

    const sqlite = this.db.sqlite;
    sqlite.prepare("ATTACH DATABASE ? AS imported").run(file);
    try {
      sqlite.exec("BEGIN");
      try {
        for (const t of [...BACKUP_TABLES].reverse()) sqlite.exec(`DELETE FROM main.${t}`);
        for (const t of BACKUP_TABLES) {
          const cols = (sqlite.prepare(`PRAGMA main.table_info(${t})`).all() as Array<{ name: string }>).map((c) => `"${c.name}"`).join(", ");
          sqlite.exec(`INSERT INTO main.${t} (${cols}) SELECT ${cols} FROM imported.${t}`);
        }
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    } finally {
      sqlite.exec("DETACH DATABASE imported");
    }
  }
}
