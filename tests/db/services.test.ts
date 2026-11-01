// These tests use node:sqlite and run through Electron's bundled Node: `npm run test:db`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../electron/main/db/database";
import { AiConversationsService } from "../../electron/main/services/AiConversationsService";
import { BackupService } from "../../electron/main/services/BackupService";
import { BookmarksService } from "../../electron/main/services/BookmarksService";
import { parseBookmarksHtml } from "../../electron/main/services/bookmarksHtml";
import { DownloadsService, riskWarningFor, uniquePath } from "../../electron/main/services/DownloadsService";
import { HistoryService } from "../../electron/main/services/HistoryService";
import { SessionService, ShortcutsService } from "../../electron/main/services/SessionService";
import { SettingsService } from "../../electron/main/services/SettingsService";
import { ShieldDataService } from "../../electron/main/services/ShieldDataService";

const MIGRATIONS = path.resolve(__dirname, "../../database/migrations");
let db: Db;
let tmp: string;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sidb-test-"));
  db = await openDatabase(path.join(tmp, "test.db"), MIGRATIONS);
});
afterEach(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("bookmarks", () => {
  it("adds, dedupes and rejects unsafe URLs", async () => {
    const svc = new BookmarksService(db);
    const a = await svc.add({ title: "Example", url: "https://example.com/" });
    const b = await svc.add({ title: "Again", url: "https://example.com/" });
    expect(b.id).toBe(a.id);
    await expect(svc.add({ title: "x", url: "javascript:alert(1)" })).rejects.toThrow();
    expect((await svc.list()).bookmarks).toHaveLength(1);
  });

  it("searches literally (% and _ are not wildcards)", async () => {
    const svc = new BookmarksService(db);
    await svc.add({ title: "100% legit", url: "https://a.com/" });
    await svc.add({ title: "other", url: "https://b.com/" });
    expect((await svc.list()).bookmarks).toHaveLength(2);
    expect((await svc.list("100%")).bookmarks.map((b) => b.url)).toEqual(["https://a.com/"]);
    expect((await svc.list("_")).bookmarks).toHaveLength(0);
  });

  it("deletes nested folders with their bookmarks and refuses cycles", async () => {
    const svc = new BookmarksService(db);
    const parent = await svc.createFolder("Parent");
    const child = await svc.createFolder("Child", parent.id);
    await svc.add({ title: "in child", url: "https://c.com/", folderId: child.id });
    await svc.add({ title: "root", url: "https://r.com/" });
    await svc.moveFolder(parent.id, child.id); // cycle: ignored
    expect((await svc.list()).folders.find((f) => f.id === parent.id)?.parentId).toBeNull();
    await svc.removeFolder(parent.id);
    const left = await svc.list();
    expect(left.folders).toHaveLength(0);
    expect(left.bookmarks.map((b) => b.url)).toEqual(["https://r.com/"]);
  });

  it("round-trips through Netscape HTML and skips bad/duplicate links", async () => {
    const svc = new BookmarksService(db);
    const f = await svc.createFolder("Dev & Tools");
    await svc.add({ title: 'A "quoted" <title>', url: "https://a.com/?x=1&y=2", folderId: f.id });
    await svc.add({ title: "Root", url: "https://root.com/" });
    const html = await svc.exportHtml();

    const other = await openDatabase(":memory:", MIGRATIONS);
    const target = new BookmarksService(other);
    const first = await target.importHtml(html);
    expect(first).toEqual({ added: 2, skipped: 0 });
    const second = await target.importHtml(html);
    expect(second.added).toBe(0); // duplicates in the same folder are skipped
    const { folders, bookmarks } = await target.list();
    expect(folders.some((x) => x.name === "Dev & Tools")).toBe(true);
    expect(bookmarks.find((b) => b.url.startsWith("https://a.com"))?.title).toBe('A "quoted" <title>');
    other.close();
  });

  it("parser never throws on garbage and drops non-http links", () => {
    const parsed = parseBookmarksHtml('<DL><DT><A HREF="javascript:x">bad</A><DT><A HREF="file:///c">f</A><DT><A HREF="https://ok.com">ok</A></DL><<<>>>');
    expect(parsed.bookmarks.map((b) => b.url)).toEqual(["https://ok.com"]);
    expect(parsed.skipped).toBe(2);
    expect(parseBookmarksHtml("not html at all").bookmarks).toEqual([]);
  });
});

describe("history", () => {
  it("counts repeat visits and ignores non-web URLs", async () => {
    const h = new HistoryService(db);
    await h.record("https://example.com/", "Example");
    await h.record("https://example.com/", "Example 2");
    await h.record("sidb://newtab", "x");
    await h.record("file:///etc/passwd", "x");
    const rows = await h.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].visitCount).toBe(2);
    expect(rows[0].title).toBe("Example 2");
  });

  it("searches, filters by range and deletes", async () => {
    const h = new HistoryService(db);
    const now = Date.now();
    await h.record("https://old.com/", "Old", null, now - 40 * 86_400_000);
    await h.record("https://new.com/", "New page", null, now);
    expect((await h.list({ query: "new" })).map((r) => r.url)).toEqual(["https://new.com/"]);
    expect((await h.list({ from: now - 86_400_000 })).map((r) => r.url)).toEqual(["https://new.com/"]);
    const [old] = await h.list({ query: "old.com" });
    await h.remove([old.id]);
    expect(await h.list()).toHaveLength(1);
    await h.clearRange();
    expect(await h.list()).toHaveLength(0);
  });

  it("finds suggestion candidates by every word, most visited first, treating % and _ literally", async () => {
    const h = new HistoryService(db);
    await h.record("https://www.youtube.com/", "YouTube");
    for (let i = 0; i < 4; i++) await h.record("https://www.youtube.com/", "YouTube");
    await h.record("https://yoga.example.org/classes", "Yoga classes");
    await h.record("https://example.org/100%25_done", "100% done");
    expect((await h.suggest("yo")).map((r) => r.url)).toEqual(["https://www.youtube.com/", "https://yoga.example.org/classes"]);
    expect((await h.suggest("you tube")).map((r) => r.url)).toEqual(["https://www.youtube.com/"]); // each word appears somewhere; ranking decides how good the match is
    expect((await h.suggest("yoga classes")).map((r) => r.url)).toEqual(["https://yoga.example.org/classes"]);
    expect((await h.suggest("%")).map((r) => r.url)).toEqual(["https://example.org/100%25_done"]);
    expect(await h.suggest("   ")).toEqual([]);
    expect((await h.mostVisited(1))[0].url).toBe("https://www.youtube.com/");
  });

  it("answers a suggestion lookup over 20,000 history rows quickly", async () => {
    db.sqlite.exec("BEGIN");
    const stmt = db.sqlite.prepare("INSERT INTO history_entries (id, url, title, favicon, visit_count, last_visit) VALUES (?, ?, ?, NULL, ?, ?)");
    for (let i = 0; i < 20_000; i++) stmt.run(`id${i}`, `https://site${i % 500}.example.com/page/${i}`, `Page number ${i} about topic ${i % 97}`, 1 + (i % 7), Date.now() - i * 1000);
    db.sqlite.exec("COMMIT");
    const h = new HistoryService(db);
    const t0 = performance.now();
    const rows = await h.suggest("topic 42");
    const ms = performance.now() - t0;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(80);
    expect(ms).toBeLessThan(400); // typically well under 100 ms
    console.log(`suggest over 20k rows: ${ms.toFixed(1)} ms`);
  });

  it("builds weekly stats and top sites", async () => {
    const h = new HistoryService(db);
    await h.record("https://www.youtube.com/a", "a");
    await h.record("https://www.youtube.com/b", "b");
    await h.record("https://github.com/", "g");
    const s = await h.stats();
    expect(s.totalVisits).toBe(3);
    expect(s.perDay).toHaveLength(7);
    expect(s.perDay[6].visits).toBe(3);
    expect(s.topSites[0]).toEqual({ host: "youtube.com", visits: 2 });
  });
});

describe("settings", () => {
  it("returns defaults, persists changes and rejects invalid values", async () => {
    const s = new SettingsService(db);
    expect((await s.getAll()).startup).toBe("newtab");
    await s.set({ startup: "restore", searchEngine: "duckduckgo" });
    const fresh = new SettingsService(db); // new cache, reads from SQLite
    expect(await fresh.getAll()).toMatchObject({ startup: "restore", searchEngine: "duckduckgo" });
    await expect(s.set({ searchEngine: "nope" as never })).rejects.toThrow();
  });

  it("stores appearance settings and rejects bad colours or unknown items", async () => {
    const s = new SettingsService(db);
    await s.set({ theme: "light", accent: "#14b8a6", newTabBackground: "dusk", bookmarksBar: true, hiddenToolbarItems: ["downloads", "ai"], hiddenSidebarItems: ["history"] });
    const fresh = await new SettingsService(db).getAll();
    expect(fresh).toMatchObject({ theme: "light", accent: "#14b8a6", newTabBackground: "dusk", bookmarksBar: true, hiddenToolbarItems: ["downloads", "ai"], hiddenSidebarItems: ["history"] });
    await expect(s.set({ accent: "red" })).rejects.toThrow();
    await expect(s.set({ theme: "neon" as never })).rejects.toThrow();
    await expect(s.set({ hiddenToolbarItems: ["nonsense"] as never })).rejects.toThrow();
  });

  it("falls back to defaults for corrupt stored values", async () => {
    db.sqlite.exec(`INSERT INTO browser_settings (key, value) VALUES ('startup', '"bogus"'), ('askWhereToSave', 'not json')`);
    const s = await new SettingsService(db).getAll();
    expect(s.startup).toBe("newtab");
    expect(s.askWhereToSave).toBe(false);
  });
});

describe("session and shortcuts", () => {
  it("saves and loads the session in order, dropping unsafe URLs", async () => {
    const svc = new SessionService(db);
    await svc.save([
      { url: "https://a.com/", title: "A", pinned: true, active: false, zoom: 1 },
      { url: "javascript:1", title: "bad", pinned: false, active: false, zoom: 1 },
      { url: "https://b.com/", title: "B", pinned: false, active: true, zoom: 1.25 },
    ]);
    const loaded = await svc.load();
    expect(loaded.map((t) => t.url)).toEqual(["https://a.com/", "https://b.com/"]);
    expect(loaded[1]).toMatchObject({ active: true, zoom: 1.25 });
  });

  it("saves and restores tab groups, dropping groups no tab uses", async () => {
    const svc = new SessionService(db);
    await svc.save(
      [
        { url: "https://a.com/", title: "A", pinned: false, active: true, zoom: 1, groupId: "g1" },
        { url: "https://b.com/", title: "B", pinned: false, active: false, zoom: 1, groupId: "g1" },
        { url: "https://c.com/", title: "C", pinned: false, active: false, zoom: 1, groupId: null },
      ],
      [
        { id: "g1", name: "Work", color: "#7c5cff", collapsed: true },
        { id: "unused", name: "Ghost", color: "#ef4444", collapsed: false },
      ],
    );
    expect((await svc.loadGroups()).map((g) => [g.id, g.name, g.collapsed])).toEqual([["g1", "Work", true]]);
    expect((await svc.load()).map((t) => t.groupId)).toEqual(["g1", "g1", null]);
  });

  it("keeps recently closed tabs newest first and reopens them once", async () => {
    const svc = new SessionService(db);
    await svc.addClosed("https://one.com/", "one");
    await new Promise((r) => setTimeout(r, 3));
    await svc.addClosed("https://two.com/", "two");
    expect((await svc.listClosed()).map((t) => t.title)).toEqual(["two", "one"]);
    expect((await svc.takeClosed())?.title).toBe("two");
    expect((await svc.listClosed()).map((t) => t.title)).toEqual(["one"]);
  });

  it("manages shortcuts", async () => {
    const svc = new ShortcutsService(db);
    const a = await svc.add("A", "https://a.com/");
    const b = await svc.add("B", "https://b.com/");
    await svc.reorder([b.id, a.id]);
    expect((await svc.list()).map((s) => s.title)).toEqual(["B", "A"]);
    await expect(svc.add("x", "ftp://x")).rejects.toThrow();
    await svc.remove(a.id);
    expect(await svc.list()).toHaveLength(1);
  });
});

describe("downloads helpers", () => {
  it("picks non-colliding file names", () => {
    const taken = new Set([path.join("d", "a.zip"), path.join("d", "a (1).zip")]);
    expect(uniquePath("d", "a.zip", (p) => taken.has(p))).toBe(path.join("d", "a (2).zip"));
    expect(uniquePath("d", "b.zip", (p) => taken.has(p))).toBe(path.join("d", "b.zip"));
  });

  it("flags risky downloads without calling them malware", () => {
    expect(riskWarningFor("setup.exe", "https://x.com/setup.exe")).toMatch(/Executable/);
    expect(riskWarningFor("setup.exe", "http://x.com/setup.exe")).toMatch(/insecure/);
    expect(riskWarningFor("photo.jpg", "https://x.com/p.jpg")).toBeNull();
  });

  it("marks interrupted downloads failed on startup and keeps files out of record removal", async () => {
    const svc = new DownloadsService(db);
    const base = { fileName: "f.bin", savePath: path.join(tmp, "f.bin"), sourceUrl: "https://x.com/f", mimeType: null, totalBytes: 10, receivedBytes: 5, riskWarning: null, startedAt: 1, completedAt: null, speed: 0, exists: false };
    fs.writeFileSync(base.savePath, "data");
    await svc.insert({ ...base, id: "run", state: "in_progress" });
    await svc.insert({ ...base, id: "done", state: "completed" });
    await svc.failStale();
    expect((await svc.get("run"))?.state).toBe("failed");
    expect((await svc.get("done"))?.state).toBe("completed");
    await svc.clearFinished();
    expect(await svc.list()).toHaveLength(0);
    expect(fs.existsSync(base.savePath)).toBe(true); // records only; the file stays
  });
});

describe("backup", () => {
  it("creates verified backups and prunes old automatic ones", async () => {
    const backup = new BackupService(db, path.join(tmp, "backups"));
    for (let i = 0; i < 7; i++) {
      await backup.create("auto");
      await new Promise((r) => setTimeout(r, 2));
    }
    await backup.create("manual");
    const list = await backup.list();
    expect(list.filter((b) => b.kind === "auto")).toHaveLength(5);
    expect(list.filter((b) => b.kind === "manual")).toHaveLength(1);
    expect(fs.readdirSync(path.join(tmp, "backups")).filter((f) => f.startsWith(".tmp"))).toHaveLength(0);
  });

  it("exports and imports data, saving a safety copy first", async () => {
    const bookmarks = new BookmarksService(db);
    const settings = new SettingsService(db);
    await bookmarks.add({ title: "Keep me", url: "https://keep.com/" });
    await settings.set({ searchEngine: "brave" });
    const backup = new BackupService(db, path.join(tmp, "backups"));
    const file = path.join(tmp, "export.db");
    backup.exportTo(file);

    await bookmarks.add({ title: "Added later", url: "https://later.com/" });
    await settings.set({ searchEngine: "bing" });
    await backup.importFrom(file);

    expect((await bookmarks.list()).bookmarks.map((b) => b.url)).toEqual(["https://keep.com/"]);
    settings.invalidate();
    expect((await settings.getAll()).searchEngine).toBe("brave");
    expect((await backup.list()).some((b) => b.kind === "manual")).toBe(true);
  });

  it("rejects damaged and wrong-version files without touching current data", async () => {
    const bookmarks = new BookmarksService(db);
    await bookmarks.add({ title: "Safe", url: "https://safe.com/" });
    const backup = new BackupService(db, path.join(tmp, "backups"));

    const garbage = path.join(tmp, "garbage.db");
    fs.writeFileSync(garbage, "this is not a database");
    await expect(backup.importFrom(garbage)).rejects.toThrow();

    const wrong = path.join(tmp, "wrong.db");
    const other = new DatabaseSync(wrong);
    other.exec("CREATE TABLE x(a); PRAGMA user_version = 99;");
    other.close();
    await expect(backup.importFrom(wrong)).rejects.toThrow(/Unsupported backup version/);

    expect((await bookmarks.list()).bookmarks).toHaveLength(1);
  });
});

describe("shield data", () => {
  it("stores site exceptions and matches parent domains", async () => {
    const s = new ShieldDataService(db);
    expect(await s.addException("https://www.Example.com/page")).toBe("example.com");
    await s.addException("example.com"); // duplicate is fine
    await expect(s.addException("not a host")).rejects.toThrow();
    expect((await s.listExceptions()).map((e) => e.host)).toEqual(["example.com"]);
    expect(s.isException("example.com")).toBe(true);
    expect(s.isException("www.example.com")).toBe(true);
    expect(s.isException("sub.example.com")).toBe(true);
    expect(s.isException("notexample.com")).toBe(false);

    const reloaded = new ShieldDataService(db);
    await reloaded.load();
    expect(reloaded.isException("example.com")).toBe(true);
    await reloaded.removeException("example.com");
    expect(reloaded.isException("example.com")).toBe(false);
  });

  it("accumulates daily stats and summarizes them", async () => {
    const s = new ShieldDataService(db);
    const now = Date.now();
    await s.addStats(5, 1, now);
    await s.addStats(3, 0, now);
    await s.addStats(10, 0, now - 3 * 86_400_000);
    await s.addStats(100, 0, now - 20 * 86_400_000);
    expect(await s.summary(now)).toEqual({ today: 8, popupsToday: 1, week: 18, total: 118 });
    await s.pruneStats(10, now);
    expect((await s.summary(now)).total).toBe(18);
  });

  it("includes exceptions in backups", async () => {
    const s = new ShieldDataService(db);
    await s.addException("keep.example");
    const backup = new BackupService(db, path.join(tmp, "backups"));
    const file = path.join(tmp, "e.db");
    backup.exportTo(file);
    await s.removeException("keep.example");
    await backup.importFrom(file);
    const fresh = new ShieldDataService(db);
    await fresh.load();
    expect(fresh.isException("keep.example")).toBe(true);
  });
});

describe("ai conversations", () => {
  it("stores chats, orders them by recent activity and cascades deletes", async () => {
    const svc = new AiConversationsService(db);
    const a = await svc.create("First chat");
    await new Promise((r) => setTimeout(r, 3));
    const b = await svc.create("Second chat");
    await svc.append(a.id, "hello", "hi there");
    expect((await svc.list()).map((c) => c.title)).toEqual(["First chat", "Second chat"]); // a was touched last
    expect((await svc.messages(a.id)).map((m) => [m.role, m.content])).toEqual([
      ["user", "hello"],
      ["assistant", "hi there"],
    ]);
    expect(await svc.exists(b.id)).toBe(true);
    await svc.remove(a.id);
    expect(await svc.messages(a.id)).toEqual([]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM ai_messages").get()).toEqual({ n: 0 });
    await svc.clearAll();
    expect(await svc.list()).toEqual([]);
  });

  it("are not part of backups or imports", async () => {
    const svc = new AiConversationsService(db);
    const c = await svc.create("private thoughts");
    await svc.append(c.id, "q", "a");
    const backup = new BackupService(db, path.join(tmp, "backups"));
    const file = path.join(tmp, "x.db");
    backup.exportTo(file);
    const probe = new DatabaseSync(file, { readOnly: true });
    expect(probe.prepare("SELECT COUNT(*) AS n FROM ai_conversations").get()).toEqual({ n: 0 }); // scrubbed from the exported copy
    expect(probe.prepare("SELECT COUNT(*) AS n FROM ai_messages").get()).toEqual({ n: 0 });
    probe.close();
    expect(fs.readFileSync(file).includes(Buffer.from("private thoughts"))).toBe(false); // not left in free pages either
    await backup.importFrom(file); // importing only replaces BACKUP_TABLES, so live chats stay
    expect((await svc.list()).length).toBe(1);
  });
});
