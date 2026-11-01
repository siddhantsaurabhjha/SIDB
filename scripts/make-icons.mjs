// Generates the app icons from resources/icons/logo.png (run with Electron: `npm run icons`).
// The full logo has "SIDB BROWSER" lettering that is unreadable at 16-48 px, so the icons use only the globe mark.
// Outputs: resources/icons/icon.ico (Windows, 16-256 px) and icon.png (512 px, Linux and the window icon).
import { app, nativeImage } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "../resources/icons");
// The globe with its whole ring, above the lettering (source is 1254 x 1254). Wider than tall, so it is
// centred on a square filled with the logo's own background colour.
const CROP = { x: 120, y: 100, width: 1060, height: 790 };

/** Places `img` in the middle of a square canvas filled with the colour of the source's top-left corner. */
function padToSquare(img, source) {
  const { width, height } = img.getSize();
  const side = Math.max(width, height);
  const bg = source.crop({ x: 2, y: 2, width: 1, height: 1 }).toBitmap(); // BGRA
  const out = Buffer.alloc(side * side * 4);
  for (let i = 0; i < side * side; i++) bg.copy(out, i * 4, 0, 4);
  const pixels = img.toBitmap();
  const ox = Math.floor((side - width) / 2);
  const oy = Math.floor((side - height) / 2);
  for (let y = 0; y < height; y++) pixels.copy(out, ((oy + y) * side + ox) * 4, y * width * 4, (y + 1) * width * 4);
  return nativeImage.createFromBitmap(out, { width: side, height: side });
}
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

app.whenReady().then(() => {
  const src = nativeImage.createFromBuffer(readFileSync(path.join(dir, "logo.png")));
  const { width, height } = src.getSize();
  if (width !== 1254 || height !== 1254) throw new Error(`unexpected logo size ${width}x${height}; update CROP`);
  const mark = padToSquare(src.crop(CROP), src);
  const png = (size) => mark.resize({ width: size, height: size, quality: "best" }).toPNG();

  // ICO with PNG-encoded images (supported by Windows Vista and later).
  const images = ICO_SIZES.map((s) => ({ size: s, data: png(s) }));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((img, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(img.size >= 256 ? 0 : img.size, e); // 0 means 256
    header.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1);
    header.writeUInt8(0, e + 2); // palette
    header.writeUInt8(0, e + 3); // reserved
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(img.data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += img.data.length;
  });
  writeFileSync(path.join(dir, "icon.ico"), Buffer.concat([header, ...images.map((i) => i.data)]));
  writeFileSync(path.join(dir, "icon.png"), png(512));
  console.log(`icons written: icon.ico (${ICO_SIZES.join(", ")} px), icon.png (512 px)`);
  app.quit();
});
