/** Pure helpers for finding and checking website icons. Nothing here touches the network or the disk. */

export interface IconCandidate {
  url: string;
  /** Declared edge length in CSS pixels, or 0 when the page did not say. */
  size: number;
  type: string;
  rel: string;
}

export interface ImageInfo {
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/x-icon" | "image/svg+xml";
  /** Largest pixel size inside the file; 0 for vector images, which scale freely. */
  width: number;
  height: number;
}

export const MAX_ICON_BYTES = 256 * 1024;
export const MAX_HTML_BYTES = 256 * 1024;

/** "https://example.com:8080" for any http(s) address; null for anything else. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Only web addresses may be used as an icon source. file:, data:, javascript:, ftp: and friends are refused. */
export function isWebUrl(url: string): boolean {
  return originOf(url) !== null;
}

/**
 * Local and private network addresses are never fetched for an icon, so a page cannot make SIDB probe your
 * network by declaring an icon at http://192.168.1.1/. A site that itself lives at such an address may use it.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home") || h.endsWith(".corp")) return true;
  if (!h.includes(".") && !h.includes(":")) return true; // single-label intranet names
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(":")) return h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:");
  return false;
}

/** May this icon address be fetched for a page on `pageHost`? */
export function isAllowedIconUrl(iconUrl: string, pageHost: string): boolean {
  let u: URL;
  try {
    u = new URL(iconUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  return u.hostname === pageHost || !isPrivateHost(u.hostname);
}

const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function sizeOf(sizes: string | undefined, type: string, rel: string, href: string): number {
  const isSvg = /svg/i.test(type) || /\.svg(\?|#|$)/i.test(href);
  if (sizes) {
    const values = [...sizes.matchAll(/(\d+)x(\d+)/gi)].map((m) => Math.min(Number(m[1]), Number(m[2])));
    if (values.length) return Math.max(...values);
    if (/any/i.test(sizes)) return 256;
  }
  if (isSvg) return 256;
  if (/apple-touch-icon/i.test(rel)) return 180;
  return 0;
}

/** Reads `<link rel="icon">`, `shortcut icon` and `apple-touch-icon` tags. Relative addresses are resolved against `baseUrl`. */
export function parseLinkIcons(html: string, baseUrl: string): IconCandidate[] {
  const head = html.slice(0, MAX_HTML_BYTES);
  const out: IconCandidate[] = [];
  const seen = new Set<string>();
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(ATTR)) attrs[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    const rel = (attrs.rel ?? "").toLowerCase();
    const tokens = rel.split(/\s+/);
    const isIcon = tokens.includes("icon") || tokens.includes("apple-touch-icon") || tokens.includes("apple-touch-icon-precomposed");
    if (!isIcon || !attrs.href) continue;
    let url: string;
    try {
      url = new URL(attrs.href.replace(/&amp;/g, "&"), baseUrl).href;
    } catch {
      continue;
    }
    if (!isWebUrl(url) || seen.has(url)) continue;
    seen.add(url);
    const type = (attrs.type ?? "").toLowerCase();
    out.push({ url, size: sizeOf(attrs.sizes, type, rel, url), type, rel });
  }
  return out;
}

/** Estimated sharpness of a candidate, used to try the best looking icons first. */
export function candidateQuality(c: IconCandidate): number {
  const isSvg = /svg/i.test(c.type) || /\.svg(\?|#|$)/i.test(c.url);
  const isIco = /icon$|ico/i.test(c.type) && !/png|svg|webp/i.test(c.type) ? true : /\.ico(\?|#|$)/i.test(c.url);
  const base = c.size || (isSvg ? 256 : isIco ? 32 : 24);
  return Math.min(base, 256) + (isSvg ? 40 : 0);
}

export function sortCandidates(list: IconCandidate[]): IconCandidate[] {
  return list.map((c, i) => ({ c, i })).sort((a, b) => candidateQuality(b.c) - candidateQuality(a.c) || a.i - b.i).map((x) => x.c);
}

/** Files that browsers and sites commonly use when a page declares no usable icon. */
export function rootGuesses(origin: string): IconCandidate[] {
  return [
    { url: `${origin}/favicon.ico`, size: 0, type: "image/x-icon", rel: "root" },
    { url: `${origin}/apple-touch-icon.png`, size: 180, type: "image/png", rel: "root" },
    { url: `${origin}/favicon.png`, size: 0, type: "image/png", rel: "root" },
    { url: `${origin}/favicon.svg`, size: 256, type: "image/svg+xml", rel: "root" },
  ];
}

/** SVG is shown through an image element, where scripts never run, but unusual files are refused anyway. */
export function isSafeSvg(text: string): boolean {
  if (text.length > MAX_ICON_BYTES) return false;
  if (!/<svg[\s>]/i.test(text)) return false;
  if (/<\s*(script|foreignObject|iframe|object|embed|audio|video|image|use|style\b[^>]*@import)/i.test(text)) return false;
  if (/\son\w+\s*=/i.test(text)) return false; // onload=, onclick=...
  if (/(javascript|data|vbscript):/i.test(text.replace(/data:image\/(png|jpeg|gif|webp);base64,/gi, ""))) return false;
  if (/(href|src)\s*=\s*["']?\s*(https?:|\/\/|file:)/i.test(text)) return false; // no external fetches from inside the icon
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text)) return false; // entity tricks
  return true;
}

function u16le(b: Buffer, o: number) {
  return b.readUInt16LE(o);
}

/**
 * Identifies an icon by its bytes (never by file name or Content-Type) and reads its size.
 * Returns null for anything that is not a plain, safe icon image, including HTML error pages.
 */
export function detectImage(buf: Buffer): ImageInfo | null {
  if (buf.length < 8 || buf.length > MAX_ICON_BYTES) return null;

  if (buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" && buf.length >= 24) {
    return { mime: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    for (let i = 2; i + 9 < buf.length; ) {
      if (buf[i] !== 0xff) return { mime: "image/jpeg", width: 0, height: 0 };
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { mime: "image/jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return { mime: "image/jpeg", width: 0, height: 0 };
  }
  const head6 = buf.subarray(0, 6).toString("latin1");
  if (head6 === "GIF87a" || head6 === "GIF89a") return { mime: "image/gif", width: u16le(buf, 6), height: u16le(buf, 8) };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    const kind = buf.subarray(12, 16).toString("latin1");
    if (kind === "VP8X" && buf.length >= 30) return { mime: "image/webp", width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (kind === "VP8L" && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      return { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8 " && buf.length >= 30) return { mime: "image/webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    return { mime: "image/webp", width: 0, height: 0 };
  }
  // ICO: reserved 0, type 1, then a directory of images.
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) {
    const count = u16le(buf, 4);
    if (count < 1 || count > 64 || buf.length < 6 + count * 16) return null;
    let best = 0;
    for (let i = 0; i < count; i++) {
      const w = buf[6 + i * 16] || 256;
      const h = buf[7 + i * 16] || 256;
      best = Math.max(best, Math.min(w, h));
    }
    return { mime: "image/x-icon", width: best, height: best };
  }
  // SVG: text that really is an svg document and passes the safety check.
  const text = buf.toString("utf8");
  if (/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(text)) {
    return isSafeSvg(text) ? { mime: "image/svg+xml", width: 0, height: 0 } : null;
  }
  return null;
}

/** Shortest side in pixels, or Infinity for vector images. */
export function pixelSize(info: ImageInfo): number {
  return info.mime === "image/svg+xml" ? Infinity : Math.min(info.width || 0, info.height || 0) || 0;
}
