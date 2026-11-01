import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import type { TabState } from "../../shared/types/browser";

/** Full-page warning drawn in place of a site that Safe Browsing flagged. */
export function WarningPage({ tab }: { tab: TabState }) {
  const [details, setDetails] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const w = tab.warning!;
  const api = window.sidb.tabs;

  return (
    <div className="absolute inset-0 grid place-items-center overflow-auto bg-warning force-dark p-6">
      <div className="glass max-w-xl rounded-2xl border-red-400/40 p-8">
        <ShieldAlert size={42} className="mb-3 text-red-400" />
        <h1 className="mb-1 text-2xl font-semibold">Dangerous site blocked</h1>
        <p className="mb-3 text-muted">Google Safe Browsing reports that this site may {w.threats.some((t) => /Phishing/.test(t)) ? "trick you into sharing passwords or personal information" : "harm your device or data"}.</p>
        <ul className="mb-3 list-inside list-disc text-[13px] text-red-200">
          {w.threats.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="mb-5 break-all rounded-lg bg-black/30 p-2 font-mono text-[11px] text-muted">{w.url}</p>

        <button className="h-10 rounded-lg bg-accent px-5 text-[13px] font-semibold hover:brightness-110" onClick={() => void api.navigate(tab.id, "sidb://newtab")}>
          Back to safety
        </button>

        <div className="mt-6 border-t border-line pt-4">
          {!details ? (
            <button className="text-[12px] text-muted underline" onClick={() => setDetails(true)}>
              Details
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-[12px] text-muted">If you understand the risk, you can still visit the site. Do not enter passwords or payment details there.</p>
              <label className="flex items-start gap-2 text-[12px]">
                <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5" />I understand this site may be dangerous.
              </label>
              <button disabled={!understood} className="h-9 rounded-lg border border-red-400/50 px-4 text-[12px] text-red-300 hover:bg-red-400/10 disabled:opacity-40" onClick={() => void api.proceedAnyway(tab.id)}>
                Continue to site (unsafe)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
