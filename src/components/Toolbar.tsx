import { ArrowLeft, ArrowRight, Download, Home, PanelLeft, RotateCw, Sparkles, Star, X, Columns2, Rows2, ZoomIn, ShieldCheck, ShieldOff, Command } from "lucide-react";
import { TOOLBAR_ITEMS } from "../../shared/types/data";
import { useLive } from "../hooks/useLive";
import { AddressBar } from "./AddressBar";
import { useDialogs } from "../store/dialogs";
import { selectActiveTab, useTabs } from "../store/tabs";
import { useUi } from "../store/ui";

export function Toolbar() {
  const tab = useTabs(selectActiveTab);
  const zoom = tab?.zoom ?? 1;
  const aiOpen = useUi((s) => s.aiPanelOpen);
  const layout = useUi((s) => s.tabLayout);
  const shieldBarOpen = useUi((s) => s.shieldBarOpen);
  const api = window.sidb.tabs;
  const internal = tab?.internal ?? true;

  const marked = useLive(() => (tab && !tab.internal ? window.sidb.data.bookmarks.findByUrl({ url: tab.url }) : Promise.resolve(null)), ["bookmarks"], [tab?.id, tab?.url]);
  const bookmarked = !internal && !!marked.data;
  const toggleBookmark = async () => {
    if (!tab || internal) return;
    const data = window.sidb.data.bookmarks;
    if (marked.data) await data.remove({ id: marked.data.id });
    else await data.add({ title: tab.title, url: tab.url, favicon: tab.favicon });
  };

  const hiddenItems = useUi((s) => s.settings.hiddenToolbarItems);
  const show = (item: (typeof TOOLBAR_ITEMS)[number]) => !hiddenItems.includes(item);

  return (
    <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line bg-black/20 px-3">
      <button aria-label="Back" className="icon-btn" disabled={!tab?.canGoBack} onClick={() => tab && void api.back(tab.id)}>
        <ArrowLeft size={17} />
      </button>
      <button aria-label="Forward" className="icon-btn" disabled={!tab?.canGoForward} onClick={() => tab && void api.forward(tab.id)}>
        <ArrowRight size={17} />
      </button>
      <button
        aria-label={tab?.loading ? "Stop loading" : "Reload"}
        className="icon-btn"
        disabled={internal}
        onClick={() => tab && void (tab.loading ? api.stop(tab.id) : api.reload(tab.id))}
      >
        {tab?.loading ? <X size={17} /> : <RotateCw size={16} />}
      </button>
      <button aria-label="Home" className="icon-btn" onClick={() => tab && void api.navigate(tab.id, "sidb://newtab")}>
        <Home size={17} />
      </button>

      <AddressBar />

      {show("shield") && (
      <button
        aria-label={tab?.shield === "on" ? `Shield: ${tab.blocked} blocked on this page` : "Shield is off for this page"}
        aria-pressed={shieldBarOpen}
        title="Shield"
        disabled={internal}
        onClick={() => useUi.getState().setShieldBarOpen(!shieldBarOpen)}
        className="icon-btn relative"
      >
        {tab?.shield === "on" || internal ? <ShieldCheck size={17} className={internal ? "" : "text-emerald-300"} /> : <ShieldOff size={17} />}
        {!internal && tab && tab.blocked > 0 && tab.shield === "on" && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[9px] font-bold leading-4">{tab.blocked > 99 ? "99+" : tab.blocked}</span>
        )}
      </button>
      )}
      {Math.abs(zoom - 1) > 0.001 && tab && (
        <button title="Reset zoom" aria-label={`Zoom ${Math.round(zoom * 100)}%, click to reset`} className="flex h-8 items-center gap-1 rounded-lg border border-line px-2 text-[12px] text-muted hover:text-fg" onClick={() => void api.zoom(tab.id, "reset")}>
          <ZoomIn size={14} /> {Math.round(zoom * 100)}%
        </button>
      )}
      {show("bookmark") && (
      <button aria-label={bookmarked ? "Remove bookmark" : "Bookmark this page"} aria-pressed={bookmarked} title={bookmarked ? "Remove bookmark" : "Bookmark this page"} className="icon-btn" disabled={internal} onClick={() => void toggleBookmark()}>
        <Star size={17} className={bookmarked ? "fill-amber-400 text-amber-400" : ""} />
      </button>
      )}
      {show("downloads") && (
      <button aria-label="Downloads" className="icon-btn" onClick={() => tab && void api.navigate(tab.id, "sidb://downloads")}>
        <Download size={17} />
      </button>
      )}
      <button aria-label="Command palette" title="Command palette (Ctrl+K)" className="icon-btn" onClick={() => useDialogs.getState().openPalette()}>
        <Command size={17} />
      </button>
      {show("layout") && (
      <button
        aria-label="Toggle tab layout"
        title={layout === "horizontal" ? "Switch to vertical tabs" : "Switch to horizontal tabs"}
        className="icon-btn"
        onClick={() => useUi.getState().setTabLayout(layout === "horizontal" ? "vertical" : "horizontal")}
      >
        {layout === "horizontal" ? <Columns2 size={17} /> : <Rows2 size={17} />}
      </button>
      )}
      {show("sidebar") && (
      <button aria-label="Toggle sidebar" className="icon-btn" onClick={() => useUi.getState().toggleSidebarPinned()}>
        <PanelLeft size={17} />
      </button>
      )}
      {show("ai") && (
      <button
        aria-label="Toggle AI panel"
        aria-pressed={aiOpen}
        onClick={() => useUi.getState().toggleAiPanel()}
        className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-semibold ${
          aiOpen ? "border-accent bg-accent/25 text-fg" : "border-line text-muted hover:text-fg"
        }`}
      >
        <Sparkles size={14} /> AI
      </button>
      )}
    </div>
  );
}
