import { Moon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ResourceStats } from "../../../shared/resources";
import { Btn, Panel, Toggle } from "../../components/PageShell";
import { Favicon } from "../../components/Favicon";

const PRESSURE_TEXT: Record<ResourceStats["pressure"], string> = {
  normal: "Enough free memory",
  elevated: "Memory is getting low",
  critical: "Memory is very low",
};

const mb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`);

/** Memory use of SIDB and of each tab in this window, with user-controlled tab sleeping. Refreshes every 3 seconds while open. */
export function PerformancePanel() {
  const api = window.sidb.data.resources;
  const [stats, setStats] = useState<ResourceStats | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => void api.stats().then((s) => alive && setStats(s)).catch(() => undefined);
    load();
    const t = setInterval(load, 3000);
    const off = window.sidb.data.onChange((topic) => topic === "resources" && load());
    return () => {
      alive = false;
      clearInterval(t);
      off();
    };
  }, [api]);

  if (!stats) return <Panel title="Performance"><p className="text-[12px] text-muted">Loading...</p></Panel>;
  const sleepable = stats.tabs.filter((t) => t.protectedReason === null).length;
  const refresh = () => void api.stats().then(setStats);

  return (
    <Panel title="Performance">
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-white/5 p-2">
          <div className="text-[15px] font-semibold">{mb(stats.sidbMB)}</div>
          <div className="text-[10px] text-muted">used by SIDB</div>
        </div>
        <div className="rounded-lg bg-white/5 p-2">
          <div className="text-[15px] font-semibold">{mb(stats.system.freeMB)}</div>
          <div className="text-[10px] text-muted">free of {mb(stats.system.totalMB)}</div>
        </div>
        <div className={`rounded-lg p-2 ${stats.pressure === "normal" ? "bg-white/5" : "bg-amber-500/15"}`}>
          <div className="text-[12px] font-semibold">{PRESSURE_TEXT[stats.pressure]}</div>
          <div className="text-[10px] text-muted">{stats.onBattery ? "On battery: animations reduced" : "Plugged in"}</div>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <span className="mr-auto text-[12px] text-muted">Tabs in this window</span>
        <Btn
          disabled={sleepable === 0}
          onClick={() =>
            void api.sleepBackground().then((n) => {
              setNote(n ? `${n} tab${n === 1 ? "" : "s"} put to sleep. They reload when you open them.` : "No tab could be put to sleep.");
              refresh();
            })
          }
        >
          Sleep background tabs ({sleepable})
        </Btn>
      </div>
      <ul className="max-h-64 space-y-1 overflow-auto pr-1" aria-label="Memory per tab">
        {stats.tabs.map((t) => (
          <li key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] hover:bg-white/5">
            {t.url.startsWith("sidb://") ? <span className="w-4" /> : <Favicon url={t.url} size={16} />}
            <span className={`min-w-0 flex-1 truncate ${t.sleeping ? "text-muted" : ""}`} title={t.url}>
              {t.title}
            </span>
            {t.sleeping ? (
              <span className="flex items-center gap-1 text-[11px] text-muted">
                <Moon size={11} /> asleep
              </span>
            ) : (
              <span className="w-16 text-right tabular-nums text-muted">{t.memoryMB !== null ? mb(t.memoryMB) : "-"}</span>
            )}
            <button
              className="h-6 rounded-md border border-line px-2 text-[11px] hover:bg-white/10 disabled:opacity-40"
              disabled={t.protectedReason !== null}
              title={t.protectedReason ? `Can't sleep: ${t.protectedReason}` : "Unload this tab until you open it again"}
              onClick={() => void api.sleepTab({ id: t.id }).then(refresh)}
            >
              Sleep
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted">
        SIDB never closes or unloads tabs on its own. A sleeping tab keeps its place, back/forward history and scroll position, and reloads when you open it. Tabs that play sound, use the camera or microphone, are pinned or still loading are never put to sleep. Tabs of the same site can share memory, so the numbers may not add up exactly.
      </p>
      {note && <p role="status" className="mt-2 text-[11px]">{note}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <div className="mr-auto min-w-48">
          <div className="text-[13px]">Use hardware acceleration</div>
          <div className="text-[11px] text-muted">
            {stats.gpu.autoDisabled
              ? "Turned off by SIDB because the graphics process kept crashing. Turn it on to try again."
              : stats.gpu.enabledNow !== stats.gpu.enabledNextStart
                ? "Changes after you restart SIDB."
                : "Uses the graphics card for smoother pages. Turn off if pages flicker or go blank."}
          </div>
        </div>
        <Toggle checked={stats.gpu.enabledNextStart} label="Use hardware acceleration" onChange={(v) => void api.setHardwareAcceleration({ enabled: v }).then(refresh)} />
      </div>
    </Panel>
  );
}
