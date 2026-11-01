import { useEffect, useState } from "react";

interface Entry {
  src: string | null;
  /** "dark" or "light" when the picture is mostly one of them, so it can sit on a contrasting tile. */
  tone: "dark" | "light" | null;
}

const MAX_ENTRIES = 400;
const results = new Map<string, Entry>();
const pending = new Map<string, Promise<Entry>>();

function keyOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * Decides whether a picture needs a contrasting tile. Only logos on a transparent background can disappear:
 * a black one on a dark theme ("dark"), a white one on a light theme ("light"). Coloured logos and pictures that
 * fill the whole square (they bring their own background) never need one.
 */
function toneOf(src: string): Promise<Entry["tone"]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let opaque = 0;
        let weight = 0;
        let maxChannel = 0;
        let minChannel = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3] / 255;
          if (a > 0.9) opaque++;
          if (a < 0.1) continue;
          maxChannel += a * (Math.max(data[i], data[i + 1], data[i + 2]) / 255);
          minChannel += a * (Math.min(data[i], data[i + 1], data[i + 2]) / 255);
          weight += a;
        }
        if (weight < 6 || opaque / (size * size) > 0.9) return resolve(null);
        resolve(maxChannel / weight < 0.3 ? "dark" : minChannel / weight > 0.78 ? "light" : null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function load(url: string, hint: string | null | undefined): Promise<Entry> {
  const key = keyOf(url);
  if (!key) return Promise.resolve({ src: null, tone: null });
  const known = results.get(key);
  if (known) return Promise.resolve(known);
  let job = pending.get(key);
  if (!job) {
    job = window.sidb.data.favicon
      .get({ url, hint: hint && /^https?:\/\//i.test(hint) ? hint : null })
      .then(async (src): Promise<Entry> => ({ src, tone: src ? await toneOf(src) : null }))
      .catch((): Entry => ({ src: null, tone: null }))
      .then((entry) => {
        if (entry.src) {
          // Only real icons are remembered for the session; "none" is re-checked next time the screen opens.
          results.set(key, entry);
          if (results.size > MAX_ENTRIES) results.delete(results.keys().next().value as string);
        }
        pending.delete(key);
        return entry;
      });
    pending.set(key, job);
  }
  return job;
}

function useFavicon(url: string, hint: string | null | undefined): Entry | undefined {
  const key = keyOf(url);
  const [entry, setEntry] = useState<Entry | undefined>(() => (key ? results.get(key) : { src: null, tone: null }));
  useEffect(() => {
    let alive = true;
    const cached = key ? results.get(key) : undefined;
    if (cached) setEntry(cached);
    else {
      setEntry(key ? undefined : { src: null, tone: null });
      void load(url, hint).then((e) => alive && setEntry(e));
    }
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- a new address with the same site keeps its icon
  return entry;
}

function letterOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")[0]?.toUpperCase() ?? "?";
  } catch {
    return "?";
  }
}

/**
 * A website's real icon, from the local cache, in a fixed square. While it loads, or when the site has no usable icon,
 * the first letter of the site is shown instead, so the square is never empty and never shows a broken image.
 */
export function Favicon({ url, favicon, size = 20, className = "" }: { url: string; favicon?: string | null; size?: number; className?: string }) {
  const entry = useFavicon(url, favicon);
  // Tracked per picture, so a load that finishes before React runs its effects is never lost.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = entry?.src && failedSrc !== entry.src ? entry.src : null;
  const loaded = src !== null && loadedSrc === src;

  return (
    <span className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-md ${className}`} style={{ width: size, height: size }} data-icon-tone={loaded ? (entry?.tone ?? undefined) : undefined}>
      <span aria-hidden className={`absolute inset-0 grid place-items-center rounded-md bg-accent/30 font-bold transition-opacity duration-200 ${loaded ? "opacity-0" : "opacity-100"}`} style={{ fontSize: Math.max(9, Math.round(size * 0.5)) }}>
        {letterOf(url)}
      </span>
      {src && (
        <img
          src={src}
          alt=""
          aria-hidden
          draggable={false}
          width={size}
          height={size}
          decoding="async"
          ref={(el) => {
            if (el && el.complete && el.naturalWidth > 0) setLoadedSrc(src); // already decoded when it was attached
          }}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
          className={`absolute inset-0 h-full w-full object-contain p-[6%] transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </span>
  );
}
