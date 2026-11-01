import { Bookmark, Clock, Download, Home, Plus, Settings, ShieldCheck, Sparkles, Crown } from "lucide-react";
import type { ReactNode } from "react";
import { internalPageOf } from "../../shared/url";
import { useLive } from "../hooks/useLive";
import { selectActiveTab, useTabs } from "../store/tabs";
import { useUi } from "../store/ui";

const NAV: Array<{ page: string; label: string; icon: ReactNode }> = [
  { page: "newtab", label: "Home", icon: <Home size={18} /> },
  { page: "bookmarks", label: "Bookmarks", icon: <Bookmark size={18} /> },
  { page: "history", label: "History", icon: <Clock size={18} /> },
  { page: "downloads", label: "Downloads", icon: <Download size={18} /> },
  { page: "shield", label: "Shield", icon: <ShieldCheck size={18} /> },
  { page: "ai", label: "AI Assistant", icon: <Sparkles size={18} /> },
  { page: "settings", label: "Settings", icon: <Settings size={18} /> },
];

export function Sidebar() {
  const pinned = useUi((s) => s.sidebarPinned);
  const hover = useUi((s) => s.sidebarHover);
  const hidden = useUi((s) => s.settings.hiddenSidebarItems);
  const profiles = useLive(() => window.sidb.data.profiles.list(), ["profiles"]);
  const tab = useTabs(selectActiveTab);
  const expanded = pinned || hover;
  const currentPage = tab ? internalPageOf(tab.url) : null;

  return (
    <nav
      aria-label="Main navigation"
      onMouseEnter={() => useUi.getState().setSidebarHover(true)}
      onMouseLeave={() => useUi.getState().setSidebarHover(false)}
      className={`flex shrink-0 flex-col gap-1 border-r border-line bg-black/25 p-2 transition-[width] duration-150 ${expanded ? "w-52" : "w-14"}`}
    >
      {NAV.filter((item) => !(hidden as readonly string[]).includes(item.page)).map((item) => {
        const active = currentPage === item.page;
        return (
          <button
            key={item.page}
            title={item.label}
            aria-current={active ? "page" : undefined}
            onClick={() => tab && void window.sidb.tabs.navigate(tab.id, `sidb://${item.page}`)}
            className={`flex h-10 items-center gap-3 rounded-xl px-3 text-left text-[13px] ${
              active ? "bg-accent/25 text-fg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_55%,transparent)]" : "text-muted hover:bg-white/5 hover:text-fg"
            }`}
          >
            <span className="shrink-0">{item.icon}</span>
            {expanded && <span className="truncate">{item.label}</span>}
          </button>
        );
      })}

      <div className="my-2 h-px bg-line" />
      {expanded && (
        <div className="flex items-center justify-between px-2 text-[11px] text-muted">
          Profiles
          <button aria-label="Add a profile" className="hover:text-fg" onClick={() => tab && void window.sidb.tabs.navigate(tab.id, "sidb://settings")}>
            <Plus size={14} />
          </button>
        </div>
      )}
      {profiles.data?.profiles.map((p) => {
        const current = p.id === profiles.data?.currentId;
        return (
          <button
            key={p.id}
            title={current ? `${p.name} (this window)` : `Open ${p.name}`}
            aria-current={current ? "true" : undefined}
            onClick={() => !current && void window.sidb.data.profiles.open({ id: p.id })}
            className={`flex h-8 items-center gap-3 rounded-lg px-3.5 text-[12px] ${current ? "bg-white/10 text-fg" : "text-muted hover:bg-white/5"}`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
            {expanded && <span className="truncate">{p.name}</span>}
          </button>
        );
      })}

      <div className="mt-auto">
        <div className="flex items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[12px]">
          <Crown size={18} className="shrink-0 text-amber-400" />
          {expanded && (
            <div className="min-w-0">
              <div className="font-semibold">SIDB Pro</div>
              <div className="truncate text-[10px] text-muted">Coming later</div>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
