import { Clock, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { HistoryRange } from "../../shared/ipc/dataApi";
import type { HistoryEntry } from "../../shared/types/data";
import { Btn, Chip, PageShell, Panel, SiteIcon } from "../components/PageShell";
import { useLive } from "../hooks/useLive";
import { formatDay, formatTime, hostOf } from "../lib/format";
import { selectActiveTab, useTabs } from "../store/tabs";

const RANGES: Array<{ id: HistoryRange; label: string }> = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "week", label: "Last 7 days" },
  { id: "month", label: "Last 30 days" },
];

function groupByDay(entries: HistoryEntry[]): Array<{ day: string; items: HistoryEntry[] }> {
  const groups: Array<{ day: string; items: HistoryEntry[] }> = [];
  for (const e of entries) {
    const day = formatDay(e.lastVisit);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }
  return groups;
}

export function HistoryPage() {
  const tab = useTabs(selectActiveTab);
  const [range, setRange] = useState<HistoryRange>("all");
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const api = window.sidb.data;

  const list = useLive(() => api.history.list({ query: query || undefined, range, limit: 500 }), ["history"], [range, query]);
  const stats = useLive(() => api.history.stats(), ["history"]);
  const closed = useLive(() => api.history.recentlyClosed(), ["history"]);
  const groups = useMemo(() => groupByDay(list.data ?? []), [list.data]);
  const maxVisits = Math.max(1, ...(stats.data?.perDay.map((d) => d.visits) ?? [1]));

  const open = (url: string) => tab && void window.sidb.tabs.navigate(tab.id, url);

  return (
    <PageShell
      icon={<Clock size={22} />}
      title="History"
      subtitle="See and manage the websites you've visited."
      actions={
        <>
          <label className="glass flex h-9 w-64 items-center gap-2 rounded-lg px-3">
            <Search size={14} className="text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search history..." aria-label="Search history" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted" />
          </label>
          <Btn danger onClick={() => setConfirmClear(true)}>
            <Trash2 size={14} /> Clear History
          </Btn>
        </>
      }
    >
      {confirmClear && (
        <Panel className="mb-4 border-red-400/40">
          <p className="mb-3 text-[13px]">Delete browsing history from:</p>
          <div className="flex flex-wrap gap-2">
            {RANGES.map((r) => (
              <Btn
                key={r.id}
                danger
                onClick={() => {
                  void api.history.clear({ range: r.id });
                  setConfirmClear(false);
                }}
              >
                {r.id === "all" ? "Everything" : r.label}
              </Btn>
            ))}
            <Btn onClick={() => setConfirmClear(false)}>Cancel</Btn>
          </div>
          <p className="mt-2 text-[11px] text-muted">Cookies, logins and bookmarks are not affected.</p>
        </Panel>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <Chip key={r.id} active={range === r.id} onClick={() => setRange(r.id)}>
            {r.label}
          </Chip>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel>
          {list.error && <p className="text-red-300">{list.error}</p>}
          {list.data && groups.length === 0 && <p className="py-10 text-center text-muted">{query ? "No matching history." : "No history yet. Pages you visit will show up here."}</p>}
          {groups.map((g) => (
            <div key={g.day} className="mb-4">
              <h3 className="mb-2 text-[12px] font-semibold text-muted">{g.day}</h3>
              <ul className="space-y-1">
                {g.items.map((e) => (
                  <li key={e.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5">
                    <span className="w-16 shrink-0 text-[11px] text-muted">{formatTime(e.lastVisit)}</span>
                    <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => open(e.url)} title={e.url}>
                      <SiteIcon url={e.url} favicon={e.favicon} />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px]">{e.title || hostOf(e.url)}</span>
                        <span className="block truncate text-[11px] text-muted">{e.url}</span>
                      </span>
                    </button>
                    <button aria-label={`Remove ${e.title || e.url} from history`} className="icon-btn opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void api.history.remove({ ids: [e.id] })}>
                      <X size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Panel>

        <div className="space-y-4">
          <Panel title="Browsing activity (last 7 days)">
            <div className="mb-2 text-2xl font-semibold">{stats.data?.totalVisits ?? 0}</div>
            <div className="flex h-20 items-end gap-2" role="img" aria-label="Visits per day">
              {stats.data?.perDay.map((d) => (
                <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <div className="w-full rounded bg-accent/70" style={{ height: `${Math.max(4, (d.visits / maxVisits) * 100)}%` }} title={`${d.visits} visits`} />
                  <span className="text-[10px] text-muted">{new Date(d.day).toLocaleDateString([], { weekday: "short" }).slice(0, 3)}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Top websites">
            {stats.data?.topSites.length ? (
              <ol className="space-y-2">
                {stats.data.topSites.map((s, i) => (
                  <li key={s.host} className="flex items-center gap-2 text-[13px]">
                    <span className="w-4 text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{s.host}</span>
                    <span className="text-[11px] text-muted">{s.visits} visits</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[12px] text-muted">Nothing yet.</p>
            )}
          </Panel>
          <Panel title="Recently closed tabs">
            {closed.data?.length ? (
              <ul className="space-y-1">
                {closed.data.slice(0, 8).map((c) => (
                  <li key={c.id}>
                    <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5" onClick={() => void api.history.reopenClosed({ id: c.id })}>
                      <RotateCcw size={13} className="shrink-0 text-accent" />
                      <span className="min-w-0 flex-1 truncate text-[12px]">{c.title || hostOf(c.url)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-muted">No recently closed tabs. Ctrl+Shift+T reopens the last one.</p>
            )}
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
