import fs from "node:fs";
import path from "node:path";
import { app, clipboard, ClipboardItem, dialog } from "electron";
import type { WindowContext } from "../windows/registry";

export interface CaptureResult {
  ok: boolean;
  message: string;
  path?: string;
}

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_FULL_PAGE_HEIGHT = 16_000; // taller pages are cut here to keep memory sane

function safeName(title: string): string {
  return title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "page";
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

async function savePng(ctx: WindowContext, png: Buffer, baseName: string): Promise<CaptureResult> {
  const pick = await dialog.showSaveDialog(ctx.win, { title: "Save screenshot", defaultPath: path.join(app.getPath("pictures"), `${baseName}.png`), filters: [{ name: "PNG image", extensions: ["png"] }] });
  if (pick.canceled || !pick.filePath) return { ok: false, message: "Cancelled." };
  fs.writeFileSync(pick.filePath, png);
  return { ok: true, message: "Screenshot saved.", path: pick.filePath };
}

async function copyPng(png: Buffer): Promise<void> {
  await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) })]);
}

/** Screenshot of the active web page: what is visible, or the whole page, to a file or the clipboard. */
export async function capturePage(ctx: WindowContext, mode: "visible" | "full", dest: "file" | "clipboard"): Promise<CaptureResult> {
  const wc = ctx.tabs.activeWebContents();
  if (!wc) return { ok: false, message: "Open a web page first." };

  await new Promise((r) => setTimeout(r, 120)); // the page may have just been shown again after a dialog closed
  let png: Buffer | null = null;
  let note = "";
  if (mode === "full") {
    const dbg = wc.debugger;
    let attached = false;
    try {
      dbg.attach("1.3");
      attached = true;
      const metrics = (await dbg.sendCommand("Page.getLayoutMetrics")) as { cssContentSize?: { width: number; height: number }; contentSize?: { width: number; height: number } };
      const size = metrics.cssContentSize ?? metrics.contentSize;
      if (size) {
        const height = Math.min(Math.ceil(size.height), MAX_FULL_PAGE_HEIGHT);
        const shot = (await dbg.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true, clip: { x: 0, y: 0, width: Math.ceil(size.width), height, scale: 1 } })) as { data: string };
        png = Buffer.from(shot.data, "base64");
        if (size.height > MAX_FULL_PAGE_HEIGHT) note = " The page is very long, so the bottom was cut.";
      }
    } catch {
      png = null; // fall back to the visible area below
    } finally {
      if (attached) {
        try {
          dbg.detach();
        } catch {
          /* already detached */
        }
      }
    }
    if (!png) note = " Full-page capture was not possible, so the visible area was used.";
  }
  if (!png) {
    try {
      png = (await wc.capturePage()).toPNG();
    } catch {
      // Chromium can refuse to grab a frame while the window is minimized or fully covered.
      return { ok: false, message: "SIDB could not capture the page. Make sure the window is visible and try again." };
    }
  }

  if (dest === "clipboard") {
    await copyPng(png);
    return { ok: true, message: `Screenshot copied.${note}` };
  }
  const saved = await savePng(ctx, png, `SIDB ${safeName(wc.getTitle())} ${stamp()}`);
  return saved.ok ? { ...saved, message: `${saved.message}${note}` } : saved;
}

/** Accepts only PNG data URLs made by our own UI (QR codes), within a size limit. */
function decodePngDataUrl(dataUrl: string): Buffer | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m || m[1].length > MAX_IMAGE_BYTES * 1.4) return null;
  const buf = Buffer.from(m[1], "base64");
  return buf.length > 8 && buf.subarray(0, 4).toString("hex") === "89504e47" ? buf : null;
}

export async function saveImage(ctx: WindowContext, dataUrl: string, name: string): Promise<CaptureResult> {
  const png = decodePngDataUrl(dataUrl);
  if (!png) return { ok: false, message: "That is not a valid image." };
  return savePng(ctx, png, safeName(name) || "image");
}

export async function copyImage(dataUrl: string): Promise<CaptureResult> {
  const png = decodePngDataUrl(dataUrl);
  if (!png) return { ok: false, message: "That is not a valid image." };
  await copyPng(png);
  return { ok: true, message: "Image copied." };
}
