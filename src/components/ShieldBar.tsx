import { ShieldCheck, ShieldOff, X } from "lucide-react";
import { selectActiveTab, useTabs } from "../store/tabs";
import { useUi } from "../store/ui";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Per-site Shield summary strip. Sits above the page (not over it) so the web view never covers it. */
export function ShieldBar() {
  const tab = useTabs(selectActiveTab);
  if (!tab || tab.internal) return null;
  const host = hostOf(tab.url);
  const api = window.sidb.data.shield;
  const off = tab.shield !== "on";
  const profileOff = tab.shield === "off";

  return (
    <div role="region" aria-label="Shield for this site" className="glass flex h-11 shrink-0 flex-wrap items-center gap-3 border-x-0 border-t-0 px-4">
      {off ? <ShieldOff size={16} className="text-muted" /> : <ShieldCheck size={16} className="text-emerald-300" />}
      <span className="text-[13px]">
        {profileOff ? "Shield is off" : off ? `Shield is off for ${host}` : `Shield is on for ${host}`}
        {!off && (
          <span className="ml-2 text-muted">
            {tab.blocked.toLocaleString()} blocked on this page{tab.popupsBlocked > 0 ? `, ${tab.popupsBlocked} popup${tab.popupsBlocked === 1 ? "" : "s"} blocked` : ""}
          </span>
        )}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {!profileOff && host && (
          <button
            className="h-8 rounded-lg border border-line px-3 text-[12px] hover:bg-white/10"
            onClick={() => void (off ? api.removeException({ host }) : api.addException({ host })).then(() => window.sidb.tabs.reload(tab.id))}
          >
            {off ? "Turn on for this site" : "Turn off for this site"}
          </button>
        )}
        <button className="h-8 rounded-lg border border-line px-3 text-[12px] hover:bg-white/10" onClick={() => void window.sidb.tabs.navigate(tab.id, "sidb://shield")}>
          Shield settings
        </button>
        <button aria-label="Close" className="icon-btn" onClick={() => useUi.getState().setShieldBarOpen(false)}>
          <X size={16} />
        </button>
      </span>
    </div>
  );
}
