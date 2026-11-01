import { Bookmark, Download, FolderPlus, Pin, Plus, Search, Star, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import type { Bookmark as BookmarkT, BookmarkFolder } from "../../shared/types/data";
import { Btn, Chip, PageShell, Panel, SiteIcon } from "../components/PageShell";
import { useLive } from "../hooks/useLive";
import { hostOf } from "../lib/format";
import { selectActiveTab, useTabs } from "../store/tabs";

type Filter = { kind: "all" } | { kind: "favorites" } | { kind: "recent" } | { kind: "folder"; id: string };

function folderPath(folders: BookmarkFolder[], id: string): string {
  const parts: string[] = [];
  for (let cur: BookmarkFolder | undefined = folders.find((f) => f.id === id); cur; cur = folders.find((f) => f.id === cur!.parentId)) parts.unshift(cur.name);
  return parts.join(" / ");
}

function depthOf(folders: BookmarkFolder[], f: BookmarkFolder): number {
  let d = 0;
  for (let cur: BookmarkFolder | undefined = f; cur?.parentId; cur = folders.find((x) => x.id === cur!.parentId)) d++;
  return d;
}

/** Folders in tree order so children appear under their parent. */
function orderFolders(folders: BookmarkFolder[]): BookmarkFolder[] {
  const out: BookmarkFolder[] = [];
  const walk = (parent: string | null) => {
    for (const f of folders.filter((x) => x.parentId === parent)) {
      out.push(f);
      walk(f.id);
    }
  };
  walk(null);
  return out;
}

export function BookmarksPage() {
  const tab = useTabs(selectActiveTab);
  const api = window.sidb.data;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", url: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, error } = useLive(() => api.bookmarks.list({ query: query || undefined }), ["bookmarks"], [query]);
  const folders = useMemo(() => orderFolders(data?.folders ?? []), [data]);

  const shown = useMemo(() => {
    let items = data?.bookmarks ?? [];
    if (filter.kind === "favorites") items = items.filter((b) => b.favorite);
    else if (filter.kind === "folder") items = items.filter((b) => b.folderId === filter.id);
    else if (filter.kind === "recent") items = [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 24);
    return items;
  }, [data, filter]);
  const pinned = shown.filter((b) => b.pinned);
  const open = (url: string) => tab && void window.sidb.tabs.navigate(tab.id, url);
  const count = (f: Filter) => (data?.bookmarks ?? []).filter((b) => (f.kind === "folder" ? b.folderId === f.id : f.kind === "favorites" ? b.favorite : true)).length;

  const submitAdd = async () => {
    setFormError(null);
    try {
      await api.bookmarks.add({ title: draft.title, url: /^https?:\/\//i.test(draft.url) ? draft.url : `https://${draft.url}`, folderId: filter.kind === "folder" ? filter.id : null });
      setDraft({ title: "", url: "" });
      setAdding(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "") : "Could not add bookmark");
    }
  };

  const card = (b: BookmarkT) => (
    <div key={b.id} className="group relative rounded-xl border border-line bg-white/5 p-3 hover:border-accent/50">
      {editing === b.id ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void api.bookmarks.update({ id: b.id, patch: { title: String(f.get("title")), url: String(f.get("url")) } }).then(() => setEditing(null)).catch(() => setNote("Invalid URL"));
          }}
        >
          <input name="title" defaultValue={b.title} aria-label="Title" className="h-8 w-full rounded-lg border border-line bg-black/30 px-2 text-[12px]" />
          <input name="url" defaultValue={b.url} aria-label="URL" className="h-8 w-full rounded-lg border border-line bg-black/30 px-2 text-[12px]" />
          <div className="flex gap-2">
            <Btn primary submit onClick={() => undefined}>
              Save
            </Btn>
            <Btn onClick={() => setEditing(null)}>Cancel</Btn>
          </div>
        </form>
      ) : (
        <>
          <button className="flex w-full flex-col items-center gap-2 py-2" onClick={() => open(b.url)} title={b.url}>
            <SiteIcon url={b.url} favicon={b.favicon} size={32} />
            <span className="w-full truncate text-center text-[12px]">{b.title}</span>
            <span className="w-full truncate text-center text-[10px] text-muted">{hostOf(b.url)}</span>
          </button>
          <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
            <button aria-label={b.favorite ? "Remove from favorites" : "Add to favorites"} className="icon-btn !h-6 !w-6" onClick={() => void api.bookmarks.update({ id: b.id, patch: { favorite: !b.favorite } })}>
              <Star size={13} className={b.favorite ? "fill-amber-400 text-amber-400" : ""} />
            </button>
            <button aria-label={b.pinned ? "Unpin" : "Pin"} className="icon-btn !h-6 !w-6" onClick={() => void api.bookmarks.update({ id: b.id, patch: { pinned: !b.pinned } })}>
              <Pin size={13} className={b.pinned ? "text-accent" : ""} />
            </button>
            <button aria-label="Edit bookmark" className="icon-btn !h-6 !w-6 text-[11px]" onClick={() => setEditing(b.id)}>
              ✎
            </button>
            <button aria-label="Delete bookmark" className="icon-btn !h-6 !w-6" onClick={() => void api.bookmarks.remove({ id: b.id })}>
              <Trash2 size={13} />
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <PageShell
      icon={<Bookmark size={22} />}
      title="Bookmarks"
      subtitle="Organize your favorite websites, all in one place."
      actions={
        <>
          <label className="glass flex h-9 w-60 items-center gap-2 rounded-lg px-3">
            <Search size={14} className="text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search bookmarks..." aria-label="Search bookmarks" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted" />
          </label>
          <Btn
            onClick={() =>
              void api.bookmarks.importHtml().then((r) => r && setNote(`Imported ${r.added} bookmarks${r.skipped ? `, skipped ${r.skipped}` : ""}.`)).catch((e) => setNote(String(e.message ?? e)))
            }
          >
            <Upload size={14} /> Import
          </Btn>
          <Btn onClick={() => void api.bookmarks.exportHtml().then((p) => p && setNote(`Exported to ${p}`))}>
            <Download size={14} /> Export
          </Btn>
          <Btn primary onClick={() => setAdding((v) => !v)}>
            <Plus size={14} /> Add Bookmark
          </Btn>
        </>
      }
    >
      {note && (
        <div role="status" className="mb-3 flex items-center justify-between rounded-lg border border-line bg-white/5 px-3 py-2 text-[12px]">
          {note}
          <button aria-label="Dismiss" onClick={() => setNote(null)}>
            ×
          </button>
        </div>
      )}
      {adding && (
        <Panel className="mb-4">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submitAdd();
            }}
          >
            <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Title" aria-label="Bookmark title" className="h-9 w-56 rounded-lg border border-line bg-black/30 px-3 text-[13px]" />
            <input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://example.com" aria-label="Bookmark URL" className="h-9 min-w-64 flex-1 rounded-lg border border-line bg-black/30 px-3 text-[13px]" />
            <Btn primary submit onClick={() => undefined}>
              Save
            </Btn>
            <Btn onClick={() => setAdding(false)}>Cancel</Btn>
          </form>
          {formError && <p className="mt-2 text-[12px] text-red-300">{formError}</p>}
        </Panel>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Chip active={filter.kind === "all"} onClick={() => setFilter({ kind: "all" })}>
          All
        </Chip>
        <Chip active={filter.kind === "favorites"} onClick={() => setFilter({ kind: "favorites" })}>
          Favorites
        </Chip>
        <Chip active={filter.kind === "recent"} onClick={() => setFilter({ kind: "recent" })}>
          Recently Added
        </Chip>
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <Panel
          title={
            <span className="flex items-center justify-between">
              Folders
              <button aria-label="New folder" className="icon-btn !h-6 !w-6" onClick={() => setNewFolder("")}>
                <FolderPlus size={14} />
              </button>
            </span>
          }
        >
          <ul className="space-y-0.5">
            {([{ kind: "all" } as Filter, ...folders.map((f) => ({ kind: "folder", id: f.id }) as Filter)] as Filter[]).map((f) => {
              const folder = f.kind === "folder" ? folders.find((x) => x.id === f.id)! : null;
              const active = JSON.stringify(f) === JSON.stringify(filter);
              return (
                <li key={folder?.id ?? "all"} style={{ paddingLeft: folder ? depthOf(folders, folder) * 12 : 0 }}>
                  <div className={`group flex items-center rounded-lg ${active ? "bg-accent/25" : "hover:bg-white/5"}`}>
                    <button className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[12px]" onClick={() => setFilter(f)} title={folder ? folderPath(folders, folder.id) : "All bookmarks"}>
                      {folder ? folder.name : "All Bookmarks"} <span className="text-muted">{count(f)}</span>
                    </button>
                    {folder && (
                      <button aria-label={`Delete folder ${folder.name}`} className="icon-btn !h-6 !w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void api.bookmarks.removeFolder({ id: folder.id }).then(() => active && setFilter({ kind: "all" }))}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {newFolder !== null && (
            <form
              className="mt-2 flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (newFolder.trim()) void api.bookmarks.createFolder({ name: newFolder, parentId: filter.kind === "folder" ? filter.id : null });
                setNewFolder(null);
              }}
            >
              <input autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onBlur={() => setNewFolder(null)} placeholder="Folder name" aria-label="Folder name" className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-black/30 px-2 text-[12px]" />
            </form>
          )}
        </Panel>

        <div className="space-y-4">
          {error && <p className="text-red-300">{error}</p>}
          {pinned.length > 0 && (
            <Panel title="Pinned bookmarks">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{pinned.map(card)}</div>
            </Panel>
          )}
          <Panel title={filter.kind === "folder" ? folderPath(folders, filter.id) : filter.kind === "favorites" ? "Favorites" : filter.kind === "recent" ? "Recently added" : "All bookmarks"}>
            {shown.length === 0 ? (
              <p className="py-8 text-center text-muted">{query ? "No matching bookmarks." : "Nothing here yet. Click the star in the address bar to bookmark a page."}</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{shown.filter((b) => !b.pinned).map(card)}</div>
            )}
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
