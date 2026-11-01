import { Bookmark, Download, History, Palette, Search, VenetianMask } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Settings } from "../../shared/types/data";
import dashboardBg from "../assets/dashboard-bg.jpg";
import logo from "../assets/logo.png";
import { SiteIcon } from "../components/PageShell";
import { useLive } from "../hooks/useLive";
import { hostOf } from "../lib/format";
import { selectActiveTab, useTabs } from "../store/tabs";
import { useUi } from "../store/ui";
import { ShortcutGrid } from "./ShortcutGrid";

const GRADIENTS: Record<Exclude<Settings["newTabBackground"], "scenery" | "custom">, string> = {
  aurora: "radial-gradient(ellipse at 20% 10%, #1f6f6a 0%, transparent 55%), radial-gradient(ellipse at 80% 20%, #5b3bd6 0%, transparent 55%), linear-gradient(160deg, #0a1020, #07060f)",
  midnight: "radial-gradient(ellipse at 50% 0%, #20285a 0%, #0b0d1f 60%, #05060d 100%)",
  dusk: "radial-gradient(ellipse at 50% 100%, #c2410c 0%, transparent 55%), radial-gradient(ellipse at 30% 0%, #6d28d9 0%, transparent 60%), linear-gradient(180deg, #1b1033, #0b0716)",
};

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="glass rounded-2xl px-4 py-2 text-right">
      <div className="text-3xl font-light">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
      <div className="text-[12px] text-muted">{now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</div>
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] text-muted hover:bg-white/5 hover:text-fg">
      {icon} {label}
    </button>
  );
}

function backgroundStyle(kind: Settings["newTabBackground"], custom: string | null | undefined): React.CSSProperties {
  const dim = "linear-gradient(rgb(7 6 15 / 0.35), rgb(7 6 15 / 0.55))";
  if (kind === "custom" && custom) return { backgroundImage: `${dim}, url(${custom})` };
  if (kind === "scenery" || kind === "custom") return { backgroundImage: `${dim}, url(${dashboardBg})` };
  return { backgroundImage: GRADIENTS[kind] };
}

export function NewTabPage() {
  const tab = useTabs(selectActiveTab);
  const s = useUi((st) => st.settings);
  const go = (input: string) => tab && void window.sidb.tabs.navigate(tab.id, input);
  const [query, setQuery] = useState("");
  const wallpaper = useLive(() => (s.newTabBackground === "custom" ? window.sidb.data.appearance.wallpaper() : Promise.resolve(null)), ["appearance"], [s.newTabBackground]);
  const recent = useLive(() => (s.newTabContinue ? window.sidb.data.history.list({ limit: 4 }) : Promise.resolve([])), ["history"], [s.newTabContinue]);

  return (
    // The page sits on a photo or a dark gradient, so it always uses the dark palette (readable in the light theme too).
    <div className="force-dark absolute inset-0 overflow-auto bg-cover bg-center" style={backgroundStyle(s.newTabBackground, wallpaper.data)}>
      <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center gap-7 p-6 pt-8">
        <div className="flex w-full justify-end">{s.newTabClock && <Clock />}</div>

        <div className="flex flex-col items-center gap-1">
          <img src={logo} alt="SIDB" width={130} height={130} draggable={false} className="mix-blend-screen" />
          <p className="text-muted">A Browser Built Around You.</p>
        </div>

        <form
          className="glass flex h-12 w-full items-center gap-3 rounded-full px-5 focus-within:border-accent/60"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) go(query);
          }}
        >
          <Search size={17} className="text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search or type a URL"
            placeholder="Search or type a URL"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted"
          />
        </form>

        <ShortcutGrid onOpen={go} />

        <div className="grid w-full gap-4 md:grid-cols-2">
          {s.newTabContinue && (
            <div className="glass rounded-2xl p-2">
              <div className="px-3 py-2 text-[12px] font-semibold text-muted">Continue browsing</div>
              {recent.data?.length ? (
                recent.data.map((h) => (
                  <button key={h.id} onClick={() => go(h.url)} title={h.url} className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] hover:bg-white/5">
                    <SiteIcon url={h.url} favicon={h.favicon} size={18} />
                    <span className="min-w-0 flex-1 truncate">{h.title || hostOf(h.url)}</span>
                    <span className="shrink-0 text-[11px] text-muted">{hostOf(h.url)}</span>
                  </button>
                ))
              ) : (
                <p className="px-3 py-4 text-[12px] text-muted">Pages you visit will show up here.</p>
              )}
            </div>
          )}
          {s.newTabQuickActions && (
            <div className="glass rounded-2xl p-2">
              <div className="px-3 py-2 text-[12px] font-semibold text-muted">Quick Actions</div>
              <QuickAction icon={<VenetianMask size={16} />} label="New Private Window" onClick={() => window.sidb.window.newPrivate()} />
              <QuickAction icon={<Download size={16} />} label="Open Downloads" onClick={() => go("sidb://downloads")} />
              <QuickAction icon={<Bookmark size={16} />} label="View Bookmarks" onClick={() => go("sidb://bookmarks")} />
              <QuickAction icon={<History size={16} />} label="View History" onClick={() => go("sidb://history")} />
              <QuickAction icon={<Palette size={16} />} label="Customize" onClick={() => go("sidb://settings")} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
