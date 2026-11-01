import { Globe, Moon, Pin, Volume2, VolumeX, X, Sparkles, Home, Bookmark, Clock, Download, Settings, Loader2, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { TabState } from "../../shared/types/browser";
import { internalPageOf } from "../../shared/url";
import { Favicon } from "./Favicon";

function TabIcon({ tab }: { tab: TabState }) {
  if (tab.loading) return <Loader2 size={14} className="shrink-0 animate-spin text-accent-2" />;
  // Icons come from the main-process cache (cookieless, own-origin, checked and sanitised), never straight from the
  // site, so the privileged UI never makes web requests. Remounting when the page announces its icon picks it up.
  if (!tab.internal) return <Favicon key={tab.favicon ?? ""} url={tab.url} favicon={tab.favicon} size={14} className="!rounded-sm" />;
  const icons: Record<string, ReactNode> = {
    newtab: <Home size={14} />,
    ai: <Sparkles size={14} />,
    bookmarks: <Bookmark size={14} />,
    history: <Clock size={14} />,
    downloads: <Download size={14} />,
    settings: <Settings size={14} />,
    shield: <ShieldCheck size={14} />,
  };
  const page = internalPageOf(tab.url);
  return <span className="shrink-0 text-accent">{(page && icons[page]) ?? <Globe size={14} />}</span>;
}

interface Props {
  tab: TabState;
  active: boolean;
  compact?: boolean;
  /** Colour of the tab group this tab belongs to. */
  groupColor?: string | null;
}

export function TabItem({ tab, active, compact, groupColor }: Props) {
  const api = window.sidb.tabs;
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={tab.sleeping ? `${tab.title} (asleep, reloads when opened)` : tab.title}
      data-sleeping={tab.sleeping ? "true" : undefined}
      onClick={() => void api.activate(tab.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        api.showMenu(tab.id);
      }}
      style={groupColor ? { borderBottom: `2px solid ${groupColor}` } : undefined}
      onAuxClick={(e) => {
        if (e.button === 1) void api.close(tab.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") void api.activate(tab.id);
      }}
      className={`no-drag group flex h-8 min-w-0 cursor-default items-center gap-2 rounded-lg px-2.5 text-[12px] transition-colors ${
        active ? "bg-white/10 text-fg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]" : "text-muted hover:bg-white/5"
      } ${compact ? "w-8 justify-center px-0" : "w-full"}`}
    >
      <TabIcon tab={tab} />
      {!compact && (
        <>
          {tab.pinned && <Pin size={11} className="shrink-0 opacity-70" />}
          {tab.sleeping && <Moon size={11} aria-label="Asleep" className="shrink-0 opacity-70" />}
          <span className="min-w-0 flex-1 truncate">{tab.title}</span>
          {(tab.audible || tab.muted) && (
            <button
              aria-label={tab.muted ? "Unmute tab" : "Mute tab"}
              className="shrink-0 opacity-80 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                void api.mute(tab.id, !tab.muted);
              }}
            >
              {tab.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
          )}
          <button
            aria-label="Close tab"
            className="shrink-0 rounded p-0.5 opacity-0 hover:bg-white/10 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              void api.close(tab.id);
            }}
          >
            <X size={13} />
          </button>
        </>
      )}
    </div>
  );
}
