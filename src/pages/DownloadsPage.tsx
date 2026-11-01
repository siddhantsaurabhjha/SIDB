import { Download, File, FolderOpen, Pause, Play, RotateCw, Search, Trash2, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { DownloadItem } from "../../shared/types/data";
import { Btn, Chip, PageShell, Panel } from "../components/PageShell";
import { useLive } from "../hooks/useLive";
import { formatBytes, formatDay, formatEta, hostOf } from "../lib/format";

type Tab = "all" | "active" | "completed" | "paused" | "failed";

const matches = (d: DownloadItem, tab: Tab) =>
  tab === "all" ||
  (tab === "active" && d.state === "in_progress") ||
  (tab === "completed" && d.state === "completed") ||
  (tab === "paused" && d.state === "paused") ||
  (tab === "failed" && (d.state === "cancelled" || d.state === "failed"));

function Row({ d }: { d: DownloadItem }) {
  const api = window.sidb.data.downloads;
  const running = d.state === "in_progress" || d.state === "paused";
  const pct = d.totalBytes > 0 ? Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100)) : 0;
  const eta = d.speed > 0 && d.totalBytes > 0 ? formatEta((d.totalBytes - d.receivedBytes) / d.speed) : "";
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <li className="rounded-xl border border-line bg-white/5 p-3">
      <div className="flex items-center gap-3">
        <File size={22} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium" title={d.savePath}>
              {d.fileName}
            </span>
            {d.state === "failed" && <span className="rounded bg-red-400/20 px-1.5 text-[10px] text-red-300">Failed</span>}
            {d.state === "cancelled" && <span className="rounded bg-white/10 px-1.5 text-[10px] text-muted">Cancelled</span>}
            {d.state === "paused" && <span className="rounded bg-amber-400/20 px-1.5 text-[10px] text-amber-300">Paused</span>}
            {d.state === "completed" && !d.exists && <span className="rounded bg-white/10 px-1.5 text-[10px] text-muted">File moved or deleted</span>}
          </div>
          <div className="truncate text-[11px] text-muted" title={d.sourceUrl}>
            {hostOf(d.sourceUrl)} · {d.state === "completed" ? `${formatBytes(d.totalBytes)} · ${formatDay(d.completedAt ?? d.startedAt)}` : `${formatBytes(d.receivedBytes)} of ${d.totalBytes ? formatBytes(d.totalBytes) : "unknown size"}`}
            {running && d.speed > 0 && ` · ${formatBytes(d.speed)}/s`} {eta && `· ${eta}`}
          </div>
          {d.riskWarning && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-300">
              <TriangleAlert size={12} /> {d.riskWarning}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {running && (
            <>
              {d.state === "paused" ? (
                <button aria-label="Resume download" className="icon-btn" onClick={() => void api.resume({ id: d.id })}>
                  <Play size={16} />
                </button>
              ) : (
                <button aria-label="Pause download" className="icon-btn" onClick={() => void api.pause({ id: d.id })}>
                  <Pause size={16} />
                </button>
              )}
              <button aria-label="Cancel download" className="icon-btn" onClick={() => void api.cancel({ id: d.id })}>
                <X size={16} />
              </button>
            </>
          )}
          {(d.state === "failed" || d.state === "cancelled") && (
            <button aria-label="Retry download" className="icon-btn" onClick={() => void api.retry({ id: d.id })}>
              <RotateCw size={15} />
            </button>
          )}
          {d.state === "completed" && d.exists && (
            <>
              <Btn onClick={() => (d.riskWarning ? setConfirmOpen(true) : void api.open({ id: d.id }))}>Open</Btn>
              <button aria-label="Show in folder" title="Show in folder" className="icon-btn" onClick={() => void api.reveal({ id: d.id })}>
                <FolderOpen size={16} />
              </button>
            </>
          )}
          {!running && (
            <button aria-label="Remove from list (keeps the file)" title="Remove from list (keeps the file)" className="icon-btn" onClick={() => void api.remove({ id: d.id })}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
      {running && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${d.fileName} progress`}>
          <div className={`h-full rounded-full ${d.state === "paused" ? "bg-amber-400" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {confirmOpen && (
        <div role="alertdialog" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-[12px]">
          <span className="mr-auto">This file can run code on your computer. Open it only if you trust {hostOf(d.sourceUrl)}.</span>
          <Btn
            onClick={() => {
              setConfirmOpen(false);
              void api.open({ id: d.id });
            }}
          >
            Open anyway
          </Btn>
          <Btn onClick={() => setConfirmOpen(false)}>Cancel</Btn>
        </div>
      )}
    </li>
  );
}

export function DownloadsPage() {
  const api = window.sidb.data.downloads;
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const { data = [], error } = useLive(() => api.list(), ["downloads"]);

  const shown = useMemo(() => data.filter((d) => matches(d, tab) && (!query || d.fileName.toLowerCase().includes(query.toLowerCase()))), [data, tab, query]);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const week = data.filter((d) => d.state === "completed" && (d.completedAt ?? 0) >= weekAgo);
  const activeCount = data.filter((d) => d.state === "in_progress").length;
  const tabs: Array<[Tab, string]> = [
    ["all", "All"],
    ["active", `In Progress${activeCount ? ` (${activeCount})` : ""}`],
    ["completed", "Completed"],
    ["paused", "Paused"],
    ["failed", "Cancelled / Failed"],
  ];

  return (
    <PageShell
      icon={<Download size={22} />}
      title="Downloads"
      subtitle="Manage your downloaded files."
      actions={
        <label className="glass flex h-9 w-64 items-center gap-2 rounded-lg px-3">
          <Search size={14} className="text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search downloads..." aria-label="Search downloads" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted" />
        </label>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
          <Chip key={id} active={tab === id} onClick={() => setTab(id)}>
            {label}
          </Chip>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Panel>
          {error && <p className="text-red-300">{error}</p>}
          {shown.length === 0 ? <p className="py-10 text-center text-muted">{data.length ? "No downloads in this view." : "No downloads yet."}</p> : <ul className="space-y-2">{shown.map((d) => <Row key={d.id} d={d} />)}</ul>}
        </Panel>
        <div className="space-y-4">
          <Panel title="This week">
            <div className="flex gap-6">
              <div>
                <div className="text-2xl font-semibold">{week.length}</div>
                <div className="text-[11px] text-muted">Files downloaded</div>
              </div>
              <div>
                <div className="text-2xl font-semibold">{formatBytes(week.reduce((s, d) => s + d.totalBytes, 0))}</div>
                <div className="text-[11px] text-muted">Total size</div>
              </div>
            </div>
          </Panel>
          <Panel title="Quick actions">
            <div className="space-y-2">
              <Btn onClick={() => void api.clearFinished()}>
                <Trash2 size={13} /> Clear finished downloads
              </Btn>
              <p className="text-[11px] text-muted">Clearing the list never deletes the downloaded files.</p>
            </div>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
