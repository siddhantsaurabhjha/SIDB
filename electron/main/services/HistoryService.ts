import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { historyEntries } from "../../../database/schema";
import type { HistoryEntry, HistoryStats } from "../../../shared/types/data";
import { isSafeWebUrl } from "../../../shared/url";
import type { Db } from "../db/database";

const DAY = 86_400_000;
const likeEsc = (col: object, pattern: string) => sql`${col} LIKE ${pattern} ESCAPE '\\'`;

export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export class HistoryService {
  constructor(private readonly db: Db) {}

  /** Records one visit. Only http(s) pages are stored; repeated visits bump the counter. */
  async record(url: string, title: string, favicon: string | null = null, at = Date.now()): Promise<void> {
    if (!isSafeWebUrl(url)) return;
    await this.db.orm
      .insert(historyEntries)
      .values({ id: randomUUID(), url, title, favicon, visitCount: 1, lastVisit: at })
      .onConflictDoUpdate({
        target: historyEntries.url,
        set: {
          visitCount: sql`${historyEntries.visitCount} + 1`,
          lastVisit: at,
          ...(title ? { title } : {}),
          ...(favicon ? { favicon } : {}),
        },
      });
  }

  /** Called when a page title/favicon arrives after the visit was recorded. */
  async updateMeta(url: string, meta: { title?: string; favicon?: string | null }): Promise<void> {
    const set: { title?: string; favicon?: string } = {};
    if (meta.title) set.title = meta.title;
    if (meta.favicon) set.favicon = meta.favicon;
    if (Object.keys(set).length === 0) return;
    await this.db.orm.update(historyEntries).set(set).where(eq(historyEntries.url, url));
  }

  async list(opts: { query?: string; from?: number; to?: number; limit?: number; offset?: number } = {}): Promise<HistoryEntry[]> {
    const q = opts.query?.trim();
    const pattern = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    const conds = [
      opts.from !== undefined ? gte(historyEntries.lastVisit, opts.from) : undefined,
      opts.to !== undefined ? lt(historyEntries.lastVisit, opts.to) : undefined,
      pattern ? sql`(${likeEsc(historyEntries.title, pattern)} OR ${likeEsc(historyEntries.url, pattern)})` : undefined,
    ].filter((c) => c !== undefined);
    return this.db.orm
      .select()
      .from(historyEntries)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(historyEntries.lastVisit))
      .limit(Math.min(opts.limit ?? 200, 1000))
      .offset(opts.offset ?? 0);
  }

  /**
   * Candidate pages for address bar suggestions: every word must appear in the title or address.
   * Most visited first, so the rows ranking needs are not lost to a cut-off on old, rarely used pages.
   */
  async suggest(query: string, limit = 80): Promise<HistoryEntry[]> {
    const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 5);
    if (words.length === 0) return [];
    const conds = words.map((w) => {
      const pattern = `%${w.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      return sql`(${likeEsc(historyEntries.title, pattern)} OR ${likeEsc(historyEntries.url, pattern)})`;
    });
    return this.db.orm
      .select()
      .from(historyEntries)
      .where(and(...conds))
      .orderBy(desc(historyEntries.visitCount), desc(historyEntries.lastVisit))
      .limit(Math.min(limit, 200));
  }

  /** Most visited pages, used when the address bar is focused with nothing typed. */
  async mostVisited(limit = 60): Promise<HistoryEntry[]> {
    return this.db.orm.select().from(historyEntries).orderBy(desc(historyEntries.visitCount), desc(historyEntries.lastVisit)).limit(Math.min(limit, 200));
  }

  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.orm.delete(historyEntries).where(inArray(historyEntries.id, ids));
  }

  /** Deletes entries whose last visit falls in [from, to). Omit both to clear everything. */
  async clearRange(from?: number, to?: number): Promise<void> {
    const conds = [from !== undefined ? gte(historyEntries.lastVisit, from) : undefined, to !== undefined ? lt(historyEntries.lastVisit, to) : undefined].filter(
      (c) => c !== undefined,
    );
    await this.db.orm.delete(historyEntries).where(conds.length ? and(...conds) : undefined);
  }

  async stats(now = Date.now()): Promise<HistoryStats> {
    const today = startOfLocalDay(now);
    const since = today - 6 * DAY;
    const rows = await this.db.orm.select().from(historyEntries).where(gte(historyEntries.lastVisit, since));

    const perDay = Array.from({ length: 7 }, (_, i) => ({ day: since + i * DAY, visits: 0 }));
    const hosts = new Map<string, number>();
    let total = 0;
    for (const r of rows) {
      total += r.visitCount;
      const slot = perDay[Math.min(6, Math.max(0, Math.floor((startOfLocalDay(r.lastVisit) - since) / DAY)))];
      slot.visits += r.visitCount;
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "");
        hosts.set(host, (hosts.get(host) ?? 0) + r.visitCount);
      } catch {
        /* skip malformed */
      }
    }
    const topSites = [...hosts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([host, visits]) => ({ host, visits }));
    return { totalVisits: total, perDay, topSites };
  }
}
