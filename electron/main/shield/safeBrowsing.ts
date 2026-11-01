import { createHash } from "node:crypto";
import { appFetch } from "../net/appFetch";
import { discardBody } from "../net/discardBody";

/**
 * Google Safe Browsing v5 `hashes:search` client (non-commercial use only per Google's terms).
 * Only 4-byte SHA-256 hash prefixes of URL expressions leave the device, never the URL itself.
 * Needs the user's own API key. Not enabled unless the user turns it on and provides a key.
 */

const API = "https://safebrowsing.googleapis.com/v5/hashes:search";
const KNOWN_THREATS: Record<string, string> = {
  MALWARE: "Malware",
  SOCIAL_ENGINEERING: "Phishing or deceptive site",
  UNWANTED_SOFTWARE: "Unwanted software",
  POTENTIALLY_HARMFUL_APPLICATION: "Potentially harmful application",
};
const KNOWN_ATTRIBUTES = new Set(["CANARY", "FRAME_ONLY"]);
const MAX_CACHE = 5000;

function unescapeRepeatedly(s: string): string {
  let prev = s;
  for (let i = 0; i < 50; i++) {
    let next: string;
    try {
      next = decodeURIComponent(prev);
    } catch {
      next = prev.replace(/%([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
    }
    if (next === prev) return next;
    prev = next;
  }
  return prev;
}

function escapeSpecial(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c <= 32 || c >= 127 || ch === "#" || ch === "%") {
      for (const byte of Buffer.from(ch, "utf8")) out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Canonical host, path and query as defined by the Safe Browsing URL processing rules. */
export function canonicalize(rawUrl: string): { host: string; path: string; query: string | null } | null {
  let u: URL;
  try {
    u = new URL(rawUrl.replace(/[\t\r\n]/g, ""));
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = unescapeRepeatedly(u.hostname).replace(/^\.+|\.+$/g, "").replace(/\.{2,}/g, ".").toLowerCase();
  if (!host) return null;
  const path = escapeSpecial(unescapeRepeatedly(u.pathname).replace(/\/{2,}/g, "/")) || "/";
  const query = u.search.length > 1 ? u.search.slice(1) : null;
  return { host, path, query };
}

/** Host-suffix and path-prefix combinations to look up (at most 30). */
export function urlExpressions(rawUrl: string): string[] {
  const c = canonicalize(rawUrl);
  if (!c) return [];
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(c.host) || c.host.includes(":");
  const comps = c.host.split(".");
  const hosts = [c.host];
  if (!isIp) {
    for (let i = Math.max(0, comps.length - 5); i <= comps.length - 2; i++) {
      const h = comps.slice(i).join(".");
      if (!hosts.includes(h)) hosts.push(h);
    }
  }
  const paths: string[] = [];
  const add = (p: string) => paths.includes(p) || paths.push(p);
  if (c.query !== null) add(`${c.path}?${c.query}`);
  add(c.path);
  add("/");
  const segments = c.path.split("/").slice(1, -1); // directory components only
  let prefix = "/";
  for (const seg of segments.slice(0, 3)) { // "/" plus up to three deeper prefixes = the four allowed
    prefix += `${seg}/`;
    add(prefix);
  }
  return hosts.flatMap((h) => paths.map((p) => `${h}${p}`));
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();

interface CacheEntry {
  expires: number;
  /** Full hashes (hex) with enforceable threat labels for this prefix. */
  hashes: Map<string, string[]>;
}

type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class SafeBrowsingClient {
  private cache = new Map<string, CacheEntry>();
  private backoffUntil = 0;
  lastError: string | null = null;

  constructor(
    private readonly getKey: () => string | null | Promise<string | null>,
    private readonly fetchImpl: FetchLike = (input, init) => appFetch(input, init),
    private readonly now: () => number = Date.now,
    private readonly timeoutMs = 1500,
  ) {}

  /** Returns readable threat names if the URL is known to be dangerous, otherwise null (also null on any failure: fail open). */
  async check(url: string): Promise<string[] | null> {
    if (this.now() < this.backoffUntil) return null;
    const key = await this.getKey();
    if (!key) return null;
    const expressions = urlExpressions(url);
    if (expressions.length === 0) return null;

    const full = expressions.map((e) => sha256(e));
    const prefixes = [...new Set(full.map((h) => h.subarray(0, 4).toString("hex")))];
    const stale = prefixes.filter((p) => (this.cache.get(p)?.expires ?? 0) <= this.now());

    if (stale.length > 0) {
      try {
        await this.lookup(stale, key);
        this.lastError = null;
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : "Safe Browsing lookup failed";
        return null;
      }
    }

    const threats = new Set<string>();
    for (const h of full) {
      const entry = this.cache.get(h.subarray(0, 4).toString("hex"));
      for (const t of entry?.hashes.get(h.toString("hex")) ?? []) threats.add(t);
    }
    return threats.size ? [...threats] : null;
  }

  private async lookup(prefixHexes: string[], key: string): Promise<void> {
    const query = prefixHexes.map((p) => `hashPrefixes=${encodeURIComponent(Buffer.from(p, "hex").toString("base64"))}`).join("&");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      // The key goes in a header so it never appears in a URL or a log line.
      res = await this.fetchImpl(`${API}?${query}`, { headers: { "x-goog-api-key": key, "user-agent": "SIDB-Browser/0.1" }, signal: controller.signal });
    } catch {
      this.backoffUntil = this.now() + 60_000;
      throw new Error("Safe Browsing is unreachable");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      await discardBody(res);
      this.backoffUntil = this.now() + (res.status === 429 || res.status >= 500 ? 60_000 : 300_000);
      throw new Error(res.status === 400 || res.status === 403 ? "Safe Browsing rejected the API key" : `Safe Browsing error ${res.status}`);
    }

    const body = (await res.json()) as { fullHashes?: Array<{ fullHash?: string; fullHashDetails?: Array<{ threatType?: string; attributes?: string[] }> }>; cacheDuration?: string };
    const seconds = Math.min(86_400, Math.max(0, parseFloat(body.cacheDuration ?? "300") || 300));
    const expires = this.now() + seconds * 1000;

    const byPrefix = new Map<string, Map<string, string[]>>(prefixHexes.map((p) => [p, new Map()]));
    for (const fh of body.fullHashes ?? []) {
      if (!fh.fullHash) continue;
      const hex = Buffer.from(fh.fullHash, "base64").toString("hex");
      if (hex.length !== 64) continue;
      const labels: string[] = [];
      for (const d of fh.fullHashDetails ?? []) {
        const label = d.threatType ? KNOWN_THREATS[d.threatType] : undefined;
        const attrs = d.attributes ?? [];
        // Unknown threat types or attributes mean the whole detail must be ignored, as must canary/frame-only entries.
        if (!label || attrs.some((a) => !KNOWN_ATTRIBUTES.has(a) || a === "CANARY" || a === "FRAME_ONLY")) continue;
        labels.push(label);
      }
      if (labels.length) byPrefix.get(hex.slice(0, 8))?.set(hex, labels);
    }

    if (this.cache.size > MAX_CACHE) this.cache.clear();
    for (const [p, hashes] of byPrefix) this.cache.set(p, { expires, hashes });
  }
}
