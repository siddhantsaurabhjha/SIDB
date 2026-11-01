import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decide, engineStats, parseCustomRules, parseEngine, cosmeticsFor } from "../../electron/main/shield/engine";
import { FILTER_LISTS } from "../../electron/main/shield/lists";
import { SafeBrowsingClient, canonicalize, urlExpressions } from "../../electron/main/shield/safeBrowsing";
import { listVersion, validateList, validateResources } from "../../electron/main/shield/validate";
import { normalizeHost } from "../../electron/main/services/ShieldDataService";

const easylist = FILTER_LISTS.find((l) => l.id === "easylist")!;
const goodList = `[Adblock Plus 2.0]\n! Title: EasyList\n! Version: 202611010335\n${"||ads.example.com^\n".repeat(100)}`;

describe("filter list validation", () => {
  it("accepts a genuine list and reads its version", () => {
    expect(() => validateList(easylist, goodList)).not.toThrow();
    expect(listVersion(goodList)).toBe("202611010335");
  });

  it("rejects HTML error pages, tiny files, wrong titles and headerless text", () => {
    expect(() => validateList(easylist, `<!DOCTYPE html><html>${"x".repeat(2000)}</html>`)).toThrow(/web page/);
    expect(() => validateList(easylist, "! Title: EasyList")).toThrow(/small/);
    expect(() => validateList(easylist, goodList.replace("EasyList", "SomethingElse"))).toThrow(/title/);
    expect(() => validateList(easylist, "x".repeat(2000))).toThrow(/header/);
  });

  it("rejects a version that shrank to under half the previous size", () => {
    expect(() => validateList(easylist, goodList, goodList.length * 3)).toThrow(/half/);
    expect(() => validateList(easylist, goodList, goodList.length)).not.toThrow();
  });

  it("validates resources JSON", () => {
    expect(() => validateResources('{"a":1}')).not.toThrow();
    expect(() => validateResources("<html>")).toThrow();
  });
});

describe("blocking engine", () => {
  const main = parseEngine(["||ads.example.com^", "||tracker.test^$third-party", "example.org##.banner", "@@||ads.example.com/allowed.js^"].join("\n"));

  it("blocks listed requests and allows others", () => {
    const base = { pageUrl: "https://news.test/", type: "script", id: 1, tabId: 1 };
    expect(decide(main, null, { ...base, url: "https://ads.example.com/x.js" }).action).toBe("block");
    expect(decide(main, null, { ...base, url: "https://cdn.news.test/app.js" }).action).toBe("allow");
    expect(decide(main, null, { ...base, url: "https://ads.example.com/allowed.js" }).action).toBe("allow");
  });

  it("applies $third-party only to third-party requests", () => {
    const r = (pageUrl: string) => decide(main, null, { url: "https://tracker.test/p.gif", pageUrl, type: "image", id: 2, tabId: 1 }).action;
    expect(r("https://news.test/")).toBe("block");
    expect(r("https://tracker.test/home")).toBe("allow");
  });

  it("lets custom rules add blocks and exceptions for their own rules", () => {
    const custom = parseCustomRules("||mine.test^\n@@||mine.test/ok/");
    const base = { pageUrl: "https://news.test/", type: "script", id: 3, tabId: 1 };
    expect(decide(main, custom, { ...base, url: "https://mine.test/a.js" }).action).toBe("block");
    expect(decide(main, custom, { ...base, url: "https://mine.test/ok/a.js" }).action).toBe("allow");
    expect(parseCustomRules("   ")).toBeNull();
  });

  it("returns element-hiding CSS for matching sites only", () => {
    const q = { url: "https://example.org/", hostname: "example.org", domain: "example.org", first: true, frameId: 0, processId: 1 };
    expect(cosmeticsFor(main, null, q).styles).toContain(".banner");
    expect(cosmeticsFor(main, null, { ...q, url: "https://other.test/", hostname: "other.test", domain: "other.test" }).styles).not.toContain(".banner");
  });

  it("survives garbage custom rules", () => {
    expect(() => parseCustomRules("###\n||\n@@@@\n!!!! ((")).not.toThrow();
    expect(engineStats(main).network).toBeGreaterThan(0);
  });
});

describe("Safe Browsing URL expressions", () => {
  it("matches Google's documented examples", () => {
    expect(urlExpressions("http://a.b.c/1/2.html?param=1")).toEqual([
      "a.b.c/1/2.html?param=1",
      "a.b.c/1/2.html",
      "a.b.c/",
      "a.b.c/1/",
      "b.c/1/2.html?param=1",
      "b.c/1/2.html",
      "b.c/",
      "b.c/1/",
    ]);
    expect(urlExpressions("http://a.b.c.d.e.f.g/1.html").filter((e) => e.endsWith("/1.html"))).toEqual(["a.b.c.d.e.f.g/1.html", "c.d.e.f.g/1.html", "d.e.f.g/1.html", "e.f.g/1.html", "f.g/1.html"]);
  });

  it("canonicalizes hosts, fragments and repeated escapes", () => {
    expect(canonicalize("http://host/%25%32%35")).toMatchObject({ host: "host", path: "/%25" });
    expect(canonicalize("http://www.GOOgle.com./q?r#frag")).toMatchObject({ host: "www.google.com", path: "/q", query: "r" });
    expect(canonicalize("http://host//twoslashes///x")).toMatchObject({ path: "/twoslashes/x" });
    expect(canonicalize("ftp://nope/")).toBeNull();
  });

  it("never looks up more than 30 expressions", () => {
    expect(urlExpressions("http://a.b.c.d.e.f.g.h/1/2/3/4/5/6/7/x.html?q=1").length).toBeLessThanOrEqual(30);
  });
});

describe("Safe Browsing client", () => {
  const url = "https://evil.example/login";
  const hash = (e: string) => createHash("sha256").update(e).digest();
  const evilHash = hash("evil.example/login");

  const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

  it("sends only 4-byte prefixes and flags a full-hash match", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (u: string) => {
      calls.push(u);
      return reply({ fullHashes: [{ fullHash: evilHash.toString("base64"), fullHashDetails: [{ threatType: "SOCIAL_ENGINEERING" }] }], cacheDuration: "300s" });
    });
    const client = new SafeBrowsingClient(() => "KEY_1234567890", fetchImpl);
    expect(await client.check(url)).toEqual(["Phishing or deceptive site"]);
    expect(calls[0]).not.toContain("evil.example");
    expect(calls[0]).not.toContain("KEY_1234567890"); // key travels in a header, not the URL
    const prefixes = new URL(calls[0]).searchParams.getAll("hashPrefixes").map((p) => Buffer.from(p, "base64"));
    expect(prefixes.every((p) => p.length === 4)).toBe(true);
  });

  it("caches results, including empty ones", async () => {
    const fetchImpl = vi.fn(async () => reply({ cacheDuration: "300s" }));
    const client = new SafeBrowsingClient(() => "KEY_1234567890", fetchImpl);
    expect(await client.check("https://fine.example/")).toBeNull();
    expect(await client.check("https://fine.example/")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("ignores prefix collisions, canary, frame-only and unknown entries", async () => {
    const fetchImpl = async () =>
      reply({
        fullHashes: [
          { fullHash: hash("something-else").toString("base64"), fullHashDetails: [{ threatType: "MALWARE" }] },
          { fullHash: evilHash.toString("base64"), fullHashDetails: [{ threatType: "MALWARE", attributes: ["CANARY"] }, { threatType: "FUTURE_THREAT" }, { threatType: "MALWARE", attributes: ["NEW_ATTR"] }] },
        ],
        cacheDuration: "60s",
      });
    expect(await new SafeBrowsingClient(() => "KEY_1234567890", fetchImpl).check(url)).toBeNull();
  });

  it("fails open and backs off on errors, and does nothing without a key", async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn(async () => reply({}, 429));
    const client = new SafeBrowsingClient(() => "KEY_1234567890", fetchImpl, () => now);
    expect(await client.check(url)).toBeNull();
    expect(client.lastError).toMatch(/429/);
    await client.check(url);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // backing off
    now += 61_000;
    await client.check(url);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const noKey = vi.fn();
    expect(await new SafeBrowsingClient(() => null, noKey as never).check(url)).toBeNull();
    expect(noKey).not.toHaveBeenCalled();
  });
});

describe("site exception hosts", () => {
  it("normalizes user input", () => {
    expect(normalizeHost("https://www.Example.com/path?q=1")).toBe("example.com");
    expect(normalizeHost("example.com")).toBe("example.com");
    expect(normalizeHost("localhost")).toBe("localhost");
    expect(normalizeHost("not a host")).toBeNull();
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("javascript:alert(1)")).toBeNull();
  });
});
