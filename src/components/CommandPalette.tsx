import { Bookmark, Clock, Globe, Layers, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Bookmark as BookmarkRow, HistoryEntry } from "../../shared/types/data";
import { buildCommands, type PaletteItem } from "../lib/commands";
import { hostOf } from "../lib/format";
import { rank } from "../lib/fuzzy";
import { useDialogOverlay, useDialogs } from "../store/dialogs";
import { selectActiveTab, useTabs } from "../store/tabs";
import { useUi } from "../store/ui";

const MAX_RESULTS = 40;

function looksLikeAddress(text: string): boolean {
  return /^(https?:\/\/|sidb:\/\/)\S+$/i.test(text) || (!/\s/.test(text) && /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#]\S*)?$/i.test(text)) || /^localhost(:\d+)?([/?#]\S*)?$/i.test(text);
}

/** Ctrl+K command palette. Also searches open tabs (Ctrl+Shift+A), bookmarks and history. */
export function CommandPalette() {
  const open = useDialogs((s) => s.paletteOpen);
  const mode = useDialogs((s) => s.paletteMode);
  const initial = useDialogs((s) => s.paletteInitial);
  const close = useDialogs((s) => s.closePalette);
  const tabs = useTabs((s) => s.tabs);
  const activeTabId = useTabs((s) => s.activeTabId);
  const groups = useTabs((s) => s.groups);
  const isPrivate = useTabs((s) => s.isPrivate);
  const tab = useTabs(selectActiveTab);
  const settings = useUi((s) => s.settings);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [found, setFound] = useState<{ bookmarks: BookmarkRow[]; history: HistoryEntry[] }>({ bookmarks: [], history: [] });
  const listRef = useRef<HTMLUListElement>(null);
  useDialogOverlay(open);

  useEffect(() => {
    if (open) {
      setQuery(initial);
      setSelected(0);
      setFound({ bookmarks: [], history: [] });
    }
  }, [open, initial]);

  // Bookmarks and history are searched in the main process; results arrive a moment after typing.
  useEffect(() => {
    const q = query.trim();
    if (!open || mode === "tabs" || q.length < 2) {
      setFound({ bookmarks: [], history: [] });
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      void Promise.all([window.sidb.data.bookmarks.list({ query: q }), window.sidb.data.history.list({ query: q, limit: 5 })]).then(([b, h]) => {
        if (!stale) setFound({ bookmarks: b.bookmarks.slice(0, 5), history: h });
      });
    }, 120);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [open, mode, query]);

  const items = useMemo<PaletteItem[]>(() => {
    if (!open) return [];
    const q = query.trim();
    const api = window.sidb.tabs;
    const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name;
    const tabItems: PaletteItem[] = tabs.map((t) => ({
      id: `tab:${t.id}`,
      title: t.title || t.url,
      hint: [groupName(t.groupId), t.id === activeTabId ? "current tab" : null, t.internal ? null : hostOf(t.url)].filter(Boolean).join(" - "),
      section: "Tabs",
      icon: <Layers size={15} />,
      run: () => void api.activate(t.id),
    }));
    if (mode === "tabs") return rank(tabItems, q, (i) => `${i.title} ${i.hint ?? ""}`).slice(0, MAX_RESULTS);

    const out: PaletteItem[] = [];
    // A typed address goes first. Plain words rank real commands and tabs above "Search for ...", so Enter does what you meant.
    let goItem: PaletteItem | null = null;
    const address = looksLikeAddress(q);
    if (q && tab) goItem = { id: "go", title: address ? `Go to ${q}` : `Search for "${q}"`, section: "Go", icon: address ? <Globe size={15} /> : <Search size={15} />, run: () => void api.navigate(tab.id, q) };
    if (goItem && address) out.push(goItem);
    const commands = rank(buildCommands({ tab, snapshot: { tabs, activeTabId, isPrivate, groups }, isPrivate, settings }), q, (i) => i.title);
    out.push(...(q ? rank(tabItems, q, (i) => `${i.title} ${i.hint ?? ""}`).slice(0, 6) : []));
    out.push(...commands.slice(0, q ? 12 : 30));
    if (goItem && !address) out.push(goItem);
    for (const b of found.bookmarks) out.push({ id: `bm:${b.id}`, title: b.title, hint: hostOf(b.url), section: "Bookmarks", icon: <Bookmark size={15} />, run: () => tab && void api.navigate(tab.id, b.url) });
    for (const h of found.history) out.push({ id: `hi:${h.id}`, title: h.title || hostOf(h.url), hint: hostOf(h.url), section: "History", icon: <Clock size={15} />, run: () => tab && void api.navigate(tab.id, h.url) });
    return out.slice(0, MAX_RESULTS);
  }, [open, query, mode, tabs, activeTabId, groups, isPrivate, tab, settings, found]);

  useEffect(() => setSelected(0), [query, mode]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected, items]);

  if (!open) return null;

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    close();
    // Give the page a moment to come back from its overlay snapshot before the action runs (screenshots need it).
    setTimeout(item.run, 200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label={mode === "tabs" ? "Search tabs" : "Command palette"} className="glass force-dark flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={16} className="text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[selected] ? `palette-${selected}` : undefined}
            aria-label={mode === "tabs" ? "Search open tabs" : "Type a command, address or search"}
            placeholder={mode === "tabs" ? "Search open tabs..." : "Type a command, address or search..."}
            spellCheck={false}
            autoComplete="off"
            className="h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted"
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(items.length - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(items[selected]);
              }
            }}
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-6 text-center text-[12px] text-muted">{mode === "tabs" ? "No matching tabs." : "No matching commands."}</li>}
          {items.map((item, i) => (
            <li key={item.id} id={`palette-${i}`} role="option" aria-selected={i === selected}>
              {(i === 0 || items[i - 1].section !== item.section) && <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">{item.section}</div>}
              <button className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] ${i === selected ? "bg-accent/25" : "hover:bg-white/5"}`} onMouseMove={() => setSelected(i)} onClick={() => run(item)}>
                <span className="shrink-0 text-accent">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                {item.hint && <span className="shrink-0 truncate text-[11px] text-muted">{item.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
