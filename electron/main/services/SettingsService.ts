import { browserSettings } from "../../../database/schema";
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from "../../../shared/types/data";
import type { Db } from "../db/database";

export class SettingsService {
  private cache: Settings | null = null;

  constructor(private readonly db: Db) {}

  /** Synchronous read for hot paths (e.g. URL normalization). Returns defaults until getAll() has run once. */
  peek(): Settings {
    return { ...(this.cache ?? DEFAULT_SETTINGS) };
  }

  async getAll(): Promise<Settings> {
    if (this.cache) return { ...this.cache };
    const rows = await this.db.orm.select().from(browserSettings);
    const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      try {
        merged[row.key] = JSON.parse(row.value);
      } catch {
        /* ignore corrupt value, keep default */
      }
    }
    // Invalid stored values fall back to defaults field by field.
    const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
      const probe = settingsSchema.shape[key].safeParse(merged[key]);
      if (probe.success) result[key] = probe.data;
    }
    this.cache = result as Settings;
    return { ...this.cache };
  }

  async set(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.getAll();
    const next = settingsSchema.parse({ ...current, ...patch });
    for (const key of Object.keys(patch) as Array<keyof Settings>) {
      const value = JSON.stringify(next[key]);
      await this.db.orm
        .insert(browserSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: browserSettings.key, set: { value } });
    }
    this.cache = next;
    return { ...next };
  }

  invalidate(): void {
    this.cache = null;
  }
}
