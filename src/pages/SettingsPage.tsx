import { Settings as SettingsIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { SEARCH_ENGINES, type SearchEngineId } from "../../shared/constants/search";
import type { Settings } from "../../shared/types/data";
import { isSafeWebUrl } from "../../shared/url";
import { Btn, Chip, PageShell, Panel, Toggle } from "../components/PageShell";
import { useLive } from "../hooks/useLive";
import { formatBytes } from "../lib/format";
import { AppearancePanels, ShortcutsPanel } from "./settings/AppearancePanels";
import { PerformancePanel } from "./settings/PerformancePanel";
import { AboutPanel } from "./settings/AboutPanel";
import { DEFAULT_AI_MODEL, AI_MODEL_PATTERN } from "../../shared/types/ai";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-0">
      <div className="mr-auto min-w-48">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="text-[11px] text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}


const errMsg = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "") : String(e));

export function SettingsPage() {
  const api = window.sidb.data;
  const { data: s } = useLive(() => api.settings.get(), ["settings"]);
  const profiles = useLive(() => api.profiles.list(), ["profiles"]);
  const backups = useLive(() => api.backup.list(), ["settings"]);
  const [urlsText, setUrlsText] = useState("");
  const [urlsError, setUrlsError] = useState<string | null>(null);
  const [newProfile, setNewProfile] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const aiStatus = useLive(() => api.ai.status(), ["settings"]);
  const [aiKey, setAiKey] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [aiNote, setAiNote] = useState<string | null>(null);

  useEffect(() => {
    if (s) setUrlsText(s.startupUrls.join("\n"));
  }, [s?.startupUrls.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (s) setModelDraft(s.aiModel);
  }, [s?.aiModel]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return null;
  const set = (patch: Partial<Settings>) => void api.settings.set({ patch }).catch((e) => setMsg(errMsg(e)));

  const saveUrls = () => {
    const urls = urlsText.split("\n").map((u) => u.trim()).filter(Boolean);
    const normalized = urls.map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`));
    if (normalized.length > 10) return setUrlsError("Up to 10 start pages.");
    if (normalized.some((u) => !isSafeWebUrl(u))) return setUrlsError("Only http(s) addresses are allowed.");
    setUrlsError(null);
    set({ startupUrls: normalized });
  };

  return (
    <PageShell icon={<SettingsIcon size={22} />} title="Settings" subtitle="Appearance, startup, search, downloads and data.">
      {msg && (
        <div role="status" className="mb-3 flex justify-between rounded-lg border border-line bg-white/5 px-3 py-2 text-[12px]">
          {msg}
          <button aria-label="Dismiss" onClick={() => setMsg(null)}>
            ×
          </button>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <AppearancePanels />
          <Panel title="Layout">
            <Row label="Tab layout" hint="Switching keeps all your tabs.">
              <div className="flex gap-2">
                <Chip active={s.tabLayout === "horizontal"} onClick={() => set({ tabLayout: "horizontal" })}>
                  Horizontal
                </Chip>
                <Chip active={s.tabLayout === "vertical"} onClick={() => set({ tabLayout: "vertical" })}>
                  Vertical
                </Chip>
              </div>
            </Row>
            <Row label="Keep sidebar expanded" hint="Otherwise it expands when you hover it. Ctrl+B toggles.">
              <Toggle label="Keep sidebar expanded" checked={s.sidebarPinned} onChange={(v) => set({ sidebarPinned: v })} />
            </Row>
          </Panel>

          <Panel title="On startup">
            {(
              [
                ["newtab", "Open the New Tab page"],
                ["restore", "Restore previous session"],
                ["urls", "Open specific pages"],
              ] as const
            ).map(([id, label]) => (
              <label key={id} className="flex items-center gap-2 py-1.5 text-[13px]">
                <input type="radio" name="startup" checked={s.startup === id} onChange={() => set({ startup: id })} /> {label}
              </label>
            ))}
            {s.startup === "restore" && <p className="mt-1 text-[11px] text-muted">Only the active tab loads at startup. Other tabs load when you click them. Private windows are never restored.</p>}
            {s.startup === "urls" && (
              <div className="mt-2">
                <textarea value={urlsText} onChange={(e) => setUrlsText(e.target.value)} onBlur={saveUrls} rows={4} aria-label="Start pages, one per line" placeholder={"https://example.com\nhttps://github.com"} className="w-full rounded-lg border border-line bg-black/30 p-2 text-[12px]" />
                {urlsError && <p className="text-[12px] text-red-300">{urlsError}</p>}
              </div>
            )}
          </Panel>

          <Panel title="Search">
            <Row label="Default search engine">
              <select value={s.searchEngine} onChange={(e) => set({ searchEngine: e.target.value as SearchEngineId })} aria-label="Default search engine" className="h-8 rounded-lg border border-line bg-panel-solid px-2 text-[12px]">
                {Object.entries(SEARCH_ENGINES).map(([id, e]) => (
                  <option key={id} value={id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Show search suggestions" hint="As you type in the address bar, the words you type are sent to your search engine to get suggestions. Your history and bookmarks are never sent. Off keeps typing fully local.">
              <Toggle label="Show search suggestions" checked={s.searchSuggestions} onChange={(v) => set({ searchSuggestions: v })} />
            </Row>
          </Panel>

          <Panel title="Downloads">
            <Row label="Save location" hint={s.downloadDir ?? "Your system Downloads folder"}>
              <div className="flex gap-2">
                <Btn onClick={() => void api.downloads.chooseFolder().then((p) => p && set({ downloadDir: p }))}>Change</Btn>
                {s.downloadDir && <Btn onClick={() => set({ downloadDir: null })}>Reset</Btn>}
              </div>
            </Row>
            <Row label="Ask where to save each file">
              <Toggle label="Ask where to save each file" checked={s.askWhereToSave} onChange={(v) => set({ askWhereToSave: v })} />
            </Row>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Profiles">
            <p className="mb-2 text-[11px] text-muted">Each profile has its own bookmarks, history, settings, and cookies and logins.</p>
            <ul className="space-y-1">
              {profiles.data?.profiles.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
                  <span className="mr-auto text-[13px]">{p.name}</span>
                  {p.id === profiles.data?.currentId ? <span className="text-[11px] text-muted">This window</span> : <Btn onClick={() => void api.profiles.open({ id: p.id })}>Open</Btn>}
                </li>
              ))}
            </ul>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newProfile.trim()) return;
                void api.profiles.create({ name: newProfile }).then(() => setNewProfile("")).catch((er) => setMsg(errMsg(er)));
              }}
            >
              <input value={newProfile} onChange={(e) => setNewProfile(e.target.value)} placeholder="New profile name" aria-label="New profile name" maxLength={30} className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-black/30 px-3 text-[12px]" />
              <Btn submit onClick={() => undefined}>
                Add profile
              </Btn>
            </form>
          </Panel>

          <Panel title="Backup and restore">
            <p className="mb-3 text-[11px] text-muted">Backups cover bookmarks, history, download records, settings, shortcuts and site permissions of this profile. Cookies and logins are never included. The 5 newest automatic backups are kept (daily).</p>
            <div className="mb-3 flex flex-wrap gap-2">
              <Btn onClick={() => void api.backup.create().then(() => setMsg("Backup created.")).catch((e) => setMsg(errMsg(e)))}>Back up now</Btn>
              <Btn onClick={() => void api.backup.exportTo().then((p) => p && setMsg(`Exported to ${p}`)).catch((e) => setMsg(errMsg(e)))}>Export...</Btn>
              <Btn
                danger
                onClick={() =>
                  void api.backup
                    .importFrom()
                    .then((ok) => ok && setMsg("Backup imported."))
                    .catch((e) => setMsg(errMsg(e)))
                }
              >
                Import...
              </Btn>
            </div>
            <ul className="space-y-1 text-[12px]">
              {backups.data?.slice(0, 6).map((b) => (
                <li key={b.id} className="flex justify-between text-muted">
                  <span>
                    {new Date(b.createdAt).toLocaleString()} · {b.kind}
                  </span>
                  <span>{formatBytes(b.sizeBytes)}</span>
                </li>
              ))}
              {backups.data?.length === 0 && <li className="text-muted">No backups yet.</li>}
            </ul>
          </Panel>

          <Panel title="SIDB AI (NVIDIA)">
            <p className="mb-3 text-[11px] text-muted">
              SIDB AI sends your messages to NVIDIA's hosted model using your own API key. Text from a web page is sent only when you press a page action or switch on "Current page", never automatically and never from private windows. The free NVIDIA tier is meant for individual development and evaluation, and it is rate limited.
            </p>
            <Row label="API key" hint={aiStatus.data?.keySet ? "Saved (encrypted by your operating system)" : "Not set"}>
              {aiStatus.data?.keySet && (
                <Btn danger onClick={() => void api.ai.clearKey()}>
                  Remove
                </Btn>
              )}
            </Row>
            <form
              className="mb-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void api.ai.setKey({ key: aiKey }).then(() => { setAiKey(""); setAiNote("Key saved."); }).catch((er) => setAiNote(errMsg(er)));
              }}
            >
              <input type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder={aiStatus.data?.keySet ? "Paste a new key to replace" : "nvapi-..."} aria-label="NVIDIA API key" autoComplete="off" className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-black/30 px-3 text-[12px]" />
              <Btn submit disabled={!aiKey || aiStatus.data?.secureStorage === false} onClick={() => undefined}>
                Save key
              </Btn>
            </form>
            {aiStatus.data?.secureStorage === false && <p className="mb-2 text-[11px] text-amber-300">Secure storage is not available here, so a key can't be saved safely.</p>}
            <Row label="Model" hint="One model answers everything. Model names on NVIDIA's catalog change over time.">
              <div className="flex flex-wrap gap-2">
                <input value={modelDraft} onChange={(e) => setModelDraft(e.target.value)} aria-label="Model id" spellCheck={false} className="h-8 w-64 rounded-lg border border-line bg-black/30 px-3 font-mono text-[11px]" />
                <Btn
                  disabled={modelDraft === s.aiModel || !AI_MODEL_PATTERN.test(modelDraft)}
                  onClick={() =>
                    void api.ai.modelExists({ model: modelDraft }).then((ok) => {
                      if (!ok) return setAiNote("NVIDIA's catalog does not list that model.");
                      set({ aiModel: modelDraft });
                      setAiNote("Model saved.");
                    })
                  }
                >
                  Check and save
                </Btn>
                {s.aiModel !== DEFAULT_AI_MODEL && <Btn onClick={() => set({ aiModel: DEFAULT_AI_MODEL })}>Use default</Btn>}
              </div>
            </Row>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn disabled={!aiStatus.data?.keySet} onClick={() => { setAiNote("Testing..."); void api.ai.test().then((r) => setAiNote(r.message)); }}>
                Test connection
              </Btn>
              <Btn danger onClick={() => void api.ai.clearConversations().then(() => setAiNote("Saved chats deleted."))}>
                Delete saved chats
              </Btn>
            </div>
            {aiNote && <p role="status" className="mt-2 text-[11px] text-muted">{aiNote}</p>}
            <p className="mt-2 text-[11px] text-muted">Chats are saved on this device only (text only, never the page content you shared) and are not included in backups.</p>
          </Panel>

          <ShortcutsPanel />

          <PerformancePanel />

          <AboutPanel />

          <Panel title="Privacy and Shield">
            <p className="mb-2 text-[12px] text-muted">Ad and tracker blocking, popups, Safe Browsing, secure DNS and site exceptions are managed in SIDB Shield. Website permission prompts always ask first.</p>
            <Btn onClick={() => void window.sidb.tabs.list().then((t) => { if (t.activeTabId) void window.sidb.tabs.navigate(t.activeTabId, "sidb://shield"); })}>Open Shield</Btn>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
