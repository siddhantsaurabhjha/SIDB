import fs from "node:fs";
import path from "node:path";
import { dialog } from "electron";
import type { WindowContext } from "../windows/registry";
import { IMAGE_EXTENSIONS, detectImage, mimeForExt } from "./imageTypes";

const MAX_WALLPAPER_BYTES = 8 * 1024 * 1024;
function existing(dir: string): { file: string; mime: string } | null {
  for (const ext of IMAGE_EXTENSIONS) {
    const file = path.join(dir, `wallpaper.${ext}`);
    const mime = mimeForExt(ext);
    if (mime && fs.existsSync(file)) return { file, mime };
  }
  return null;
}

/** The New Tab wallpaper the user picked, as a data URL (the page can't load local files directly). */
export function readWallpaper(dir: string): string | null {
  const w = existing(dir);
  if (!w) return null;
  try {
    return `data:${w.mime};base64,${fs.readFileSync(w.file).toString("base64")}`;
  } catch {
    return null;
  }
}

export function clearWallpaper(dir: string): void {
  for (const ext of IMAGE_EXTENSIONS) fs.rmSync(path.join(dir, `wallpaper.${ext}`), { force: true });
}

/** Lets the user choose an image, checks that it really is one (by content, not file name), and copies it into the profile. */
export async function pickWallpaper(ctx: WindowContext): Promise<{ ok: boolean; message: string }> {
  const pick = await dialog.showOpenDialog(ctx.win, { title: "Choose a New Tab background", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }], properties: ["openFile"] });
  const file = pick.filePaths[0];
  if (pick.canceled || !file) return { ok: false, message: "Cancelled." };
  if (fs.statSync(file).size > MAX_WALLPAPER_BYTES) return { ok: false, message: "That image is larger than 8 MB." };
  const data = fs.readFileSync(file);
  const type = detectImage(data);
  if (!type) return { ok: false, message: "That file is not a PNG, JPEG or WebP image." };
  clearWallpaper(ctx.profile.dir);
  fs.writeFileSync(path.join(ctx.profile.dir, `wallpaper.${type.ext}`), data);
  return { ok: true, message: "Background set." };
}
