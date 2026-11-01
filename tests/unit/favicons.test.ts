import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FaviconService } from "../../electron/main/favicons/FaviconService";
import { detectImage, isAllowedIconUrl, isPrivateHost, isSafeSvg, originOf, parseLinkIcons, pixelSize, sortCandidates } from "../../electron/main/favicons/parse";

function png(w: number, h = w): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function ico(...sizes: number[]): Buffer {
  const b = Buffer.alloc(6 + sizes.length * 16 + 8);
  b.writeUInt16LE(1, 2);
  b.writeUInt16LE(sizes.length, 4);
  sizes.forEach((s, i) => {
    b[6 + i * 16] = s >= 256 ? 0 : s;
    b[7 + i * 16] = s >= 256 ? 0 : s;
  });
  return b;
}
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red"/></svg>');

describe("icon parsing", () => {
  const html = `<html><head>
    <link rel="stylesheet" href="/a.css">
    <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png">
    <link rel="shortcut icon" href='/fav.ico'>
    <link rel="apple-touch-icon" href="touch.png">
    <link rel="icon" type="image/svg+xml" href="https://cdn.example.com/logo.svg">
    <link rel="icon" href="javascript:alert(1)">
    <link rel="icon" href="data:image/png;base64,AAAA">
    <link rel="mask-icon" href="/mask.svg">
    <link rel="icon" href="/favicon-32.png?v=1&amp;x=2" sizes="32x32 64x64">
    </head></html>`;

  it("reads declared icons, resolves relative addresses and drops non-web ones", () => {
    const found = parseLinkIcons(html, "https://example.com/section/");
    const urls = found.map((c) => c.url);
    expect(urls).toContain("https://example.com/favicon-16.png");
    expect(urls).toContain("https://example.com/section/touch.png");
    expect(urls).toContain("https://cdn.example.com/logo.svg");
    expect(urls).toContain("https://example.com/favicon-32.png?v=1&x=2");
    expect(urls.some((u) => u.startsWith("javascript:") || u.startsWith("data:") || u.includes("mask"))).toBe(false);
    expect(found.find((c) => c.url.endsWith("favicon-32.png?v=1&x=2"))?.size).toBe(64);
  });

  it("tries the sharpest candidates first", () => {
    const order = sortCandidates(parseLinkIcons(html, "https://example.com/")).map((c) => c.url);
    expect(order[0]).toBe("https://cdn.example.com/logo.svg"); // vector
    expect(order.indexOf("https://example.com/favicon-32.png?v=1&x=2")).toBeLessThan(order.indexOf("https://example.com/favicon-16.png"));
  });

  it("only accepts web origins", () => {
    expect(originOf("https://a.com:8443/x?y#z")).toBe("https://a.com:8443");
    for (const bad of ["file:///c:/x.png", "javascript:alert(1)", "data:image/png;base64,AA", "ftp://x.com/a.ico", "not a url", "sidb://newtab"]) expect(originOf(bad)).toBeNull();
  });
});

describe("what may be fetched", () => {
  it("keeps icon requests off local and private networks", () => {
    for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "[::1]", "printer.local", "nas.lan", "intranet", "fd00::1", "100.64.0.1"]) expect(isPrivateHost(h), h).toBe(true);
    for (const h of ["example.com", "cdn.example.co.uk", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateHost(h), h).toBe(false);
  });

  it("lets a site on its own local address use its own icons only", () => {
    expect(isAllowedIconUrl("http://localhost:3000/favicon.ico", "localhost")).toBe(true);
    expect(isAllowedIconUrl("http://192.168.1.1/x.ico", "example.com")).toBe(false);
    expect(isAllowedIconUrl("https://user:pw@example.com/x.ico", "example.com")).toBe(false);
    expect(isAllowedIconUrl("file:///etc/passwd", "example.com")).toBe(false);
  });
});

describe("image checking", () => {
  it("identifies images by content and reads their size", () => {
    expect(detectImage(png(64))).toMatchObject({ mime: "image/png", width: 64, height: 64 });
    expect(detectImage(ico(16, 32, 48))).toMatchObject({ mime: "image/x-icon", width: 48 });
    expect(detectImage(ico(256))).toMatchObject({ width: 256 });
    expect(detectImage(SVG)?.mime).toBe("image/svg+xml");
    const gif = Buffer.alloc(16);
    gif.write("GIF89a", 0, "latin1");
    gif.writeUInt16LE(24, 6);
    gif.writeUInt16LE(24, 8);
    expect(detectImage(gif)).toMatchObject({ mime: "image/gif", width: 24 });
    const webp = Buffer.alloc(32);
    webp.write("RIFF", 0, "latin1");
    webp.write("WEBP", 8, "latin1");
    webp.write("VP8X", 12, "latin1");
    webp.writeUIntLE(63, 24, 3);
    webp.writeUIntLE(63, 27, 3);
    expect(detectImage(webp)).toMatchObject({ mime: "image/webp", width: 64 });
    expect(pixelSize(detectImage(SVG)!)).toBe(Infinity);
  });

  it("refuses HTML, scripts, oversize files and unsafe SVG", () => {
    expect(detectImage(Buffer.from("<!doctype html><html><title>404 Not Found</title></html>"))).toBeNull();
    expect(detectImage(Buffer.from("MZ\u0090\u0000\u0003\u0000\u0000\u0000"))).toBeNull();
    expect(detectImage(Buffer.alloc(300 * 1024, 1))).toBeNull();
    expect(detectImage(Buffer.alloc(0))).toBeNull();
    for (const evil of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>hi</div></foreignObject></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://tracker.example/p.png"/></svg>',
      '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>',
    ]) {
      expect(isSafeSvg(evil), evil).toBe(false);
      expect(detectImage(Buffer.from(evil))).toBeNull();
    }
  });
});

describe("FaviconService", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidb-fav-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** A tiny fake web: url -> response. Everything else is a 404. */
  function web(routes: Record<string, () => Response | Promise<Response>>) {
    const log: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      log.push(url);
      const route = routes[url];
      return route ? route() : new Response("not found", { status: 404 });
    });
    return { fetchImpl, log };
  }
  const htmlPage = (links: string) => () => new Response(`<html><head>${links}</head><body></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
  const bin = (b: Buffer) => () => new Response(new Uint8Array(b), { status: 200 });
  const make = (fetchImpl: ReturnType<typeof web>["fetchImpl"], extra: Partial<ConstructorParameters<typeof FaviconService>[0]> = {}) => new FaviconService({ dir, fetchImpl: fetchImpl as never, ...extra });
  const mimeOf = (dataUrl: string | null) => /^data:([^;]+);/.exec(dataUrl ?? "")?.[1];

  it("prefers the icon the page declares over /favicon.ico", async () => {
    const { fetchImpl, log } = web({
      "https://site.test/": htmlPage('<link rel="icon" href="/logo-64.png" sizes="64x64">'),
      "https://site.test/logo-64.png": bin(png(64)),
      "https://site.test/favicon.ico": bin(ico(16)),
    });
    const icon = await make(fetchImpl).get("https://site.test/some/page?token=1");
    expect(mimeOf(icon)).toBe("image/png");
    expect(log).toEqual(["https://site.test/", "https://site.test/logo-64.png"]); // sharp enough: nothing else was requested
  });

  it("falls back to /favicon.ico, and ignores a soft-404 page served in its place", async () => {
    const ok = web({ "https://a.test/": htmlPage(""), "https://a.test/favicon.ico": bin(ico(32)) });
    expect(mimeOf(await make(ok.fetchImpl).get("https://a.test/"))).toBe("image/x-icon");

    const soft = web({ "https://b.test/": htmlPage(""), "https://b.test/favicon.ico": () => new Response("<html>Oops, not found</html>", { status: 200 }) });
    expect(await make(soft.fetchImpl).get("https://b.test/")).toBeNull();
  });

  it("looks further when the first icon is tiny, and keeps the sharpest one", async () => {
    const { fetchImpl } = web({
      "https://c.test/": htmlPage(""),
      "https://c.test/favicon.ico": bin(ico(16)),
      "https://c.test/apple-touch-icon.png": bin(png(180)),
    });
    const icon = await make(fetchImpl).get("https://c.test/");
    expect(mimeOf(icon)).toBe("image/png");
  });

  it("uses an icon address it was told about without downloading the page", async () => {
    const { fetchImpl, log } = web({ "https://d.test/assets/i.png": bin(png(48)) });
    const svc = make(fetchImpl);
    await svc.learn("https://d.test/page", ["https://d.test/assets/i.png"]);
    expect(log).toEqual(["https://d.test/assets/i.png"]);
    expect(mimeOf(await svc.get("https://d.test/other"))).toBe("image/png");
    expect(log).toHaveLength(1); // served from the cache
  });

  it("keeps icons across restarts and does not download the same icon twice", async () => {
    const { fetchImpl, log } = web({ "https://e.test/": htmlPage('<link rel="icon" href="/i.png" sizes="48x48">'), "https://e.test/i.png": bin(png(48)) });
    const first = await make(fetchImpl).get("https://e.test/");
    const afterFirst = log.length;
    const second = await make(fetchImpl).get("https://e.test/x"); // a new service object over the same folder
    expect(second).toBe(first);
    expect(log.length).toBe(afterFirst);
    expect(fs.readdirSync(dir).some((f) => f.endsWith(".img"))).toBe(true);
  });

  it("shares one download between simultaneous requests", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { fetchImpl, log } = web({
      "https://f.test/": async () => {
        await gate;
        return htmlPage('<link rel="icon" href="/i.png" sizes="48x48">')();
      },
      "https://f.test/i.png": bin(png(48)),
    });
    const svc = make(fetchImpl);
    const all = Promise.all([svc.get("https://f.test/a"), svc.get("https://f.test/b"), svc.get("https://f.test/c")]);
    release();
    const [a, b, c] = await all;
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(log.filter((u) => u === "https://f.test/i.png")).toHaveLength(1);
  });

  it("remembers that a site has no icon, then looks again after a few days", async () => {
    let now = 1_000_000;
    const { fetchImpl, log } = web({ "https://g.test/": htmlPage("") });
    const svc = make(fetchImpl, { now: () => now });
    expect(await svc.get("https://g.test/")).toBeNull();
    const asked = log.length;
    now += 61_000;
    expect(await make(fetchImpl, { now: () => now }).get("https://g.test/")).toBeNull();
    expect(log.length).toBe(asked); // negative answer was cached
    now += 4 * 86_400_000;
    await make(fetchImpl, { now: () => now }).get("https://g.test/");
    await new Promise((r) => setTimeout(r, 20));
    expect(log.length).toBeGreaterThan(asked);
  });

  it("shows a stale icon immediately and refreshes it in the background; a failed refresh keeps the old one", async () => {
    let now = 1_000_000;
    let version = 1;
    const routes = {
      "https://h.test/": htmlPage('<link rel="icon" href="/i.png" sizes="48x48">'),
      "https://h.test/i.png": () => new Response(new Uint8Array(png(version === 1 ? 48 : 96)), { status: 200 }),
    };
    const { fetchImpl } = web(routes);
    const old = await make(fetchImpl, { now: () => now }).get("https://h.test/");
    now += 8 * 86_400_000;
    version = 2;
    const stale = await make(fetchImpl, { now: () => now }).get("https://h.test/");
    expect(stale).toBe(old); // instant, old picture
    await new Promise((r) => setTimeout(r, 30));
    const refreshed = await make(fetchImpl, { now: () => now + 61_000 }).get("https://h.test/");
    expect(refreshed).not.toBe(old);

    // offline later: still the cached icon
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    now += 30 * 86_400_000;
    expect(await new FaviconService({ dir, fetchImpl: offline as never, now: () => now }).get("https://h.test/")).toBe(refreshed);
  });

  it("does not cache a failure caused by being offline as 'no icon'", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await make(offline as never).get("https://i.test/")).toBeNull();
    const { fetchImpl } = web({ "https://i.test/": htmlPage('<link rel="icon" href="/i.png" sizes="48x48">'), "https://i.test/i.png": bin(png(48)) });
    const later = new FaviconService({ dir, fetchImpl: fetchImpl as never, now: () => Date.now() + 11 * 60_000 });
    expect(mimeOf(await later.get("https://i.test/"))).toBe("image/png");
  });

  it("never fetches local files or private network addresses, even when a page asks for them", async () => {
    const { fetchImpl, log } = web({
      "https://j.test/": htmlPage('<link rel="icon" href="http://192.168.1.1/admin.png"><link rel="icon" href="http://localhost:9/x.png"><link rel="icon" href="file:///c:/secret.png">'),
      "https://j.test/favicon.ico": bin(ico(32)),
    });
    await make(fetchImpl).learn("https://j.test/", ["file:///c:/secret.png", "http://10.0.0.1/a.png", "ftp://j.test/i.ico", "javascript:alert(1)"]);
    await make(fetchImpl).get("https://j.test/");
    expect(log.some((u) => /192\.168|localhost|file:|10\.0\.0|ftp:|javascript:/.test(u))).toBe(false);
  });

  it("checks every redirect step", async () => {
    const { fetchImpl, log } = web({
      "https://k.test/": htmlPage('<link rel="icon" href="/go" sizes="48x48">'),
      "https://k.test/go": () => new Response(null, { status: 302, headers: { location: "http://192.168.0.10/internal.png" } }),
      "https://k.test/favicon.ico": bin(ico(32)),
    });
    const icon = await make(fetchImpl).get("https://k.test/");
    expect(log.some((u) => u.includes("192.168"))).toBe(false);
    expect(mimeOf(icon)).toBe("image/x-icon"); // the fallback still worked

    const ok = web({
      "https://l.test/": htmlPage('<link rel="icon" href="/hop1" sizes="48x48">'),
      "https://l.test/hop1": () => new Response(null, { status: 301, headers: { location: "/real.png" } }),
      "https://l.test/real.png": bin(png(48)),
    });
    expect(mimeOf(await make(ok.fetchImpl).get("https://l.test/"))).toBe("image/png");
  });

  it("rejects oversized icons and stops reading huge pages early", async () => {
    const big = Buffer.concat([png(64), Buffer.alloc(400 * 1024)]);
    const { fetchImpl } = web({ "https://m.test/": htmlPage('<link rel="icon" href="/big.png" sizes="64x64">'), "https://m.test/big.png": bin(big) });
    expect(await make(fetchImpl).get("https://m.test/")).toBeNull();

    const hugeHead = () => new Response(`<html><head>${"<meta charset=x>".repeat(40_000)}<link rel="icon" href="/late.png"></head></html>`, { status: 200 });
    const late = web({ "https://n.test/": hugeHead, "https://n.test/late.png": bin(png(64)) });
    expect(await make(late.fetchImpl).get("https://n.test/")).toBeNull(); // the link sits past the 256 KB cut-off, and no root file exists
  });

  it("serves only web addresses", async () => {
    const { fetchImpl, log } = web({});
    const svc = make(fetchImpl);
    for (const bad of ["file:///c:/a.html", "sidb://newtab", "javascript:1", "about:blank", ""]) expect(await svc.get(bad)).toBeNull();
    expect(log).toHaveLength(0);
  });

  it("keeps a memory-only service off the disk, while reusing the profile's cache", async () => {
    const profile = make(web({ "https://o.test/": htmlPage('<link rel="icon" href="/i.png" sizes="48x48">'), "https://o.test/i.png": bin(png(48)) }).fetchImpl);
    const known = await profile.get("https://o.test/");

    const priv = web({ "https://p.test/": htmlPage('<link rel="icon" href="/i.png" sizes="48x48">'), "https://p.test/i.png": bin(png(48)), "https://o.test/": htmlPage("") });
    const memoryOnly = new FaviconService({ dir: null, parent: profile, fetchImpl: priv.fetchImpl as never });
    expect(await memoryOnly.get("https://o.test/")).toBe(known); // from the profile cache, no request
    expect(priv.log).toEqual([]);
    const before = fs.readdirSync(dir).sort();
    expect(mimeOf(await memoryOnly.get("https://p.test/"))).toBe("image/png");
    expect(mimeOf(await memoryOnly.get("https://p.test/again"))).toBe("image/png");
    expect(fs.readdirSync(dir).sort()).toEqual(before); // nothing about p.test reached the disk
  });

  it("ignores a damaged cache file and can be cleared and pruned", async () => {
    const { fetchImpl } = web({ "https://q.test/": htmlPage('<link rel="icon" href="/i.png" sizes="48x48">'), "https://q.test/i.png": bin(png(48)) });
    const svc = make(fetchImpl);
    await svc.get("https://q.test/");
    const img = fs.readdirSync(dir).find((f) => f.endsWith(".img"))!;
    fs.writeFileSync(path.join(dir, img), "<html>tampered</html>");
    expect(mimeOf(await make(fetchImpl).get("https://q.test/"))).toBe("image/png"); // re-fetched instead of trusting the file

    expect(svc.clear()).toBeGreaterThan(0);
    expect(fs.readdirSync(dir)).toEqual([]);
    svc.prune();
  });
});
