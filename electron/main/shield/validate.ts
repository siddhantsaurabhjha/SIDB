import { MAX_LIST_BYTES, type ListDef } from "./lists";

/** Pulls "! Version:" or "! Last modified:" out of a list header. */
export function listVersion(text: string): string | null {
  const head = text.slice(0, 2000);
  return /^!\s*Version:\s*(.+)$/im.exec(head)?.[1]?.trim() ?? /^!\s*Last modified:\s*(.+)$/im.exec(head)?.[1]?.trim() ?? null;
}

/**
 * Structural checks on a downloaded list before it can replace the current one.
 * Throws with a readable reason when the download looks wrong (HTML error page, truncated, wrong list).
 * Note: publishers' own checksum headers are not verified; integrity relies on HTTPS plus these checks.
 */
export function validateList(def: ListDef, text: string, previousBytes = 0): void {
  if (text.length > MAX_LIST_BYTES) throw new Error(`${def.title}: download is too large`);
  if (text.length < 1000) throw new Error(`${def.title}: download is suspiciously small`);
  const head = text.slice(0, 3000);
  if (/<html[\s>]|<!doctype html/i.test(head)) throw new Error(`${def.title}: received a web page instead of a filter list`);
  if (!/^\s*(\[Adblock|!)/i.test(head)) throw new Error(`${def.title}: missing filter list header`);
  if (!head.toLowerCase().includes(def.expectTitle.toLowerCase())) throw new Error(`${def.title}: unexpected list title`);
  // A list that suddenly loses more than half its content is more likely truncated than intentionally trimmed.
  if (previousBytes > 0 && text.length < previousBytes * 0.5) throw new Error(`${def.title}: new version is less than half the size of the current one`);
}

export function validateResources(text: string): void {
  if (text.length > MAX_LIST_BYTES) throw new Error("Resources: download is too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Resources: not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Resources: unexpected format");
}
