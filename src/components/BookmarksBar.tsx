import { useLive } from "../hooks/useLive";
import { selectActiveTab, useTabs } from "../store/tabs";
import { SiteIcon } from "./PageShell";

/** Bookmarks bar under the toolbar. It shows the bookmarks you pinned on the Bookmarks page. */
export function BookmarksBar() {
  const tab = useTabs(selectActiveTab);
  const { data } = useLive(() => window.sidb.data.bookmarks.list(), ["bookmarks"]);
  const pinned = data?.bookmarks.filter((b) => b.pinned) ?? [];

  return (
    <nav aria-label="Bookmarks bar" className="flex h-9 shrink-0 items-center gap-1 overflow-hidden border-b border-line bg-black/10 px-3">
      {pinned.length === 0 && <span className="text-[11px] text-muted">Pin bookmarks on the Bookmarks page to show them here.</span>}
      {pinned.map((b) => (
        <button
          key={b.id}
          title={b.url}
          className="flex h-7 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted hover:bg-white/10 hover:text-fg"
          onClick={() => tab && void window.sidb.tabs.navigate(tab.id, b.url)}
          onAuxClick={(e) => e.button === 1 && void window.sidb.tabs.create({ url: b.url, activate: false })}
        >
          <SiteIcon url={b.url} favicon={b.favicon} size={14} />
          <span className="truncate">{b.title}</span>
        </button>
      ))}
    </nav>
  );
}
