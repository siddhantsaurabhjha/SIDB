export interface ImageType {
  ext: string;
  mime: string;
}

const TYPES: Array<ImageType & { test: (b: Buffer) => boolean }> = [
  { ext: "png", mime: "image/png", test: (b) => b.subarray(0, 4).toString("hex") === "89504e47" },
  { ext: "jpg", mime: "image/jpeg", test: (b) => b.subarray(0, 3).toString("hex") === "ffd8ff" },
  { ext: "webp", mime: "image/webp", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

export const IMAGE_EXTENSIONS = TYPES.map((t) => t.ext);

/** Identifies PNG, JPEG and WebP by their first bytes, never by file name. */
export function detectImage(data: Buffer): ImageType | null {
  const t = TYPES.find((x) => x.test(data));
  return t ? { ext: t.ext, mime: t.mime } : null;
}

export function mimeForExt(ext: string): string | null {
  return TYPES.find((t) => t.ext === ext)?.mime ?? null;
}
