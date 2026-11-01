import { describe, expect, it, vi } from "vitest";
import { RemoteSuggestions } from "../../electron/main/suggest/RemoteSuggestions";
import { combine, dedupeKey, hostLabel, inlineCompletion, isSafeToSendToEngine, looksLikeAddress, matchLevel, rankLocal, rankZeroInput, sanitizeRemote, TIER, type SourceRow } from "../../shared/suggest";
import { SEARCH_ENGINES } from "../../shared/constants/search";

const NOW = Date.UTC(2026, 10, 1, 12);
const DAY = 86_400_000;
const hist = (url: string, title: string, visitCount: number, daysAgo: number, favicon: string | null = null): SourceRow => ({ url, title, favicon, visitCount, lastVisit: NOW - daysAgo * DAY });
const mark = (url: string, title: string): SourceRow => ({ url, title, favicon: null });

describe("matching", () => {
  it("rates a site's own name highest", () => {
    expect(matchLevel("youtube", "www.youtube.com", "YouTube", "/")).toBe(6);
    expect(matchLevel("youtube.com", "youtube.com", "", "/")).toBe(6);
    expect(matchLevel("yo", "youtube.com", "YouTube", "/")).toBe(5);
    expect(matchLevel("music", "music.youtube.com", "YouTube Music", "/")).toBe(5); // the host itself starts with it
    expect(matchLevel("youtube", "music.youtube.com", "YouTube Music", "/")).toBe(6);
    expect(matchLevel("tube", "youtube.com", "Video site", "/")).toBeLessThan(4);
    expect(matchLevel("zebra", "youtube.com", "YouTube", "/")).toBe(0);
    expect(hostLabel("www.bbc.co.uk")).toBe("bbc");
    expect(hostLabel("music.youtube.com")).toBe("youtube");
  });

  it("treats addresses and secrets-bearing text differently", () => {
    expect(looksLikeAddress("example.com/path")).toBe(true);
    expect(looksLikeAddress("http://localhost:3000")).toBe(true);
    expect(looksLikeAddress("how to cook rice")).toBe(false);
    expect(looksLikeAddress("youtube")).toBe(false);
    expect(isSafeToSendToEngine("how to cook rice")).toBe(true);
    expect(isSafeToSendToEngine("youtube.com")).toBe(true);
    expect(isSafeToSendToEngine("https://internal.corp/page?token=abc")).toBe(false);
    expect(isSafeToSendToEngine("github.com/mycompany/private-repo")).toBe(false);
    expect(isSafeToSendToEngine("user:pass@host")).toBe(false);
    expect(isSafeToSendToEngine("sidb://settings")).toBe(false);
    expect(isSafeToSendToEngine("javascript:alert(1)")).toBe(false);
    expect(isSafeToSendToEngine("x".repeat(101))).toBe(false);
    expect(isSafeToSendToEngine("   ")).toBe(false);
  });

  it("dedupes addresses that differ only by scheme, www, slash or fragment", () => {
    const keys = ["http://www.Example.com/a/", "https://example.com/a#top", "https://example.com/a"].map(dedupeKey);
    expect(new Set(keys).size).toBe(1);
    expect(dedupeKey("https://example.com/a?x=1")).not.toBe(dedupeKey("https://example.com/a?x=2"));
  });
});

describe("local ranking", () => {
  const history = [
    hist("https://www.youtube.com/", "YouTube", 120, 0, "https://www.youtube.com/favicon.ico"),
    hist("https://www.youtube.com/watch?v=abc", "Rust tutorial - YouTube", 6, 1),
    hist("https://www.youtube.com/watch?v=def", "Lo-fi mix - YouTube", 3, 2),
    hist("https://www.youtube.com/watch?v=ghi", "Third video - YouTube", 2, 3),
    hist("https://music.youtube.com/", "YouTube Music", 15, 4),
    hist("https://yoga.example.org/classes", "Yoga classes near me", 1, 40),
    hist("https://old.example.net/yodel", "Yodel history", 1, 200),
  ];
  const bookmarks = [mark("https://yonder.dev/", "Yonder docs"), mark("https://www.youtube.com/", "YouTube")];

  it("puts the site you use most first and folds duplicates into one row", () => {
    const out = rankLocal("yo", history, bookmarks, NOW);
    expect(out[0]).toMatchObject({ host: "youtube.com", source: "site", bookmarked: true });
    expect(out.filter((s) => s.host === "youtube.com" && s.url === "https://www.youtube.com/")).toHaveLength(1);
    expect(out.filter((s) => s.host === "youtube.com").length).toBeLessThanOrEqual(3); // site row + at most two pages
  });

  it("orders frequent, then recent, then older history, then bookmarks, then popular sites", () => {
    const out = rankLocal("yo", history, bookmarks, NOW);
    const idx = (host: string) => out.findIndex((s) => s.host === host);
    expect(idx("youtube.com")).toBeLessThan(idx("music.youtube.com") + 100);
    expect(idx("music.youtube.com")).toBeLessThan(idx("yoga.example.org")); // 15 visits beats a single visit
    expect(idx("yoga.example.org")).toBeLessThan(idx("yonder.dev")); // history beats an unvisited bookmark
    const yonder = out.find((s) => s.host === "yonder.dev")!;
    expect(yonder.score).toBeGreaterThanOrEqual(TIER.bookmark);
    expect(yonder.score).toBeLessThan(TIER.history);
  });

  it("ranks an exact domain above everything, whatever the visit counts", () => {
    const rows = [hist("https://example.com.evil.test/x", "example.com login", 500, 0), hist("https://example.com/", "Example Domain", 1, 300)];
    const out = rankLocal("example.com", rows, [], NOW);
    expect(out[0].host).toBe("example.com");
  });

  it("uses well-known sites only to fill gaps", () => {
    const out = rankLocal("netf", [], [], NOW);
    expect(out[0]).toMatchObject({ host: "netflix.com", source: "popular" });
    const known = rankLocal("netf", [hist("https://netflix.com/browse", "Netflix", 3, 1)], [], NOW);
    expect(known.filter((s) => s.host === "netflix.com")).toHaveLength(2);
    expect(known.some((s) => s.source === "popular" && s.host === "netflix.com")).toBe(false);
  });

  it("matches multi-word queries against titles and paths, and ignores junk addresses", () => {
    const out = rankLocal("rust tutorial", history, [], NOW);
    expect(out[0].title).toMatch(/Rust tutorial/);
    expect(rankLocal("zzzz", history, bookmarks, NOW)).toEqual([]);
    expect(rankLocal("   ", history, bookmarks, NOW)).toEqual([]);
    expect(rankLocal("yo", [{ url: "javascript:alert(1)", title: "yo", favicon: null, visitCount: 9, lastVisit: NOW }, { url: "not a url", title: "yo", favicon: null }], [], NOW).every((s) => s.source === "popular")).toBe(true);
  });

  it("decays old visits: a recent one-off beats an old one-off", () => {
    const out = rankLocal("blog", [hist("https://blog.old.test/", "blog", 1, 300), hist("https://blog.new.test/", "blog", 1, 1)], [], NOW);
    expect(out[0].host).toBe("blog.new.test");
  });

  it("shows most visited sites for an empty box", () => {
    const out = rankZeroInput(history, bookmarks, NOW, 4);
    expect(out[0].host).toBe("youtube.com");
    expect(out.length).toBeLessThanOrEqual(4);
    expect(new Set(out.map((s) => dedupeKey(s.url))).size).toBe(out.length);
  });
});

describe("inline completion and the final list", () => {
  const local = rankLocal("yo", [hist("https://www.youtube.com/", "YouTube", 50, 0)], [], NOW);

  it("completes the typed text to a site and keeps the typed capitalisation", () => {
    expect(inlineCompletion("yo", local)?.text).toBe("youtube.com");
    expect(inlineCompletion("YO", local)?.text).toBe("YOutube.com");
    expect(inlineCompletion("youtube.com", local)).toBeNull(); // nothing left to complete
    expect(inlineCompletion("you tube", local)).toBeNull();
    expect(inlineCompletion("yo/", local)).toBeNull();
    expect(inlineCompletion("", local)).toBeNull();
  });

  it("only completes a specific page when it is a site's home page", () => {
    const deep = rankLocal("rust", [hist("https://rust-lang.org/learn/get-started", "Rust get started", 9, 0)], [], NOW);
    expect(inlineCompletion("rust", deep)?.text).toBe("rust-lang.org"); // the site row, built from the same host
    const pageOnly = [{ ...deep[deep.length - 1], source: "page" as const, url: "https://rust-lang.org/learn" }];
    expect(inlineCompletion("rust", pageOnly)).toBeNull();
  });

  it("builds the list: completed site first, typed text next, then local rows, then engine suggestions", () => {
    const { items, inline } = combine("yo", local, ["youtube", "youtube music", "yono sbi", "yo"]);
    expect(inline).toBe("youtube.com");
    expect(items[0]).toMatchObject({ kind: "url", host: "youtube.com" });
    expect(items[1]).toMatchObject({ kind: "typed", text: "yo" });
    const search = items.filter((i) => i.kind === "search").map((i) => (i as { text: string }).text);
    expect(search).toEqual(["youtube", "youtube music", "yono sbi"]); // the typed text itself is not repeated
    expect(items.length).toBeLessThanOrEqual(10);
  });

  it("starts with what was typed when nothing completes, and never lists an address twice", () => {
    const { items, inline } = combine("how to cook", [], ["how to cook rice", "how to cook pasta"]);
    expect(inline).toBeNull();
    expect(items[0]).toMatchObject({ kind: "typed", isAddress: false });
    expect(items.map((i) => i.kind)).toEqual(["typed", "search", "search"]);

    const site = rankLocal("example.com", [hist("https://example.com/", "Example", 9, 0)], [], NOW);
    const typedAddress = combine("example.com", site, []);
    expect(typedAddress.items[0]).toMatchObject({ kind: "typed", isAddress: true });
    expect(typedAddress.items.filter((i) => i.kind === "url")).toHaveLength(0);
  });

  it("keeps local rows above engine suggestions", () => {
    const local2 = rankLocal("note", [hist("https://notes.example.org/a", "My notes", 1, 100)], [], NOW);
    const { items } = combine("note", local2, ["notebook", "notes app"]);
    const firstSearch = items.findIndex((i) => i.kind === "search");
    const lastUrl = items.map((i) => i.kind).lastIndexOf("url");
    expect(lastUrl).toBeLessThan(firstSearch);
  });
});

describe("engine responses", () => {
  it("accepts OpenSearch arrays and drops everything unexpected", () => {
    expect(sanitizeRemote(["yo", ["youtube", " youtube music ", "YOUTUBE", "yo", 5, null, "", "a\u0000b\nc"]], "yo")).toEqual(["youtube", "youtube music", "a b c"]);
    expect(sanitizeRemote({ suggestions: ["a"] })).toEqual([]);
    expect(sanitizeRemote(["q", "not an array"])).toEqual([]);
    expect(sanitizeRemote(null)).toEqual([]);
    expect(sanitizeRemote(["q", Array.from({ length: 30 }, (_, i) => `s${i}`)])).toHaveLength(8);
    expect(sanitizeRemote(["q", ["x".repeat(300)]])).toEqual([]);
  });

  it("keeps markup as inert text", () => {
    expect(sanitizeRemote(["q", ['<img src=x onerror=alert(1)>', "<script>alert(1)</script>"]])).toEqual(['<img src=x onerror=alert(1)>', "<script>alert(1)</script>"]);
  });
});

describe("remote suggestion fetching", () => {
  const ok = (json: unknown) => ({ ok: true, text: async () => JSON.stringify(json) });

  it("asks only the selected engine's endpoint and sends only the typed words", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return ok(["yo", ["youtube", "youtube music"]]);
    });
    const svc = new RemoteSuggestions(fetchImpl as never);
    expect(await svc.fetch(1, "duckduckgo", "  yo  ")).toEqual({ suggestions: ["youtube", "youtube music"] });
    expect(calls[0]).toBe(SEARCH_ENGINES.duckduckgo.suggest.replace("%s", "yo"));
    expect(calls[0]).not.toContain("google");
    const init = (fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1];
    expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain("cookie");
  });

  it("uses each engine's own template", async () => {
    const urls: string[] = [];
    const svc = new RemoteSuggestions((async (u: string) => (urls.push(u), ok(["a b", []]))) as never);
    for (const engine of ["google", "duckduckgo", "bing", "brave"] as const) await svc.fetch(1, engine, "a b");
    expect(urls.map((u) => new URL(u).hostname)).toEqual(["suggestqueries.google.com", "duckduckgo.com", "api.bing.com", "search.brave.com"]);
    expect(urls.every((u) => u.includes("a%20b"))).toBe(true);
  });

  it("never sends addresses, secrets or empty text", async () => {
    const fetchImpl = vi.fn(async () => ok(["x", ["y"]]));
    const svc = new RemoteSuggestions(fetchImpl as never);
    for (const q of ["https://bank.example/account?token=1", "a@b.c", "file:///c/secret.txt", "", "  "]) {
      expect(await svc.fetch(1, "google", q)).toEqual({ suggestions: [], error: "skipped" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caches answers for a few minutes, per engine", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn(async () => ok(["q", ["one"]]));
    const svc = new RemoteSuggestions(fetchImpl as never, () => now);
    await svc.fetch(1, "google", "Query");
    expect(await svc.fetch(1, "google", "query")).toMatchObject({ suggestions: ["one"], cached: true });
    await svc.fetch(1, "bing", "query");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    now += 6 * 60_000;
    await svc.fetch(1, "google", "query");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("cancels the previous request of the same window when a new one starts", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn(async (_u: string, init: { signal: AbortSignal }) => {
      signals.push(init.signal);
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        if (signals.length === 2) resolve(ok(["b", ["second thing"]]));
      });
    });
    const svc = new RemoteSuggestions(fetchImpl as never);
    const first = svc.fetch(7, "google", "first");
    await new Promise((r) => setTimeout(r, 0));
    const second = svc.fetch(7, "google", "second");
    expect(await first).toMatchObject({ suggestions: [], error: "network" });
    expect(signals[0].aborted).toBe(true);
    expect(await second).toEqual({ suggestions: ["second thing"] });
    expect(signals[1].aborted).toBe(false);
  });

  it("does not cancel other windows, and reports failures calmly", async () => {
    const svc = new RemoteSuggestions((async () => { throw new TypeError("offline"); }) as never);
    expect(await svc.fetch(1, "google", "hello")).toEqual({ suggestions: [], error: "network" });
    const bad = new RemoteSuggestions((async () => ({ ok: true, text: async () => "<html>captive portal</html>" })) as never);
    expect(await bad.fetch(1, "google", "hello")).toEqual({ suggestions: [], error: "bad-response" });
    const http = new RemoteSuggestions((async () => ({ ok: false, text: async () => "" })) as never);
    expect(await http.fetch(1, "google", "hello")).toEqual({ suggestions: [], error: "network" });
  });
});
