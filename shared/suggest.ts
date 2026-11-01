import { isInternalUrl } from "./url";

/** A history or bookmark row as the ranking code needs it. */
export interface SourceRow {
  url: string;
  title: string;
  favicon: string | null;
  /** History only. */
  visitCount?: number;
  lastVisit?: number;
}

export interface UrlSuggestion {
  kind: "url";
  id: string;
  url: string;
  title: string;
  host: string;
  favicon: string | null;
  /** "site" = the home page of a site you know; "page" = a specific page. */
  source: "site" | "page" | "bookmark" | "popular";
  bookmarked: boolean;
  visits: number;
  lastVisit: number | null;
  score: number;
}

/** Whatever was typed. Enter on this row behaves like the old address bar: open the address or search. */
export interface TypedSuggestion {
  kind: "typed";
  id: string;
  text: string;
  isAddress: boolean;
}

export interface SearchSuggestion {
  kind: "search";
  id: string;
  text: string;
  score: number;
}

export type Suggestion = UrlSuggestion | TypedSuggestion | SearchSuggestion;

const DAY = 86_400_000;
export const MAX_ROWS = 10;
export const MAX_REMOTE_ROWS = 5;
export const MAX_QUERY_LENGTH = 200;

/** Rank bands. A higher band always beats a lower one; scores inside a band only order its own members. */
export const TIER = { exactDomain: 5000, frequent: 4000, recent: 3000, history: 2500, bookmark: 2000, popular: 1500, engine: 1000 } as const;

/** Well-known sites offered for domain completion when your own history has nothing better. */
export const POPULAR_SITES: ReadonlyArray<{ host: string; title: string }> = [
  { host: "youtube.com", title: "YouTube" },
  { host: "music.youtube.com", title: "YouTube Music" },
  { host: "google.com", title: "Google" },
  { host: "mail.google.com", title: "Gmail" },
  { host: "drive.google.com", title: "Google Drive" },
  { host: "maps.google.com", title: "Google Maps" },
  { host: "github.com", title: "GitHub" },
  { host: "wikipedia.org", title: "Wikipedia" },
  { host: "reddit.com", title: "Reddit" },
  { host: "x.com", title: "X" },
  { host: "facebook.com", title: "Facebook" },
  { host: "instagram.com", title: "Instagram" },
  { host: "linkedin.com", title: "LinkedIn" },
  { host: "whatsapp.com", title: "WhatsApp" },
  { host: "netflix.com", title: "Netflix" },
  { host: "primevideo.com", title: "Prime Video" },
  { host: "hotstar.com", title: "Hotstar" },
  { host: "spotify.com", title: "Spotify" },
  { host: "amazon.in", title: "Amazon India" },
  { host: "amazon.com", title: "Amazon" },
  { host: "flipkart.com", title: "Flipkart" },
  { host: "stackoverflow.com", title: "Stack Overflow" },
  { host: "chatgpt.com", title: "ChatGPT" },
  { host: "openai.com", title: "OpenAI" },
  { host: "nvidia.com", title: "NVIDIA" },
  { host: "microsoft.com", title: "Microsoft" },
  { host: "apple.com", title: "Apple" },
  { host: "notion.so", title: "Notion" },
  { host: "figma.com", title: "Figma" },
  { host: "vercel.com", title: "Vercel" },
  { host: "cloudflare.com", title: "Cloudflare" },
  { host: "discord.com", title: "Discord" },
  { host: "twitch.tv", title: "Twitch" },
  { host: "bing.com", title: "Bing" },
  { host: "duckduckgo.com", title: "DuckDuckGo" },
  { host: "news.ycombinator.com", title: "Hacker News" },
  { host: "medium.com", title: "Medium" },
  { host: "pinterest.com", title: "Pinterest" },
  { host: "ebay.com", title: "eBay" },
  { host: "zoom.us", title: "Zoom" },
];

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "ne", "or"]);

/** Lower-case host without a leading "www.". */
export function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/** "youtube" for youtube.com and music.youtube.com, "bbc" for bbc.co.uk. A guess, good enough for ranking. */
export function hostLabel(host: string): string {
  const parts = bareHost(host).split(".");
  if (parts.length < 2) return parts[0] ?? "";
  if (parts.length >= 3 && SECOND_LEVEL.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2) return parts[parts.length - 3];
  return parts[parts.length - 2];
}

export function parseUrl(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** Two addresses that differ only by scheme, "www.", a trailing slash or a #fragment are the same suggestion. */
export function dedupeKey(url: string): string {
  const u = parseUrl(url);
  if (!u) return url.toLowerCase();
  return `${bareHost(u.hostname)}${u.port ? `:${u.port}` : ""}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
}

export function looksLikeAddress(text: string): boolean {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  if (/^https?:\/\/\S+$/i.test(t) || isInternalUrl(t)) return true;
  return /^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?([/?#]\S*)?$/i.test(t);
}

/** The query is only sent to the search engine when it reads like a search, not like an address or a secret-bearing URL. */
export function isSafeToSendToEngine(query: string): boolean {
  const q = query.trim();
  if (q.length < 1 || q.length > 100) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(q) && !/\s/.test(q)) return false; // any scheme: https:, file:, javascript:, sidb:...
  if (!/\s/.test(q) && /[/\\@?#]/.test(q)) return false; // paths, credentials, query strings
  return true;
}

function tokens(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

type MatchLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** How well one page or site matches. 0 = not at all. 6 = the query is the site's name. */
export function matchLevel(query: string, host: string, title: string, rest: string): MatchLevel {
  const toks = tokens(query);
  if (toks.length === 0) return 0;
  const h = bareHost(host);
  const t = title.toLowerCase();
  const r = rest.toLowerCase();
  const hay = `${h} ${t} ${r}`;
  if (!toks.every((tok) => hay.includes(tok))) return 0;

  if (toks.length === 1) {
    const q = toks[0].replace(/^www\./, "");
    if (q === h || q === hostLabel(h)) return 6;
    if (h.startsWith(q) || hostLabel(h).startsWith(q)) return 5;
    if (h.split(".").some((part) => part.startsWith(q))) return 4;
  }
  const wordStart = (text: string, tok: string) => text.startsWith(tok) || text.includes(` ${tok}`) || text.includes(`-${tok}`) || text.includes(`/${tok}`) || text.includes(`.${tok}`);
  if (toks.every((tok) => wordStart(t, tok) || wordStart(h, tok))) return 3;
  if (toks.every((tok) => r.includes(tok) || h.includes(tok))) return 2;
  return 1;
}

function fineScore(visits: number, lastVisit: number | null, level: MatchLevel, now: number): number {
  const freq = Math.min(300, Math.log2(1 + visits) * 50);
  const age = lastVisit === null ? 365 : Math.max(0, (now - lastVisit) / DAY);
  return freq + 150 * Math.exp(-age / 14) + level * 20;
}

function tierFor(level: MatchLevel, visits: number, lastVisit: number | null, now: number, bookmarkedOnly: boolean): number {
  if (level === 6) return TIER.exactDomain;
  if (bookmarkedOnly) return TIER.bookmark;
  if (visits >= 5) return TIER.frequent;
  if (lastVisit !== null && now - lastVisit < 7 * DAY) return TIER.recent;
  return TIER.history;
}

interface SiteAgg {
  host: string;
  visits: number;
  lastVisit: number;
  title: string;
  favicon: string | null;
  rootUrl: string;
  topVisits: number;
  bookmarked: boolean;
}

/**
 * Local suggestions from history, bookmarks and well-known sites.
 * Per site it returns the site itself first, then at most two of its best pages.
 */
export function rankLocal(query: string, history: SourceRow[], bookmarks: SourceRow[], now: number, popular: ReadonlyArray<{ host: string; title: string }> = POPULAR_SITES): UrlSuggestion[] {
  const q = query.trim();
  if (!q) return [];
  const single = tokens(q).length === 1;
  const bookmarkKeys = new Set(bookmarks.map((b) => dedupeKey(b.url)));

  // Sites you know: history grouped by host.
  const sites = new Map<string, SiteAgg>();
  const pages: UrlSuggestion[] = [];
  const noteSite = (row: SourceRow, u: URL, bookmarked: boolean) => {
    const host = bareHost(u.hostname);
    const visits = row.visitCount ?? 0;
    const cur = sites.get(host);
    const isRoot = u.pathname === "/" && !u.search;
    const better = !cur || visits > cur.topVisits;
    sites.set(host, {
      host,
      visits: (cur?.visits ?? 0) + visits,
      lastVisit: Math.max(cur?.lastVisit ?? 0, row.lastVisit ?? 0),
      title: better && row.title ? row.title : (cur?.title ?? row.title),
      favicon: better && row.favicon ? row.favicon : (cur?.favicon ?? row.favicon),
      rootUrl: isRoot ? u.href : (cur?.rootUrl ?? `${u.protocol}//${u.host}/`),
      topVisits: better ? visits : (cur?.topVisits ?? 0),
      bookmarked: (cur?.bookmarked ?? false) || bookmarked,
    });
  };

  for (const row of history) {
    const u = parseUrl(row.url);
    if (!u) continue;
    const bookmarked = bookmarkKeys.has(dedupeKey(row.url));
    noteSite(row, u, bookmarked);
    const level = matchLevel(q, u.hostname, row.title, `${u.pathname}${u.search}`);
    if (level === 0) continue;
    const visits = row.visitCount ?? 1;
    const last = row.lastVisit ?? null;
    pages.push({
      kind: "url",
      id: `p:${dedupeKey(row.url)}`,
      url: row.url,
      title: row.title || bareHost(u.hostname),
      host: bareHost(u.hostname),
      favicon: row.favicon,
      source: "page",
      bookmarked,
      visits,
      lastVisit: last,
      score: tierFor(level === 6 ? 5 : level, visits, last, now, false) + fineScore(visits, last, level, now) + (bookmarked ? 120 : 0),
    });
  }

  for (const row of bookmarks) {
    const u = parseUrl(row.url);
    if (!u) continue;
    noteSite({ ...row, visitCount: 0 }, u, true);
    const level = matchLevel(q, u.hostname, row.title, `${u.pathname}${u.search}`);
    if (level === 0) continue;
    pages.push({
      kind: "url",
      id: `b:${dedupeKey(row.url)}`,
      url: row.url,
      title: row.title || bareHost(u.hostname),
      host: bareHost(u.hostname),
      favicon: row.favicon,
      source: "bookmark",
      bookmarked: true,
      visits: 0,
      lastVisit: null,
      score: TIER.bookmark + fineScore(0, null, level, now),
    });
  }

  const out: UrlSuggestion[] = [];
  const push = (s: UrlSuggestion) => {
    const key = dedupeKey(s.url);
    const prev = out.find((o) => dedupeKey(o.url) === key);
    if (prev) {
      // The same address from history and bookmarks becomes one row, with the better score and the star.
      prev.bookmarked ||= s.bookmarked;
      prev.score = Math.max(prev.score, s.score);
      prev.favicon ??= s.favicon;
      return;
    }
    out.push(s);
  };

  // Site rows (single-word queries that match a host or a word in it).
  if (single) {
    for (const site of sites.values()) {
      const level = matchLevel(q, site.host, site.title, "");
      if (level < 4) continue;
      const last = site.lastVisit || null;
      push({
        kind: "url",
        id: `s:${site.host}`,
        url: site.rootUrl,
        title: site.title || site.host,
        host: site.host,
        favicon: site.favicon,
        source: "site",
        bookmarked: site.bookmarked,
        visits: site.visits,
        lastVisit: last,
        score: (level === 6 ? TIER.exactDomain : tierFor(level, site.visits, last, now, site.visits === 0)) + fineScore(site.visits, last, level, now) + (site.bookmarked ? 120 : 0) + 40,
      });
    }
    // Well-known sites only fill gaps: nothing from your own data is replaced.
    for (const p of popular) {
      if (sites.has(bareHost(p.host))) continue;
      const level = matchLevel(q, p.host, p.title, "");
      if (level < 5) continue; // popular sites need a real prefix match; a letter inside "news.ycombinator.com" is not enough
      push({ kind: "url", id: `w:${p.host}`, url: `https://${p.host}/`, title: p.title, host: p.host, favicon: null, source: "popular", bookmarked: false, visits: 0, lastVisit: null, score: (level === 6 ? TIER.exactDomain - 500 : TIER.popular) + level * 20 });
    }
  }

  const perHost = new Map<string, number>();
  for (const page of pages.sort((a, b) => b.score - a.score)) {
    const used = perHost.get(page.host) ?? 0;
    if (used >= 2) continue; // do not let one site flood the list
    perHost.set(page.host, used + 1);
    push(page);
  }
  return out.sort((a, b) => b.score - a.score);
}

/** What to show when the box is focused but empty: your most visited sites, then your bookmarks. */
export function rankZeroInput(history: SourceRow[], bookmarks: SourceRow[], now: number, limit = 8): UrlSuggestion[] {
  const bySite = new Map<string, { visits: number; last: number; title: string; favicon: string | null; topVisits: number; url: string }>();
  for (const row of history) {
    const u = parseUrl(row.url);
    if (!u) continue;
    const host = bareHost(u.hostname);
    const v = row.visitCount ?? 1;
    const cur = bySite.get(host);
    const isTop = !cur || v > cur.topVisits;
    bySite.set(host, {
      visits: (cur?.visits ?? 0) + v,
      last: Math.max(cur?.last ?? 0, row.lastVisit ?? 0),
      title: isTop && row.title ? row.title : (cur?.title ?? row.title),
      favicon: isTop && row.favicon ? row.favicon : (cur?.favicon ?? row.favicon),
      topVisits: isTop ? v : (cur?.topVisits ?? 0),
      url: cur?.url ?? `${u.protocol}//${u.host}/`,
    });
  }
  const out: UrlSuggestion[] = [...bySite.entries()]
    .map(([host, s]): UrlSuggestion => ({ kind: "url", id: `s:${host}`, url: s.url, title: s.title || host, host, favicon: s.favicon, source: "site", bookmarked: false, visits: s.visits, lastVisit: s.last || null, score: fineScore(s.visits, s.last || null, 0, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  for (const b of bookmarks) {
    if (out.length >= limit) break;
    const u = parseUrl(b.url);
    if (!u || out.some((o) => dedupeKey(o.url) === dedupeKey(b.url))) continue;
    out.push({ kind: "url", id: `b:${dedupeKey(b.url)}`, url: b.url, title: b.title || bareHost(u.hostname), host: bareHost(u.hostname), favicon: b.favicon, source: "bookmark", bookmarked: true, visits: 0, lastVisit: null, score: 0 });
  }
  return out;
}

/** Clean up an engine's suggestion response (OpenSearch JSON: [query, [suggestions...]]). Anything unexpected becomes an empty list. */
export function sanitizeRemote(json: unknown, query = ""): string[] {
  if (!Array.isArray(json) || !Array.isArray(json[1])) return [];
  const out: string[] = [];
  const seen = new Set([query.trim().toLowerCase()]);
  for (const item of json[1]) {
    if (typeof item !== "string") continue;
    // eslint-disable-next-line no-control-regex
    const text = item.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
    if (!text || text.length > MAX_QUERY_LENGTH) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= 8) break;
  }
  return out;
}

/** Text to complete inline: "yo" becomes "youtube.com" when the best match is a site whose name starts with it. */
export function inlineCompletion(query: string, local: UrlSuggestion[]): { text: string; suggestion: UrlSuggestion } | null {
  if (!query || /[\s/:?#@]/.test(query)) return null;
  const q = query.toLowerCase();
  for (const s of local) {
    if (s.source === "page" || s.source === "bookmark") {
      // A specific page only completes when it is a site's home page.
      const u = parseUrl(s.url);
      if (!u || u.pathname !== "/" || u.search) continue;
    }
    const host = s.host;
    const candidates = [host, `www.${host}`];
    for (const c of candidates) {
      if (c.startsWith(q) && c.length > q.length) {
        const shown = query + c.slice(q.length);
        return { text: shown, suggestion: s };
      }
    }
  }
  return null;
}

export interface Combined {
  items: Suggestion[];
  /** Full text for the address bar when the first row completes what was typed; the part after the typed text is selected. */
  inline: string | null;
}

/** Merges local rows, engine suggestions and the "what you typed" row into the final list. */
export function combine(query: string, local: UrlSuggestion[], remote: string[], opts: { maxRows?: number } = {}): Combined {
  const q = query.trim();
  const max = opts.maxRows ?? MAX_ROWS;
  if (!q) return { items: local.slice(0, max), inline: null };

  const inline = inlineCompletion(query, local);
  const typed: TypedSuggestion = { kind: "typed", id: "typed", text: query, isAddress: looksLikeAddress(q) };

  const ranked: Array<UrlSuggestion | SearchSuggestion> = [...local];
  remote.slice(0, MAX_REMOTE_ROWS).forEach((text, i) => ranked.push({ kind: "search", id: `e:${text.toLowerCase()}`, text, score: TIER.engine - i * 10 }));
  ranked.sort((a, b) => b.score - a.score);

  const first: Suggestion = inline ? inline.suggestion : typed;
  const rows: Suggestion[] = [first];
  const seenUrls = new Set<string>();
  const seenText = new Set<string>([q.toLowerCase()]);
  if (first.kind === "url") seenUrls.add(dedupeKey(first.url));
  if (typed.isAddress) {
    const asUrl = parseUrl(/^https?:\/\//i.test(q) ? q : `https://${q}`);
    if (asUrl) seenUrls.add(dedupeKey(asUrl.href)); // "Go to youtube.com" already covers a youtube.com row
  }
  // When the first row is a site, the typed row still follows it so "search for what I typed" is one arrow press away.
  if (first.kind === "url") rows.push(typed);

  for (const s of ranked) {
    if (rows.length >= max) break;
    if (s.kind === "url") {
      const key = dedupeKey(s.url);
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
    } else {
      const key = s.text.toLowerCase();
      if (seenText.has(key)) continue;
      seenText.add(key);
    }
    rows.push(s);
  }
  return { items: rows, inline: inline ? inline.text : null };
}
