import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES, type SearchEngineId } from "./constants/search";

export const INTERNAL_SCHEME = "sidb:";
export const INTERNAL_PAGES = ["newtab", "bookmarks", "history", "downloads", "ai", "settings", "shield"] as const;
export type InternalPage = (typeof INTERNAL_PAGES)[number];

const WEB_SCHEMES = new Set(["http:", "https:"]);

export function isInternalUrl(url: string): boolean {
  return url.startsWith("sidb://");
}

export function internalPageOf(url: string): InternalPage | null {
  if (!isInternalUrl(url)) return null;
  const name = url.slice("sidb://".length).replace(/\/+$/, "");
  return (INTERNAL_PAGES as readonly string[]).includes(name) ? (name as InternalPage) : null;
}

/** Only http(s) pages may be loaded into a web view. */
export function isSafeWebUrl(url: string): boolean {
  try {
    return WEB_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

const HOSTNAME_LIKE = /^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?([/?#].*)?$/i;

export function buildSearchUrl(query: string, engine: SearchEngineId = DEFAULT_SEARCH_ENGINE): string {
  return SEARCH_ENGINES[engine].template.replace("%s", encodeURIComponent(query));
}

/**
 * Turns whatever the user typed into a navigable target.
 * Returns an internal sidb:// URL, an http(s) URL, or a search URL.
 * Dangerous schemes (javascript:, file:, data:, ...) become a search query instead of being loaded.
 */
export function normalizeInput(raw: string, engine: SearchEngineId = DEFAULT_SEARCH_ENGINE): string {
  const input = raw.trim();
  if (!input) return "sidb://newtab";

  if (isInternalUrl(input)) return internalPageOf(input) ? input.replace(/\/+$/, "") : "sidb://newtab";

  if (/^https?:\/\//i.test(input)) {
    return isSafeWebUrl(input) ? new URL(input).toString() : buildSearchUrl(input, engine);
  }

  if (!/\s/.test(input) && HOSTNAME_LIKE.test(input)) {
    const candidate = `${/^(localhost|(\d{1,3}\.){3}\d{1,3})(:|\/|$)/i.test(input) ? "http" : "https"}://${input}`;
    if (isSafeWebUrl(candidate)) return new URL(candidate).toString();
  }

  return buildSearchUrl(input, engine);
}
