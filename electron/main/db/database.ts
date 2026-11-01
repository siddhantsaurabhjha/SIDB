import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import * as schema from "../../../database/schema";

/**
 * Bump only when a migration changes the shape of a table listed in BACKUP_TABLES.
 * Backups must match exactly to be imported. (Migration 0002 adds AI chat tables, which are not backed up.)
 */
export const SCHEMA_VERSION = 2;

export interface Db {
  /** Raw handle, used for PRAGMAs, VACUUM INTO and ATTACH. */
  sqlite: DatabaseSync;
  orm: SqliteRemoteDatabase<typeof schema>;
  close(): void;
}

/**
 * Opens a profile database with Node's built-in SQLite and wraps it in Drizzle (sqlite-proxy driver),
 * then applies pending migrations. `file` may be ":memory:" for tests.
 */
export async function openDatabase(file: string, migrationsFolder: string): Promise<Db> {
  const sqlite = new DatabaseSync(file);
  sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");

  const orm = drizzle<typeof schema>(
    async (sql, params, method) => {
      const stmt = sqlite.prepare(sql);
      const args = params as SQLInputValue[];
      if (method === "run") {
        stmt.run(...args);
        return { rows: [] };
      }
      stmt.setReturnArrays(true);
      if (method === "get") return { rows: stmt.get(...args) as unknown as unknown[] };
      return { rows: stmt.all(...args) as unknown as unknown[][] };
    },
    { schema },
  );

  await migrate(
    orm,
    async (queries) => {
      if (queries.length === 0) return;
      sqlite.exec("BEGIN");
      try {
        for (const q of queries) sqlite.exec(q);
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
    { migrationsFolder },
  );
  sqlite.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

  return { sqlite, orm, close: () => sqlite.close() };
}
