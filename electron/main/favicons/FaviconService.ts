import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MAX_HTML_BYTES, MAX_ICON_BYTES, detectImage, isAllowedIconUrl, originOf, parseLinkIcons, pixelSize, rootGuesses, sortCandidates, type IconCandidate, type ImageInfo } from "./parse";

const OK_TTL_MS = 7 * 86_400_000;
const NONE_TTL_MS = 3 * 86_400_000;
const RETRY_AFTER_ERROR_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const MAX_ATTEMPTS = 5; // icon downloads per site per lookup
const GOOD_ENOUGH_PX = 32; // below this an icon looks soft when drawn at 20 to 24 px on a sharp screen
const MAX_CONCURRENT = 4;
const MAX_MEMORY = 300;
const MAX_FILES = 1500;
const MAX_CACHE_BYTES = 40 * 1024 * 1024;

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: "manual" }) => Promise<Response>;

interface Meta {
  origin: string;
  status: "ok" | "none";
  fetchedAt: number;
  /** Last time we looked, even if nothing changed. Prevents hammering a site whose refresh fails. */
  checkedAt: number;
  mime?: string;
  width?: number;
  height?: number;
  source?: string;
}

export interface FaviconOptions {
  /** Where icons are stored. null keeps everything in memory (private windows). */
  dir: string | null;
  /** Read-only fallback (the profile's cache) for memory-only services. */
  parent?: FaviconService;
  fetchImpl?: FetchLike;
  now?: () => number;
}

/**
 * Finds, checks and caches website icons.
 * Icons come from the website's own address only: the icons it declares in its page, then /favicon.ico,
 * then a few well-known file names. No third-party icon service is ever contacted.
 */
export class FaviconService {
  private readonly dir: string | null;
  private readonly parent?: FaviconService;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private memory = new Map<string, { dataUrl: string | null; at: number }>();
  private ephemeral = new Map<string, { meta: Meta; bytes: Buffer }>(); // memory-only storage when dir is null
  private inflight = new Map<string, Promise<string | null>>();
  private recentErrors = new Map<string, number>();
  private active = 0;
  private waiting: Array<() => void> = [];

  constructor(opts: FaviconOptions) {
    this.dir = opts.dir;
    this.parent = opts.parent;
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? Date.now;
    if (this.dir) fs.mkdirSync(this.dir, { recursive: true });
  }

  // ---------------------------------------------------------------- public API ---------------

  /**
   * The icon for the site that owns `pageUrl` as a data URL, or null if it has none.
   * `hints` are icon addresses already known to belong to the site (for example from a page that was visited).
   * Cached icons are returned at once; old ones are refreshed in the background.
   */
  async get(pageUrl: string, hints: string[] = []): Promise<string | null> {
    const origin = originOf(pageUrl);
    if (!origin) return null;

    const mem = this.memory.get(origin);
    if (mem && this.now() - mem.at < 60_000) return mem.dataUrl;

    const cached = this.readCache(origin);
    if (cached) {
      const age = this.now() - cached.meta.checkedAt;
      const ttl = cached.meta.status === "ok" ? OK_TTL_MS : NONE_TTL_MS;
      const dataUrl = cached.meta.status === "ok" && cached.bytes ? toDataUrl(cached.meta.mime!, cached.bytes) : null;
      this.remember(origin, dataUrl);
      if (age > ttl) void this.refresh(origin, hints).catch(() => undefined); // stale: show it now, update quietly
      return dataUrl;
    }
    const fromParent = this.parent ? await this.parent.peek(origin) : undefined;
    if (fromParent !== undefined) {
      this.remember(origin, fromParent);
      return fromParent;
    }
    return this.refresh(origin, hints);
  }

  /** Cached answer only: undefined means "never looked". Used by memory-only services to reuse the profile's cache. */
  async peek(origin: string): Promise<string | null | undefined> {
    const cached = this.readCache(origin);
    if (!cached) return undefined;
    return cached.meta.status === "ok" && cached.bytes ? toDataUrl(cached.meta.mime!, cached.bytes) : null;
  }

  /**
   * A page was loaded and told us which icons it declares. Saving the best one costs no extra request to a new site,
   * because the browser already contacted it. Does nothing if we already hold a sharp, fresh icon.
   */
  async learn(pageUrl: string, iconUrls: string[]): Promise<void> {
    const origin = originOf(pageUrl);
    if (!origin) return;
    const cached = this.readCache(origin);
    const fresh = cached && cached.meta.status === "ok" && this.now() - cached.meta.fetchedAt < OK_TTL_MS;
    const sharp = fresh && Math.min(cached.meta.width ?? 0, cached.meta.height ?? 0) >= GOOD_ENOUGH_PX;
    const vector = fresh && cached.meta.mime === "image/svg+xml";
    if (sharp || vector) return;
    await this.refresh(origin, iconUrls, true).catch(() => undefined);
  }

  /** Deletes every stored icon. Returns how many files were removed. */
  clear(): number {
    this.memory.clear();
    this.ephemeral.clear();
    this.recentErrors.clear();
    if (!this.dir) return 0;
    let removed = 0;
    for (const f of fs.readdirSync(this.dir)) {
      try {
        fs.rmSync(path.join(this.dir, f), { force: true });
        removed++;
      } catch {
        /* in use; ignore */
      }
    }
    return removed;
  }

  /** Keeps the cache folder small. Oldest entries go first. Safe to call at any time. */
  prune(): void {
    if (!this.dir) return;
    try {
      const metas = fs
        .readdirSync(this.dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          const base = f.slice(0, -5);
          const stat = (n: string) => (fs.existsSync(path.join(this.dir!, n)) ? fs.statSync(path.join(this.dir!, n)).size : 0);
          let at = 0;
          try {
            at = (JSON.parse(fs.readFileSync(path.join(this.dir!, f), "utf8")) as Meta).fetchedAt ?? 0;
          } catch {
            at = 0; // unreadable entries are the first to go
          }
          return { base, at, size: stat(f) + stat(`${base}.img`) };
        })
        .sort((a, b) => a.at - b.at);
      let total = metas.reduce((s, m) => s + m.size, 0);
      let count = metas.length;
      for (const m of metas) {
        if (count <= MAX_FILES && total <= MAX_CACHE_BYTES) break;
        fs.rmSync(path.join(this.dir, `${m.base}.json`), { force: true });
        fs.rmSync(path.join(this.dir, `${m.base}.img`), { force: true });
        total -= m.size;
        count--;
      }
    } catch {
      /* pruning is best effort */
    }
  }

  // ---------------------------------------------------------------- storage -----------------

  private key(origin: string): string {
    return createHash("sha1").update(origin).digest("hex").slice(0, 24);
  }

  private remember(origin: string, dataUrl: string | null): void {
    this.memory.delete(origin);
    this.memory.set(origin, { dataUrl, at: this.now() });
    if (this.memory.size > MAX_MEMORY) this.memory.delete(this.memory.keys().next().value as string);
  }

  private readCache(origin: string): { meta: Meta; bytes: Buffer | null } | null {
    if (!this.dir) {
      const e = this.ephemeral.get(origin);
      return e ? { meta: e.meta, bytes: e.bytes } : null;
    }
    const k = this.key(origin);
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(this.dir, `${k}.json`), "utf8")) as Meta;
      if (meta.origin !== origin || (meta.status !== "ok" && meta.status !== "none")) return null;
      if (meta.status === "none") return { meta, bytes: null };
      const bytes = fs.readFileSync(path.join(this.dir, `${k}.img`));
      const info = detectImage(bytes); // re-check on load: a damaged or tampered file is simply ignored
      return info && info.mime === meta.mime ? { meta, bytes } : null;
    } catch {
      return null;
    }
  }

  private writeCache(origin: string, meta: Meta, bytes: Buffer | null): void {
    if (!this.dir) {
      if (bytes || meta.status === "none") this.ephemeral.set(origin, { meta, bytes: bytes ?? Buffer.alloc(0) });
      return;
    }
    const k = this.key(origin);
    try {
      if (bytes) {
        fs.writeFileSync(path.join(this.dir, `${k}.img.tmp`), bytes);
        fs.renameSync(path.join(this.dir, `${k}.img.tmp`), path.join(this.dir, `${k}.img`));
      } else {
        fs.rmSync(path.join(this.dir, `${k}.img`), { force: true });
      }
      fs.writeFileSync(path.join(this.dir, `${k}.json.tmp`), JSON.stringify(meta));
      fs.renameSync(path.join(this.dir, `${k}.json.tmp`), path.join(this.dir, `${k}.json`));
    } catch {
      /* a full disk must not break browsing */
    }
  }

  // ---------------------------------------------------------------- lookup ------------------

  private refresh(origin: string, hints: string[], hintsOnly = false): Promise<string | null> {
    const existing = this.inflight.get(origin);
    if (existing) return existing;
    const last = this.recentErrors.get(origin);
    if (last && this.now() - last < RETRY_AFTER_ERROR_MS) return Promise.resolve(this.memory.get(origin)?.dataUrl ?? null);

    const job = this.limited(() => this.resolve(origin, hints, hintsOnly)).finally(() => this.inflight.delete(origin));
    this.inflight.set(origin, job);
    return job;
  }

  private async limited<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_CONCURRENT) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private async resolve(origin: string, hints: string[], hintsOnly: boolean): Promise<string | null> {
    const pageHost = new URL(origin).hostname;
    const t = this.now();
    const previous = this.readCache(origin);

    const queue: IconCandidate[] = [];
    const add = (list: IconCandidate[]) => {
      for (const c of list) if (isAllowedIconUrl(c.url, pageHost) && !queue.some((q) => q.url === c.url)) queue.push(c);
    };
    // 1. Icons the page declares. Known addresses first (no page download needed), otherwise read the page's <head>.
    add(sortCandidates(hints.filter((h) => h.length < 2048).map((url) => ({ url, size: 0, type: "", rel: "hint" }))));
    let sawNetworkError = false;
    if (!hintsOnly || queue.length === 0) {
      try {
        const page = await this.download(`${origin}/`, pageHost, MAX_HTML_BYTES, true);
        if (page) add(sortCandidates(parseLinkIcons(page.bytes.toString("utf8"), page.finalUrl)));
      } catch (e) {
        if (isNetworkFailure(e)) sawNetworkError = true;
      }
    }
    // 2. and 3. /favicon.ico, then other well-known files.
    add(rootGuesses(origin));

    let best: { info: ImageInfo; bytes: Buffer; source: string } | null = null;
    let attempts = 0;
    for (const c of queue) {
      if (attempts++ >= MAX_ATTEMPTS) break;
      let got: { bytes: Buffer; finalUrl: string } | null = null;
      try {
        got = await this.download(c.url, pageHost, MAX_ICON_BYTES, false);
      } catch (e) {
        if (isNetworkFailure(e)) sawNetworkError = true;
        continue;
      }
      if (!got) continue;
      const info = detectImage(got.bytes);
      if (!info) continue; // an HTML "not found" page, a script, a truncated file...
      if (!best || pixelSize(info) > pixelSize(best.info)) best = { info, bytes: got.bytes, source: c.url };
      if (pixelSize(info) >= GOOD_ENOUGH_PX) break; // sharp enough, stop asking the site for more files
    }

    if (best) {
      this.writeCache(origin, { origin, status: "ok", fetchedAt: t, checkedAt: t, mime: best.info.mime, width: best.info.width, height: best.info.height, source: best.source }, best.bytes);
      const dataUrl = toDataUrl(best.info.mime, best.bytes);
      this.remember(origin, dataUrl);
      this.recentErrors.delete(origin);
      return dataUrl;
    }
    if (sawNetworkError) {
      // Offline or the site is down: say nothing is known for now, and keep whatever we had.
      this.recentErrors.set(origin, t);
      return previous && previous.meta.status === "ok" && previous.bytes ? toDataUrl(previous.meta.mime!, previous.bytes) : null;
    }
    if (previous?.meta.status === "ok" && previous.bytes) {
      // The site stopped serving an icon; keep the one we have and look again later.
      this.writeCache(origin, { ...previous.meta, checkedAt: t }, previous.bytes);
      return toDataUrl(previous.meta.mime!, previous.bytes);
    }
    this.writeCache(origin, { origin, status: "none", fetchedAt: t, checkedAt: t }, null);
    this.remember(origin, null);
    return null;
  }

  /**
   * Downloads one address with a size cap and a short timeout. Redirects are followed by hand so every hop is
   * checked against the same rules. Returns null for HTTP errors; throws on network failure.
   */
  private async download(url: string, pageHost: string, maxBytes: number, textOnly: boolean): Promise<{ bytes: Buffer; finalUrl: string } | null> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isAllowedIconUrl(current, pageHost)) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await this.fetchImpl(current, { headers: { "user-agent": "SIDB-Browser/0.1", accept: textOnly ? "text/html,*/*;q=0.5" : "image/*,*/*;q=0.5" }, signal: controller.signal, redirect: "manual" });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          if (!location) return null;
          current = new URL(location, current).href;
          continue;
        }
        if (!res.ok || !res.body) return null;
        const declared = Number(res.headers.get("content-length") ?? 0);
        if (!textOnly && declared > maxBytes) return null;
        const chunks: Buffer[] = [];
        let total = 0;
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > maxBytes) {
            if (!textOnly) return null; // too large to be a sensible icon
            chunks.push(Buffer.from(value.subarray(0, value.length - (total - maxBytes))));
            await reader.cancel().catch(() => undefined);
            break; // for pages only the beginning matters: the icon links live in <head>
          }
          chunks.push(Buffer.from(value));
          if (textOnly && /<\/head\s*>/i.test(Buffer.concat(chunks).toString("latin1").slice(-4096))) {
            await reader.cancel().catch(() => undefined);
            break;
          }
        }
        return { bytes: Buffer.concat(chunks), finalUrl: current };
      } finally {
        clearTimeout(timer);
      }
    }
    return null; // too many redirects
  }
}

function toDataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/** Fetch rejects with a TypeError for DNS, connection and TLS problems; aborts come from our timeout. */
function isNetworkFailure(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof Error && /abort|timeout|network|fetch failed/i.test(e.message)) || (e instanceof DOMException && e.name === "AbortError");
}
