import type { Bookmark, BookmarkFolder } from "../../../shared/types/data";
import { isSafeWebUrl } from "../../../shared/url";

export interface ParsedFolder {
  name: string;
  parent: number | null; // index into folders
}
export interface ParsedBookmark {
  title: string;
  url: string;
  folder: number | null; // index into folders
}
export interface ParsedBookmarks {
  folders: ParsedFolder[];
  bookmarks: ParsedBookmark[];
  skipped: number;
}

const MAX_INPUT = 20 * 1024 * 1024;
const MAX_ITEMS = 100_000;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m);
const encode = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Parses the Netscape bookmark HTML format used by Chrome, Edge, Firefox and Brave. Malformed input never throws. */
export function parseBookmarksHtml(html: string): ParsedBookmarks {
  const out: ParsedBookmarks = { folders: [], bookmarks: [], skipped: 0 };
  if (html.length > MAX_INPUT) return out;

  const stack: Array<number | null> = [null];
  let pendingFolder: number | null | undefined;
  const tag = /<(\/?)(DL|H3|A)\b([^>]*)>([^<]*)/gi;
  let m: RegExpExecArray | null;

  while ((m = tag.exec(html)) !== null) {
    if (out.folders.length + out.bookmarks.length > MAX_ITEMS) break;
    const [, closing, nameRaw, attrs, text] = m;
    const name = nameRaw.toUpperCase();
    if (name === "H3" && !closing) {
      out.folders.push({ name: decode(text).trim() || "Untitled", parent: stack[stack.length - 1] });
      pendingFolder = out.folders.length - 1;
    } else if (name === "DL") {
      if (closing) {
        if (stack.length > 1) stack.pop();
      } else {
        stack.push(pendingFolder !== undefined ? pendingFolder : stack[stack.length - 1]);
        pendingFolder = undefined;
      }
    } else if (name === "A" && !closing) {
      const href = /HREF\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
      const url = href ? decode(href).trim() : "";
      if (isSafeWebUrl(url)) {
        out.bookmarks.push({ title: decode(text).trim() || url, url, folder: stack[stack.length - 1] });
      } else {
        out.skipped++;
      }
    }
  }
  return out;
}

export function serializeBookmarksHtml(folders: BookmarkFolder[], bookmarks: Bookmark[]): string {
  const lines: string[] = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
  ];
  const writeLevel = (parentId: string | null, indent: string) => {
    for (const f of folders.filter((x) => x.parentId === parentId)) {
      lines.push(`${indent}<DT><H3>${encode(f.name)}</H3>`, `${indent}<DL><p>`);
      writeLevel(f.id, indent + "    ");
      lines.push(`${indent}</DL><p>`);
    }
    for (const b of bookmarks.filter((x) => x.folderId === parentId)) {
      lines.push(`${indent}<DT><A HREF="${encode(b.url)}" ADD_DATE="${Math.floor(b.createdAt / 1000)}">${encode(b.title)}</A>`);
    }
  };
  writeLevel(null, "    ");
  lines.push("</DL><p>");
  return lines.join("\n");
}
