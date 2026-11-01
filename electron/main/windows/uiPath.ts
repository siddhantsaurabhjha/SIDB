import path from "node:path";
import { UI_HOST, UI_SCHEME } from "../../../shared/uiUrl";

/**
 * Maps a `sidb-app://ui/...` request to a file inside `root`, or null for anything else: another scheme or host,
 * a path that escapes the folder (`..`, encoded or not), bad percent-encoding, or a NUL byte.
 */
export function uiFileFor(requestUrl: string, root: string): string | null {
  let u: URL;
  try {
    u = new URL(requestUrl);
  } catch {
    return null;
  }
  if (u.protocol !== `${UI_SCHEME}:` || u.host !== UI_HOST) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  // NUL, backslashes (path separators on Windows) and ".." segments are never part of a real UI file name.
  if (rel.includes("\0") || rel.includes("\\") || rel.split("/").includes("..")) return null;
  const base = path.resolve(root);
  const file = path.resolve(base, `.${rel === "/" ? "/index.html" : rel}`);
  return file.startsWith(base + path.sep) ? file : null;
}
