import { desc, eq, sql } from "drizzle-orm";
import { shieldExceptions, shieldStats } from "../../../database/schema";
import type { ShieldException } from "../../../shared/types/shield";
import type { Db } from "../db/database";
import { startOfLocalDay } from "./HistoryService";

const DAY = 86_400_000;

/** Normalizes a user-typed site or URL to a bare hostname, or null if it isn't one. */
export function normalizeHost(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  let host = raw;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  return host === "localhost" || (/^[a-z0-9.-]+$/.test(host) && host.includes(".")) ? host : null;
}

export class ShieldDataService {
  /** In-memory copy for the hot request path. */
  readonly exceptionHosts = new Set<string>();

  constructor(private readonly db: Db) {}

  async load(): Promise<void> {
    this.exceptionHosts.clear();
    for (const e of await this.listExceptions()) this.exceptionHosts.add(e.host);
  }

  async listExceptions(): Promise<ShieldException[]> {
    return this.db.orm.select().from(shieldExceptions).orderBy(desc(shieldExceptions.createdAt));
  }

  async addException(input: string): Promise<string> {
    const host = normalizeHost(input);
    if (!host) throw new Error("Enter a website address like example.com");
    await this.db.orm.insert(shieldExceptions).values({ host, createdAt: Date.now() }).onConflictDoNothing();
    this.exceptionHosts.add(host);
    return host;
  }

  async removeException(host: string): Promise<void> {
    await this.db.orm.delete(shieldExceptions).where(eq(shieldExceptions.host, host));
    this.exceptionHosts.delete(host);
  }

  /** True when Shield is switched off for this page's site (the host itself or any parent domain). */
  isException(hostname: string): boolean {
    const host = hostname.replace(/^www\./, "");
    if (this.exceptionHosts.has(host)) return true;
    const parts = host.split(".");
    for (let i = 1; i < parts.length - 1; i++) if (this.exceptionHosts.has(parts.slice(i).join("."))) return true;
    return false;
  }

  async addStats(blocked: number, popups: number, now = Date.now()): Promise<void> {
    if (blocked <= 0 && popups <= 0) return;
    const day = startOfLocalDay(now);
    await this.db.orm
      .insert(shieldStats)
      .values({ day, blocked, popups })
      .onConflictDoUpdate({ target: shieldStats.day, set: { blocked: sql`${shieldStats.blocked} + ${blocked}`, popups: sql`${shieldStats.popups} + ${popups}` } });
  }

  async summary(now = Date.now()): Promise<{ today: number; week: number; total: number; popupsToday: number }> {
    const today = startOfLocalDay(now);
    const rows = await this.db.orm.select().from(shieldStats);
    const sum = (list: typeof rows) => list.reduce((s, r) => s + r.blocked, 0);
    const todayRow = rows.find((r) => r.day === today);
    return {
      today: todayRow?.blocked ?? 0,
      popupsToday: todayRow?.popups ?? 0,
      week: sum(rows.filter((r) => r.day >= today - 6 * DAY)),
      total: sum(rows),
    };
  }

  /** Keeps the stats table small. */
  async pruneStats(keepDays = 120, now = Date.now()): Promise<void> {
    const cutoff = startOfLocalDay(now) - keepDays * DAY;
    await this.db.orm.delete(shieldStats).where(sql`${shieldStats.day} < ${cutoff}`);
  }
}
