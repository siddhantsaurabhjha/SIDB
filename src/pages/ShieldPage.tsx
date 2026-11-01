import { Ban, Globe, RefreshCw, Shield, ShieldAlert, ShieldCheck, Trash2, Play } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Settings } from "../../shared/types/data";
import { Btn, PageShell, Panel, Toggle } from "../components/PageShell";
import { useLive } from "../hooks/useLive";
import { formatBytes } from "../lib/format";

const errMsg = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "") : String(e));


function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-0">
      <div className="mr-auto min-w-48 max-w-xl">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="text-[11px] text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold">{typeof value === "number" ? value.toLocaleString() : value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

const ago = (ts: number | null) => (ts ? new Date(ts).toLocaleString() : "never");

export function ShieldPage() {
  const api = window.sidb.data;
  const status = useLive(() => api.shield.status(), ["shield", "settings"]);
  const exceptions = useLive(() => api.shield.exceptions(), ["shield"]);
  const settings = useLive(() => api.settings.get(), ["settings"]);
  const [host, setHost] = useState("");
  const [rules, setRules] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) setRules(settings.data.customRules);
  }, [settings.data?.customRules]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = status.data;
  const cfg = settings.data;
  if (!s || !cfg) return null;
  const set = (patch: Partial<Settings>) => void api.settings.set({ patch }).catch((e) => setMsg(errMsg(e)));
  const ytRules = s.ready && s.lists.find((l) => l.id === "ublock-filters")?.enabled;

  return (
    <PageShell icon={<Shield size={22} />} title="SIDB Shield" subtitle="Ad, tracker and popup protection, and safer browsing.">
      {msg && (
        <div role="status" className="mb-3 flex justify-between rounded-lg border border-line bg-white/5 px-3 py-2 text-[12px]">
          {msg}
          <button aria-label="Dismiss" onClick={() => setMsg(null)}>
            ×
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <Panel>
            <div className="flex items-center gap-4">
              <div className={`grid h-14 w-14 place-items-center rounded-2xl ${s.enabled ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-muted"}`}>{s.enabled ? <ShieldCheck size={28} /> : <ShieldAlert size={28} />}</div>
              <div className="mr-auto">
                <div className="text-lg font-semibold">{s.enabled ? "Shield is on" : "Shield is off"}</div>
                <div className="text-[12px] text-muted">
                  {s.updating ? "Updating filter lists..." : s.ready ? `${s.networkRules.toLocaleString()} blocking rules and ${s.cosmeticRules.toLocaleString()} page-cleanup rules loaded` : "Filter lists are not downloaded yet. Blocking starts once they are."}
                </div>
              </div>
              <Toggle label="Turn SIDB Shield on or off" checked={s.enabled} onChange={(v) => set({ shieldEnabled: v })} />
            </div>
            <div className="mt-5 flex flex-wrap gap-8">
              <Stat value={s.stats.today} label="Requests blocked today" />
              <Stat value={s.stats.week} label="Last 7 days" />
              <Stat value={s.stats.total} label="All time" />
              <Stat value={s.stats.popupsToday} label="Popups blocked today" />
            </div>
          </Panel>

          <Panel title={<span className="flex items-center gap-2"><Play size={15} className="text-red-400" /> YouTube protection (best effort)</span>}>
            <p className="text-[12px] text-muted">
              {ytRules
                ? "YouTube ad rules and scripts from the uBlock filter lists are active. YouTube changes how it delivers ads often, so some ads can still appear until the lists catch up. Keep the lists updating."
                : "Turn on Shield and the uBlock filters list to enable YouTube rules."}
            </p>
          </Panel>

          <Panel
            title={
              <span className="flex items-center justify-between">
                Filter lists
                <Btn onClick={() => void api.shield.updateNow()} disabled={s.updating}>
                  <RefreshCw size={13} className={s.updating ? "animate-spin" : ""} /> Update now
                </Btn>
              </span>
            }
          >
            <ul className="divide-y divide-line">
              {s.lists.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2.5">
                  <Toggle label={`Use ${l.title}`} checked={l.enabled} onChange={(v) => void api.shield.setListEnabled({ id: l.id, enabled: v })} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px]">{l.title}</div>
                    <div className="truncate text-[11px] text-muted">{l.description}</div>
                  </div>
                  <div className="text-right text-[11px] text-muted">
                    {l.updatedAt ? (
                      <>
                        {formatBytes(l.bytes)}
                        <br />
                        {new Date(l.updatedAt).toLocaleDateString()}
                      </>
                    ) : l.enabled ? (
                      "Not downloaded"
                    ) : (
                      "Off"
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-muted">
              Lists check for updates once a day in the background. A new version is checked and test-built before it replaces the old one; if anything fails, the previous lists keep working. Last check: {ago(s.lastCheck)}. Last success: {ago(s.lastSuccess)}.
            </p>
            {s.lastError && <p className="mt-1 text-[11px] text-amber-300">{s.lastError}</p>}
            <p className="mt-2 text-[11px] text-muted">Lists are downloaded from their publishers (EasyList, uBlock Origin filters, IndianList) and are not bundled with SIDB.</p>
          </Panel>

          <Panel title="Custom rules">
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={5}
              spellCheck={false}
              aria-label="Custom filter rules"
              placeholder={"||ads.example.com^\nexample.com##.sidebar-promo"}
              className="w-full rounded-lg border border-line bg-black/30 p-2 font-mono text-[12px]"
            />
            <div className="mt-2 flex items-center gap-3">
              <Btn primary disabled={rules === cfg.customRules} onClick={() => set({ customRules: rules })}>
                Save rules
              </Btn>
              <span className="text-[11px] text-muted">Adblock Plus / uBlock Origin syntax. Exceptions (@@) only affect your own rules; use website exceptions below to turn Shield off for a site.</span>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Website exceptions">
            <p className="mb-2 text-[11px] text-muted">Shield is off on these sites (and their subdomains), for this profile.</p>
            <form
              className="mb-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void api.shield.addException({ host }).then(() => setHost("")).catch((er) => setMsg(errMsg(er)));
              }}
            >
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" aria-label="Website to exclude" className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-black/30 px-3 text-[12px]" />
              <Btn submit onClick={() => undefined}>
                Add
              </Btn>
            </form>
            <ul className="space-y-1">
              {exceptions.data?.map((x) => (
                <li key={x.host} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                  <Globe size={14} className="text-muted" />
                  <span className="mr-auto text-[13px]">{x.host}</span>
                  <button aria-label={`Remove exception for ${x.host}`} className="icon-btn !h-6 !w-6" onClick={() => void api.shield.removeException({ host: x.host })}>
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
              {exceptions.data?.length === 0 && <li className="text-[12px] text-muted">No exceptions.</li>}
            </ul>
          </Panel>

          <Panel title="Privacy controls">
            <Row label="Block unwanted popups" hint="Blocks pop-up windows that open without a click or key press on the page.">
              <Toggle label="Block unwanted popups" checked={cfg.blockPopups} onChange={(v) => set({ blockPopups: v })} />
            </Row>
            <Row label="Website permissions" hint="Camera, microphone, location, notifications and clipboard always ask first.">
              <span className="text-[12px] text-muted">Ask</span>
            </Row>
            <Row label="Fingerprinting protection (basic)" hint="SIDB reports itself as a regular Chromium browser, and tracker lists cover known fingerprinting scripts. It does not make you anonymous.">
              <span className="text-[12px] text-muted">On</span>
            </Row>
          </Panel>

          <Panel title="Safe Browsing (Google)">
            <Row
              label="Warn about dangerous sites"
              hint={
                <>
                  Uses Google Safe Browsing (non-commercial use) with your own API key. For each page you open, SIDB sends only short hash fragments of the address, never the address itself. Off by default.
                </>
              }
            >
              <Toggle label="Warn about dangerous sites" checked={cfg.safeBrowsingEnabled} onChange={(v) => set({ safeBrowsingEnabled: v })} />
            </Row>
            {!s.safeBrowsing.secureStorage && <p className="text-[11px] text-amber-300">Secure storage is not available on this system, so an API key can't be saved safely.</p>}
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void api.shield.setSafeBrowsingKey({ key: apiKey }).then(() => {
                  setApiKey("");
                  setMsg("API key saved (encrypted by your OS).");
                }).catch((er) => setMsg(errMsg(er)));
              }}
            >
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={s.safeBrowsing.keySet ? "Key saved. Paste a new one to replace" : "Google API key"} aria-label="Safe Browsing API key" autoComplete="off" className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-black/30 px-3 text-[12px]" />
              <Btn submit disabled={!apiKey || !s.safeBrowsing.secureStorage} onClick={() => undefined}>
                Save key
              </Btn>
              {s.safeBrowsing.keySet && (
                <Btn danger onClick={() => void api.shield.clearSafeBrowsingKey()}>
                  <Ban size={13} /> Remove
                </Btn>
              )}
            </form>
            {cfg.safeBrowsingEnabled && !s.safeBrowsing.keySet && <p className="mt-2 text-[11px] text-amber-300">Add an API key for Safe Browsing to work.</p>}
          </Panel>

          <Panel title="DNS">
            <Row label="Secure DNS (DNS over HTTPS)" hint="Off uses your system DNS. If the provider can't be reached, SIDB falls back to system DNS. Applies to all profiles. A provider can see which sites you look up.">
              <Toggle label="Use secure DNS" checked={cfg.secureDns} onChange={(v) => set({ secureDns: v })} />
            </Row>
            {cfg.secureDns && (
              <Row label="Provider">
                <select value={cfg.secureDnsProvider} onChange={(e) => set({ secureDnsProvider: e.target.value as Settings["secureDnsProvider"] })} aria-label="Secure DNS provider" className="h-8 rounded-lg border border-line bg-panel-solid px-2 text-[12px]">
                  <option value="cloudflare">Cloudflare</option>
                  <option value="google">Google</option>
                  <option value="quad9">Quad9</option>
                </select>
              </Row>
            )}
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
