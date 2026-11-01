import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { bookmarkFolders, bookmarks } from "../../../database/schema";
import type { Bookmark, BookmarkFolder } from "../../../shared/types/data";
import { isSafeWebUrl } from "../../../shared/url";
import type { Db } from "../db/database";
import { parseBookmarksHtml, serializeBookmarksHtml } from "./bookmarksHtml";

export interface BookmarkInput {
  title: string;
  url: string;
  folderId?: string | null;
  favicon?: string | null;
}

const likeEsc = (col: SQL.Aliased | object, pattern: string) => sql`${col} LIKE ${pattern} ESCAPE '\\'`;

export class BookmarksService {
  constructor(private readonly db: Db) {}

  async list(query?: string): Promise<{ folders: BookmarkFolder[]; bookmarks: Bookmark[] }> {
    const q = query?.trim();
    const pattern = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    const rows = await this.db.orm
      .select()
      .from(bookmarks)
      .where(pattern ? or(likeEsc(bookmarks.title, pattern), likeEsc(bookmarks.url, pattern)) : undefined)
      .orderBy(asc(bookmarks.position), asc(bookmarks.createdAt));
    const folders = await this.db.orm.select().from(bookmarkFolders).orderBy(asc(bookmarkFolders.position), asc(bookmarkFolders.createdAt));
    return { folders, bookmarks: rows };
  }

  async findByUrl(url: string): Promise<Bookmark | null> {
    const [row] = await this.db.orm.select().from(bookmarks).where(eq(bookmarks.url, url)).limit(1);
    return row ?? null;
  }

  /** Adds a bookmark. A URL already present in the same folder returns the existing one (no duplicates). */
  async add(input: BookmarkInput): Promise<Bookmark> {
    if (!isSafeWebUrl(input.url)) throw new Error("Only http(s) URLs can be bookmarked");
    const folderId = input.folderId ?? null;
    const [existing] = await this.db.orm
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.url, input.url), folderId ? eq(bookmarks.folderId, folderId) : isNull(bookmarks.folderId)))
      .limit(1);
    if (existing) return existing;

    const row: Bookmark = {
      id: randomUUID(),
      folderId,
      title: input.title.trim() || input.url,
      url: input.url,
      favicon: input.favicon ?? null,
      pinned: false,
      favorite: false,
      position: Date.now(),
      createdAt: Date.now(),
    };
    await this.db.orm.insert(bookmarks).values(row);
    return row;
  }

  async update(id: string, patch: Partial<Pick<Bookmark, "title" | "url" | "folderId" | "pinned" | "favorite" | "position">>): Promise<void> {
    if (patch.url !== undefined && !isSafeWebUrl(patch.url)) throw new Error("Only http(s) URLs can be bookmarked");
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length === 0) return;
    await this.db.orm.update(bookmarks).set(clean).where(eq(bookmarks.id, id));
  }

  async remove(id: string): Promise<void> {
    await this.db.orm.delete(bookmarks).where(eq(bookmarks.id, id));
  }

  async createFolder(name: string, parentId: string | null = null): Promise<BookmarkFolder> {
    const row: BookmarkFolder = { id: randomUUID(), parentId, name: name.trim() || "New folder", position: Date.now(), createdAt: Date.now() };
    await this.db.orm.insert(bookmarkFolders).values(row);
    return row;
  }

  async renameFolder(id: string, name: string): Promise<void> {
    await this.db.orm.update(bookmarkFolders).set({ name: name.trim() || "Untitled" }).where(eq(bookmarkFolders.id, id));
  }

  /** Deletes a folder, its sub-folders and every bookmark inside them. */
  async removeFolder(id: string): Promise<void> {
    const all = await this.db.orm.select().from(bookmarkFolders);
    const doomed = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of all) {
        if (f.parentId && doomed.has(f.parentId) && !doomed.has(f.id)) {
          doomed.add(f.id);
          grew = true;
        }
      }
    }
    for (const folderId of doomed) {
      await this.db.orm.delete(bookmarks).where(eq(bookmarks.folderId, folderId));
    }
    for (const folderId of doomed) {
      await this.db.orm.delete(bookmarkFolders).where(eq(bookmarkFolders.id, folderId));
    }
  }

  async exportHtml(): Promise<string> {
    const { folders, bookmarks: items } = await this.list();
    return serializeBookmarksHtml(folders, items);
  }

  /** Imports a Netscape-format file. Duplicates (same URL in same folder) and non-http(s) links are skipped. */
  async importHtml(html: string): Promise<{ added: number; skipped: number }> {
    const parsed = parseBookmarksHtml(html);
    const folderIds: string[] = [];
    const existingFolders = (await this.db.orm.select().from(bookmarkFolders)).slice();
    for (const f of parsed.folders) {
      const parentId = f.parent === null ? null : (folderIds[f.parent] ?? null);
      // Re-importing the same file merges into folders that already exist instead of duplicating them.
      const match = existingFolders.find((x) => x.parentId === parentId && x.name === f.name);
      const folder = match ?? (await this.createFolder(f.name, parentId));
      if (!match) existingFolders.push(folder);
      folderIds.push(folder.id);
    }
    let added = 0;
    let skipped = parsed.skipped;
    for (const b of parsed.bookmarks) {
      const before = await this.findInFolder(b.url, b.folder === null ? null : (folderIds[b.folder] ?? null));
      if (before) {
        skipped++;
        continue;
      }
      await this.add({ title: b.title, url: b.url, folderId: b.folder === null ? null : (folderIds[b.folder] ?? null) });
      added++;
    }
    return { added, skipped };
  }

  private async findInFolder(url: string, folderId: string | null): Promise<Bookmark | null> {
    const [row] = await this.db.orm
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.url, url), folderId ? eq(bookmarks.folderId, folderId) : isNull(bookmarks.folderId)))
      .limit(1);
    return row ?? null;
  }

  /** Moves a folder under another, refusing cycles. */
  async moveFolder(id: string, parentId: string | null): Promise<void> {
    if (parentId === id) return;
    const all = await this.db.orm.select().from(bookmarkFolders);
    for (let cur = parentId; cur; cur = all.find((f) => f.id === cur)?.parentId ?? null) {
      if (cur === id) return; // would create a cycle
    }
    await this.db.orm.update(bookmarkFolders).set({ parentId }).where(eq(bookmarkFolders.id, id));
  }
}
