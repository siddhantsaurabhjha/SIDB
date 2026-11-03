import { Btn, Panel, Toggle } from "../../components/PageShell";
import { useLive } from "../../hooks/useLive";

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : "never");

/** Version, update check and what installing an update means. SIDB never installs anything by itself. */
export function AboutPanel() {
  const api = window.sidb.data.updates;
  const { data: s } = useLive(() => api.status(), ["updates"]);
  if (!s) return null;
  const chromium = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] ?? null;

  let line: string;
  if (!s.repo) line = "Update checks are not set up in this build.";
  else if (s.checking) line = "Checking GitHub Releases...";
  else if (s.error) line = s.error;
  else if (s.available && s.latest) line = `SIDB ${s.latest.version} is available.`;
  else if (s.lastCheckedAt) line = "You have the latest version.";
  else line = s.packaged ? "Not checked yet." : "Automatic checks only run in the installed app.";

  return (
    <Panel title="About and updates">
      <div className="mb-3 text-[13px]">
        SIDB {s.current}
        {chromium && <span className="ml-2 text-[11px] text-muted">Chromium {chromium}</span>}
      </div>
      <div role="status" className={`mb-2 text-[12px] ${s.available ? "font-semibold text-accent" : s.error ? "text-red-300" : ""}`}>
        {line}
      </div>
      {s.available && s.latest && (
        <div className="mb-3 rounded-lg border border-line bg-white/5 p-2">
          <div className="text-[12px] font-semibold">{s.latest.name}</div>
          {s.latest.notes && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-sans text-[11px] text-muted">{s.latest.notes}</pre>}
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        {s.available && (
          <Btn primary onClick={() => void api.openRelease()}>
            Open release page
          </Btn>
        )}
        <Btn disabled={!s.repo || s.checking} onClick={() => void api.check()}>
          Check now
        </Btn>
      </div>
      <div className="flex items-center gap-3 border-t border-line pt-3">
        <div className="mr-auto">
          <div className="text-[13px]">Check for updates automatically</div>
          <div className="text-[11px] text-muted">Once a day, one request to GitHub. Last checked: {when(s.lastCheckedAt)}.</div>
        </div>
        <Toggle checked={s.autoCheck} label="Check for updates automatically" onChange={(v) => void api.setAutoCheck({ enabled: v })} />
      </div>
      <p className="mt-3 text-[11px] text-muted">
        SIDB only tells you about a new version; it never downloads or installs one by itself. To update, download the new version from the release page and unpack or install it. Your profiles, bookmarks and history are kept in a separate data folder and stay as they are.
      </p>
    </Panel>
  );
}
