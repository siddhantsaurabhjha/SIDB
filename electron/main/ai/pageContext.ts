import type { WebContents } from "electron";
import { AI_LIMITS } from "../../../shared/types/ai";
import { safePageUrl, type PageContext } from "./prompts";

// Runs in an isolated JavaScript world: it can read the page's DOM, but page scripts can't see or alter this code.
const ISOLATED_WORLD_ID = 1999;

const EXTRACT = `(() => {
  const clean = (s) => String(s || "").replace(/\\r/g, "").replace(/[ \\t\\u00a0]+/g, " ").replace(/\\n{3,}/g, "\\n\\n").trim();
  const sel = clean(window.getSelection ? window.getSelection().toString() : "");
  const root = document.querySelector("article, main, [role=main]") || document.body;
  let text = clean(root ? root.innerText : "");
  if (text.length < 300 && document.body) text = clean(document.body.innerText);
  return { title: document.title || "", text: text.slice(0, ${AI_LIMITS.pageChars + 5000}), selection: sel.slice(0, ${AI_LIMITS.selection + 1000}) };
})()`;

/** Reads the visible text and current selection of a web tab. Returns null if the page can't be read. */
export async function readPage(wc: WebContents): Promise<PageContext | null> {
  if (wc.isDestroyed()) return null;
  const url = safePageUrl(wc.getURL());
  if (!url) return null;
  try {
    const r = (await wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code: EXTRACT }])) as { title?: unknown; text?: unknown; selection?: unknown } | undefined;
    if (!r) return null;
    return {
      title: typeof r.title === "string" ? r.title : "",
      url,
      text: typeof r.text === "string" ? r.text : "",
      selection: typeof r.selection === "string" ? r.selection : "",
    };
  } catch {
    return null;
  }
}
