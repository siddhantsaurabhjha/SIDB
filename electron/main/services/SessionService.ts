import { randomUUID } from "node:crypto";
import { asc, desc, eq, lt } from "drizzle-orm";
import { customShortcuts, recentlyClosedTabs, sessionGroups, sessionMetadata } from "../../../database/schema";
import type { TabGroup } from "../../../shared/types/browser";
import type { ClosedTab, Shortcut } from "../../../shared/types/data";
import { isSafeWebUrl } from "../../../shared/url";
import type { Db } from "../db/database";

export interface SavedTab {
  url: string;
  title: string;
  pinned: boolean;
  active: boolean;
  zoom: number;
  groupId?: string | null;
}

const MAX_CLOSED = 25;

/** Session restore + recently closed tabs. Never used for private windows. */
export class SessionService {
  constructor(private readonly db: Db) {}

  async save(tabs: SavedTab[], groups: TabGroup[] = []): Promise<void> {
    const keep = tabs.filter((t) => t.url.startsWith("sidb://") || isSafeWebUrl(t.url));
    const usedGroups = new Set(keep.map((t) => t.groupId).filter((g): g is string => !!g));
    await this.db.orm.delete(sessionMetadata);
    await this.db.orm.delete(sessionGroups);
    for (const g of groups.filter((x) => usedGroups.has(x.id))) await this.db.orm.insert(sessionGroups).values(g);
    for (const [position, t] of keep.entries()) {
      await this.db.orm.insert(sessionMetadata).values({ id: randomUUID(), position, ...t, groupId: t.groupId && usedGroups.has(t.groupId) ? t.groupId : null });
    }
  }

  async load(): Promise<SavedTab[]> {
    const rows = await this.db.orm.select().from(sessionMetadata).orderBy(asc(sessionMetadata.position));
    return rows.map(({ url, title, pinned, active, zoom, groupId }) => ({ url, title, pinned, active, zoom, groupId }));
  }

  async loadGroups(): Promise<TabGroup[]> {
    return this.db.orm.select().from(sessionGroups);
  }

  async addClosed(url: string, title: string): Promise<void> {
    if (!isSafeWebUrl(url)) return;
    await this.db.orm.insert(recentlyClosedTabs).values({ id: randomUUID(), url, title, closedAt: Date.now() });
    const old = await this.db.orm.select().from(recentlyClosedTabs).orderBy(desc(recentlyClosedTabs.closedAt)).limit(1).offset(MAX_CLOSED);
    if (old[0]) await this.db.orm.delete(recentlyClosedTabs).where(lt(recentlyClosedTabs.closedAt, old[0].closedAt + 1));
  }

  async listClosed(limit = 15): Promise<ClosedTab[]> {
    return this.db.orm.select().from(recentlyClosedTabs).orderBy(desc(recentlyClosedTabs.closedAt)).limit(limit);
  }

  /** Removes and returns a closed tab so the caller can reopen it. */
  async takeClosed(id?: string): Promise<ClosedTab | null> {
    const [row] = id
      ? await this.db.orm.select().from(recentlyClosedTabs).where(eq(recentlyClosedTabs.id, id)).limit(1)
      : await this.db.orm.select().from(recentlyClosedTabs).orderBy(desc(recentlyClosedTabs.closedAt)).limit(1);
    if (!row) return null;
    await this.db.orm.delete(recentlyClosedTabs).where(eq(recentlyClosedTabs.id, row.id));
    return row;
  }
}

export class ShortcutsService {
  constructor(private readonly db: Db) {}

  async list(): Promise<Shortcut[]> {
    return this.db.orm.select().from(customShortcuts).orderBy(asc(customShortcuts.position));
  }

  async add(title: string, url: string): Promise<Shortcut> {
    if (!isSafeWebUrl(url)) throw new Error("Shortcut must be an http(s) URL");
    const row: Shortcut = { id: randomUUID(), title: title.trim() || new URL(url).hostname, url, position: Date.now() };
    await this.db.orm.insert(customShortcuts).values(row);
    return row;
  }

  async update(id: string, patch: { title?: string; url?: string }): Promise<void> {
    if (patch.url !== undefined && !isSafeWebUrl(patch.url)) throw new Error("Shortcut must be an http(s) URL");
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length) await this.db.orm.update(customShortcuts).set(clean).where(eq(customShortcuts.id, id));
  }

  async remove(id: string): Promise<void> {
    await this.db.orm.delete(customShortcuts).where(eq(customShortcuts.id, id));
  }

  /** Persists a new order given the full list of ids. */
  async reorder(ids: string[]): Promise<void> {
    for (const [position, id] of ids.entries()) {
      await this.db.orm.update(customShortcuts).set({ position }).where(eq(customShortcuts.id, id));
    }
  }
}
