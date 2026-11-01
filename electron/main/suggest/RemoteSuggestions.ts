import { SEARCH_ENGINES, type SearchEngineId } from "../../../shared/constants/search";
import { isSafeToSendToEngine, sanitizeRemote } from "../../../shared/suggest";

const TTL_MS = 5 * 60_000;
const MAX_CACHE = 200;
const TIMEOUT_MS = 2_500;
const MAX_BODY_CHARS = 20_000;

export interface RemoteResult {
  suggestions: string[];
  /** Why there are none, when it is not simply "no suggestions". */
  error?: "disabled" | "skipped" | "network" | "bad-response";
  cached?: boolean;
}

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; text(): Promise<string> }>;

/**
 * Fetches suggestions from the selected search engine's own autocomplete endpoint.
 * Only the typed words are sent (nothing from history or bookmarks), no cookies are attached, and a new
 * request from the same window cancels the previous one.
 */
export class RemoteSuggestions {
  private cache = new Map<string, { at: number; list: string[] }>();
  private inflight = new Map<number, AbortController>();

  constructor(
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init) as ReturnType<FetchLike>,
    private readonly now: () => number = Date.now,
  ) {}

  cancel(windowId: number): void {
    this.inflight.get(windowId)?.abort();
    this.inflight.delete(windowId);
  }

  async fetch(windowId: number, engine: SearchEngineId, query: string): Promise<RemoteResult> {
    const q = query.replace(/\s+/g, " ").trim();
    if (!isSafeToSendToEngine(q)) return { suggestions: [], error: "skipped" };

    const key = `${engine}\n${q.toLowerCase()}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < TTL_MS) {
      this.cache.delete(key);
      this.cache.set(key, hit); // most recently used goes last
      return { suggestions: hit.list, cached: true };
    }

    this.cancel(windowId);
    const controller = new AbortController();
    this.inflight.set(windowId, controller);
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const url = SEARCH_ENGINES[engine].suggest.replace("%s", encodeURIComponent(q));
      const res = await this.fetchImpl(url, { headers: { "user-agent": "SIDB-Browser/0.1", accept: "application/json" }, signal: controller.signal });
      if (!res.ok) return { suggestions: [], error: "network" };
      const body = (await res.text()).slice(0, MAX_BODY_CHARS);
      let json: unknown;
      try {
        json = JSON.parse(body); // engines label this "application/javascript", so the content type is ignored
      } catch {
        return { suggestions: [], error: "bad-response" };
      }
      const list = sanitizeRemote(json, q);
      this.cache.set(key, { at: this.now(), list });
      if (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value as string);
      return { suggestions: list };
    } catch {
      return { suggestions: [], error: "network" }; // includes cancelled and timed-out requests
    } finally {
      clearTimeout(timer);
      if (this.inflight.get(windowId) === controller) this.inflight.delete(windowId);
    }
  }
}
