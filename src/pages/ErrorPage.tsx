import { TriangleAlert } from "lucide-react";
import type { TabState } from "../../shared/types/browser";

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Drawn in place of the web view when a main-frame load fails or the page crashes. */
export function ErrorPage({ tab }: { tab: TabState }) {
  const err = tab.error!;
  const api = window.sidb.tabs;
  return (
    <div className="absolute inset-0 grid place-items-center bg-page p-6">
      <div className="glass max-w-lg rounded-2xl p-8">
        <TriangleAlert size={36} className="mb-3 text-amber-400" />
        <h1 className="mb-1 text-xl font-semibold">This page can't be reached</h1>
        <p className="mb-1 text-muted">
          <span className="text-fg">{hostOf(err.url)}</span> could not be loaded.
        </p>
        <p className="mb-5 font-mono text-[11px] text-muted">
          {err.description.replace(/^net::/, "")} {err.code !== -1 && `(${err.code})`}
        </p>
        <div className="flex gap-2">
          <button className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold hover:brightness-110" onClick={() => void api.reload(tab.id)}>
            Try again
          </button>
          <button className="h-9 rounded-lg border border-line px-4 text-[13px] hover:bg-white/10" onClick={() => void api.navigate(tab.id, "sidb://newtab")}>
            Go to New Tab
          </button>
        </div>
      </div>
    </div>
  );
}
