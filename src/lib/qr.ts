import qrcode from "qrcode-generator";

export const MAX_QR_CHARS = 1200;

/**
 * Draws a QR code to a PNG data URL. Uses error correction level M and a white quiet zone so scanners can read it
 * on both light and dark themes. Returns null if the text is empty or too long to encode.
 */
export function qrDataUrl(text: string, size = 320): string | null {
  const value = text.trim();
  if (!value || value.length > MAX_QR_CHARS) return null;
  let qr: ReturnType<typeof qrcode>;
  try {
    qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
  } catch {
    return null;
  }
  const count = qr.getModuleCount();
  const quiet = 4;
  const cell = Math.max(2, Math.floor(size / (count + quiet * 2)));
  const px = cell * (count + quiet * 2);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = "#000000";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
  }
  return canvas.toDataURL("image/png");
}
