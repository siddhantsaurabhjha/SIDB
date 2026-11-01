import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { ipcMain, webContents, type Session } from "electron";
import type { FiltersEngine } from "@ghostery/adblocker";
import type { FilterListInfo, ShieldStatus } from "../../../shared/types/shield";
import type { ProfileRuntime } from "../profiles/ProfileManager";
import { findTabByWebContents } from "../windows/registry";
import { cosmeticsFor, decide, engineStats, FiltersEngine as Engine, hostInfo, parseCustomRules, type CosmeticQuery } from "./engine";
import { FILTER_LISTS, MAX_LIST_BYTES, RESOURCES_URL, type ListDef } from "./lists";
import { SafeBrowsingClient } from "./safeBrowsing";
import type { SecretStore } from "./SecretStore";
import { listVersion, validateList, validateResources } from "./validate";

const DAY_MS = 86_400_000;
const FETCH_TIMEOUT_MS = 60_000;
const MIN_NETWORK_RULES = 1000; // a build with fewer rules than this is treated as broken
const UNSAFE_BYPASS_MS = 10 * 60_000;
export const SAFE_BROWSING_SECRET = "safeBrowsingApiKey";

interface ListState {
  enabled: boolean;
  version: string | null;
  etag: string | null;
  updatedAt: number | null;
  bytes: number;
}

interface Manifest {
  lists: Record<string, ListState>;
  resources: { etag: string | null; updatedAt: number | null };
  lastCheck: number | null;
  lastSuccess: number | null;
  lastError: string | null;
  /** Identifies what the cached engine.bin was built from. */
  engineKey: string | null;
  networkRules: number;
  cosmeticRules: number;
}

const emptyManifest = (): Manifest => ({
  lists: Object.fromEntries(FILTER_LISTS.map((d) => [d.id, { enabled: d.defaultEnabled, version: null, etag: null, updatedAt: null, bytes: 0 }])),
  resources: { etag: null, updatedAt: null },
  lastCheck: null,
  lastSuccess: null,
  lastError: null,
  engineKey: null,
  networkRules: 0,
  cosmeticRules: 0,
});

// Copied next to the main bundle at build time (scripts/copy-runtime-files.mjs), so packaged builds need no node_modules.
const PRELOAD_PATH = () => path.join(__dirname, "..", "shield", "cosmetic-preload.cjs");

/**
 * SIDB Shield: downloads and verifies filter lists, builds the blocking engine off the UI thread,
 * and applies it to browsing sessions (network blocking, element hiding, scriptlets, popups, Safe Browsing).
 * One engine is shared by all profiles; on/off switches and exceptions are per profile.
 */
export class ShieldService {
  private engine: FiltersEngine | null = null;
  private manifest: Manifest = emptyManifest();
  private updating = false;
  private customCache = new Map<string, { text: string; engine: FiltersEngine | null }>();
  private counters = new Map<string, { runtime: ProfileRuntime; blocked: number; popups: number }>();
  private unsafeBypass = new Map<string, number>();
  private timers: NodeJS.Timeout[] = [];
  readonly safeBrowsing: SafeBrowsingClient;

  constructor(
    private readonly dir: string,
    private readonly secrets: SecretStore,
    private readonly onChange: () => void,
  ) {
    this.safeBrowsing = new SafeBrowsingClient(() => this.secrets.get(SAFE_BROWSING_SECRET));
    fs.mkdirSync(this.listsDir, { recursive: true });
  }

  private get listsDir() {
    return path.join(this.dir, "lists");
  }
  private get manifestFile() {
    return path.join(this.dir, "manifest.json");
  }
  private get engineFile() {
    return path.join(this.dir, "engine.bin");
  }

  // ------------------------------------------------------------------ startup ----------------

  async init(): Promise<void> {
    this.manifest = this.readManifest();
    await this.loadEngineFromDisk();

    // First run (no lists yet) updates soon; afterwards a check runs at most once a day.
    const firstRun = this.engine === null;
    this.timers.push(setTimeout(() => void this.maybeUpdate(), firstRun ? 4_000 : 45_000));
    this.timers.push(setInterval(() => void this.maybeUpdate(), 3_600_000));
    this.timers.push(setInterval(() => void this.flushCounters(), 10_000));
    for (const t of this.timers) t.unref();
    this.registerCosmeticIpc();
  }

  dispose(): void {
    this.timers.forEach(clearTimeout);
    void this.flushCounters();
  }

  private async maybeUpdate(): Promise<void> {
    const last = this.manifest.lastCheck;
    if (!this.engine || !last || Date.now() - last > DAY_MS) await this.update(false);
  }

  private readManifest(): Manifest {
    try {
      const saved = JSON.parse(fs.readFileSync(this.manifestFile, "utf8")) as Partial<Manifest>;
      const base = emptyManifest();
      return { ...base, ...saved, lists: { ...base.lists, ...saved.lists }, resources: { ...base.resources, ...saved.resources } };
    } catch {
      return emptyManifest();
    }
  }

  private writeAtomic(file: string, data: string | Uint8Array): void {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  }

  private saveManifest(): void {
    this.writeAtomic(this.manifestFile, JSON.stringify(this.manifest, null, 2));
  }

  private enabledDefs(): ListDef[] {
    return FILTER_LISTS.filter((d) => this.manifest.lists[d.id]?.enabled);
  }

  private keyFor(defs: ListDef[]): string {
    return defs.map((d) => `${d.id}:${this.manifest.lists[d.id].updatedAt ?? 0}`).join("|") + `|res:${this.manifest.resources.updatedAt ?? 0}`;
  }

  /** Uses the cached engine when it matches the current lists, otherwise rebuilds from the files on disk. */
  private async loadEngineFromDisk(): Promise<void> {
    const defs = this.enabledDefs();
    if (defs.length === 0) return;
    try {
      if (this.manifest.engineKey === this.keyFor(defs) && fs.existsSync(this.engineFile)) {
        this.engine = Engine.deserialize(fs.readFileSync(this.engineFile));
        return;
      }
    } catch {
      this.engine = null; // corrupt cache: fall through to a rebuild
    }
    const texts = this.readTexts(defs, false);
    if (texts.length === 0) return;
    try {
      await this.buildAndActivate(texts, this.readResources(false), defs);
    } catch {
      // Current files are bad: fall back to the last known good copies.
      const prev = this.readTexts(defs, true);
      if (prev.length === 0) return;
      try {
        await this.buildAndActivate(prev, this.readResources(true), defs);
        this.restorePrevious(defs);
      } catch {
        this.engine = null;
      }
    }
  }

  private readTexts(defs: ListDef[], prev: boolean): string[] {
    const out: string[] = [];
    for (const d of defs) {
      try {
        out.push(fs.readFileSync(path.join(this.listsDir, `${d.id}.txt${prev ? ".prev" : ""}`), "utf8"));
      } catch {
        /* list not downloaded yet */
      }
    }
    return out;
  }

  private readResources(prev: boolean): string | null {
    try {
      return fs.readFileSync(path.join(this.listsDir, `resources.json${prev ? ".prev" : ""}`), "utf8");
    } catch {
      return null;
    }
  }

  private restorePrevious(defs: ListDef[]): void {
    for (const d of [...defs.map((x) => `${x.id}.txt`), "resources.json"]) {
      const prev = path.join(this.listsDir, `${d}.prev`);
      if (fs.existsSync(prev)) fs.copyFileSync(prev, path.join(this.listsDir, d));
    }
  }

  // ------------------------------------------------------------------ engine build -----------

  private buildInWorker(texts: string[], resources: string | null): Promise<{ bytes: Uint8Array; network: number; cosmetic: number }> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "buildWorker.cjs"), { workerData: { texts, resources } });
      worker.once("message", (m: { ok: boolean; bytes?: Uint8Array; network?: number; cosmetic?: number; error?: string }) => {
        if (m.ok && m.bytes) resolve({ bytes: m.bytes, network: m.network ?? 0, cosmetic: m.cosmetic ?? 0 });
        else reject(new Error(m.error ?? "Engine build failed"));
      });
      worker.once("error", reject);
      worker.once("exit", (code) => code !== 0 && reject(new Error(`Engine build exited with code ${code}`)));
    });
  }

  /** Builds an engine from list texts, sanity-checks it, then makes it the active one and caches it. */
  private async buildAndActivate(texts: string[], resources: string | null, defs: ListDef[]): Promise<void> {
    const built = await this.buildInWorker(texts, resources);
    if (built.network < MIN_NETWORK_RULES) throw new Error(`Built engine has only ${built.network} network rules`);
    const engine = Engine.deserialize(built.bytes);
    this.engine = engine;
    this.manifest.networkRules = built.network;
    this.manifest.cosmeticRules = built.cosmetic;
    this.manifest.engineKey = this.keyFor(defs);
    this.writeAtomic(this.engineFile, built.bytes);
    this.saveManifest();
  }

  // ------------------------------------------------------------------ updates ----------------

  private async download(url: string, etag: string | null): Promise<{ text: string; etag: string | null } | "not-modified"> {
    const res = await fetch(url, {
      headers: { "user-agent": "SIDB-Browser/0.1", ...(etag ? { "if-none-match": etag } : {}) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 304) return "not-modified";
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_LIST_BYTES) throw new Error("download is too large");
    return { text: await res.text(), etag: res.headers.get("etag") };
  }

  /**
   * Downloads changed lists, validates them, builds a new engine, and only then replaces the files.
   * Any failure leaves the current lists and engine exactly as they were.
   */
  async update(force: boolean): Promise<void> {
    if (this.updating) return;
    this.updating = true;
    this.onChange();
    const pending: string[] = []; // staged ".new" files to clean up on failure
    try {
      this.manifest.lastCheck = Date.now();
      const defs = this.enabledDefs();
      const changed = new Map<string, { text: string; etag: string | null }>();
      const errors: string[] = [];

      for (const def of defs) {
        const state = this.manifest.lists[def.id];
        const haveFile = fs.existsSync(path.join(this.listsDir, `${def.id}.txt`));
        try {
          const got = await this.download(def.url, force || !haveFile ? null : state.etag);
          if (got === "not-modified") continue;
          validateList(def, got.text, state.bytes);
          changed.set(def.id, got);
        } catch (e) {
          errors.push(`${def.title}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      let resources: { text: string; etag: string | null } | null = null;
      try {
        const got = await this.download(RESOURCES_URL, force || !this.readResources(false) ? null : this.manifest.resources.etag);
        if (got !== "not-modified") {
          validateResources(got.text);
          resources = got;
        }
      } catch (e) {
        errors.push(`Resources: ${e instanceof Error ? e.message : String(e)}`);
      }

      if (changed.size === 0 && !resources && this.engine) {
        this.manifest.lastSuccess = errors.length === 0 ? Date.now() : this.manifest.lastSuccess;
        this.manifest.lastError = errors.length ? errors.join("; ") : null;
        this.saveManifest();
        return;
      }

      // Candidate = new downloads + current files for everything else.
      const texts: string[] = [];
      for (const def of defs) {
        const fresh = changed.get(def.id)?.text;
        if (fresh) texts.push(fresh);
        else {
          const cur = this.readTexts([def], false)[0];
          if (cur) texts.push(cur);
        }
      }
      if (texts.length === 0) throw new Error(errors.join("; ") || "No filter lists available");
      const candidateResources = resources?.text ?? this.readResources(false);

      // Throws if the engine can't be built or looks broken; nothing has been replaced yet.
      const built = await this.buildInWorker(texts, candidateResources);
      if (built.network < MIN_NETWORK_RULES) throw new Error(`New engine has only ${built.network} network rules; keeping the current one`);

      // Commit: keep the old file as ".prev", move the new one into place.
      const now = Date.now();
      const swap = (name: string, content: string) => {
        const target = path.join(this.listsDir, name);
        const staged = `${target}.new`;
        pending.push(staged);
        fs.writeFileSync(staged, content);
        if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.prev`);
        fs.renameSync(staged, target);
      };
      for (const [id, got] of changed) {
        swap(`${id}.txt`, got.text);
        Object.assign(this.manifest.lists[id], { version: listVersion(got.text), etag: got.etag, updatedAt: now, bytes: got.text.length });
      }
      if (resources) {
        swap("resources.json", resources.text);
        this.manifest.resources = { etag: resources.etag, updatedAt: now };
      }

      this.engine = Engine.deserialize(built.bytes);
      this.manifest.networkRules = built.network;
      this.manifest.cosmeticRules = built.cosmetic;
      this.manifest.engineKey = this.keyFor(defs);
      this.writeAtomic(this.engineFile, built.bytes);
      this.manifest.lastSuccess = now;
      this.manifest.lastError = errors.length ? `Some lists could not be updated: ${errors.join("; ")}` : null;
      this.saveManifest();
    } catch (e) {
      for (const f of pending) fs.rmSync(f, { force: true });
      this.manifest.lastError = e instanceof Error ? e.message : String(e);
      this.saveManifest();
    } finally {
      this.updating = false;
      this.onChange();
    }
  }

  async setListEnabled(id: string, enabled: boolean): Promise<void> {
    const state = this.manifest.lists[id];
    if (!state || state.enabled === enabled) return;
    state.enabled = enabled;
    this.saveManifest();
    const defs = this.enabledDefs();
    if (defs.length === 0) {
      this.engine = null;
      this.manifest.engineKey = null;
      this.saveManifest();
    } else if (enabled && !fs.existsSync(path.join(this.listsDir, `${id}.txt`))) {
      await this.update(true);
    } else {
      try {
        await this.buildAndActivate(this.readTexts(defs, false), this.readResources(false), defs);
      } catch (e) {
        this.manifest.lastError = e instanceof Error ? e.message : String(e);
        this.saveManifest();
      }
    }
    this.onChange();
  }

  // ------------------------------------------------------------------ status -----------------

  async status(profile: ProfileRuntime): Promise<ShieldStatus> {
    const settings = profile.settings.peek();
    const lists: FilterListInfo[] = FILTER_LISTS.map((d) => ({ id: d.id, title: d.title, description: d.description, url: d.url, ...this.manifest.lists[d.id] }));
    const pending = this.counters.get(profile.info.id);
    const saved = await profile.shieldData.summary();
    return {
      enabled: settings.shieldEnabled,
      ready: this.engine !== null,
      updating: this.updating,
      networkRules: this.manifest.networkRules,
      cosmeticRules: this.manifest.cosmeticRules,
      lists,
      lastCheck: this.manifest.lastCheck,
      lastSuccess: this.manifest.lastSuccess,
      lastError: this.manifest.lastError,
      stats: {
        today: saved.today + (pending?.blocked ?? 0),
        week: saved.week + (pending?.blocked ?? 0),
        total: saved.total + (pending?.blocked ?? 0),
        popupsToday: saved.popupsToday + (pending?.popups ?? 0),
      },
      safeBrowsing: { enabled: settings.safeBrowsingEnabled, keySet: this.secrets.has(SAFE_BROWSING_SECRET), secureStorage: await this.secrets.isAvailable() },
    };
  }

  // ------------------------------------------------------------------ counters ---------------

  private count(runtime: ProfileRuntime, kind: "blocked" | "popups"): void {
    let c = this.counters.get(runtime.info.id);
    if (!c) this.counters.set(runtime.info.id, (c = { runtime, blocked: 0, popups: 0 }));
    c[kind]++;
  }

  noteBlockedPopup(runtime: ProfileRuntime): void {
    this.count(runtime, "popups");
  }

  async flushCounters(): Promise<void> {
    for (const [id, c] of this.counters) {
      const { blocked, popups } = c;
      if (blocked === 0 && popups === 0) continue;
      c.blocked = 0;
      c.popups = 0;
      try {
        await c.runtime.shieldData.addStats(blocked, popups);
      } catch {
        c.blocked += blocked; // keep for the next flush
        c.popups += popups;
      }
      this.counters.set(id, c);
    }
  }

  // ------------------------------------------------------------------ sessions ---------------

  private customEngine(profile: ProfileRuntime): FiltersEngine | null {
    const text = profile.settings.peek().customRules;
    const cached = this.customCache.get(profile.info.id);
    if (cached && cached.text === text) return cached.engine;
    let engine: FiltersEngine | null = null;
    try {
      engine = parseCustomRules(text);
    } catch {
      engine = null; // invalid custom rules never break browsing
    }
    this.customCache.set(profile.info.id, { text, engine });
    return engine;
  }

  allowUnsafe(url: string): void {
    this.unsafeBypass.set(url, Date.now() + UNSAFE_BYPASS_MS);
  }

  private isUnsafeAllowed(url: string): boolean {
    const until = this.unsafeBypass.get(url);
    if (!until) return false;
    if (until < Date.now()) {
      this.unsafeBypass.delete(url);
      return false;
    }
    return true;
  }

  /** Installs request filtering and the element-hiding preload on a browsing session. */
  attachSession(ses: Session, profile: ProfileRuntime): void {
    ses.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (details, callback) => {
      const wc = details.webContentsId ? webContents.fromId(details.webContentsId) : null;
      const found = wc ? findTabByWebContents(wc) : null;
      if (!wc || !found) return callback({});
      const settings = profile.settings.peek();

      if (details.resourceType === "mainFrame") {
        if (!settings.safeBrowsingEnabled || this.isUnsafeAllowed(details.url)) return callback({});
        void this.safeBrowsing
          .check(details.url)
          .then((threats) => {
            if (threats) {
              found.ctx.tabs.flagThreat(found.tabId, details.url, threats);
              callback({ cancel: true });
            } else callback({});
          })
          .catch(() => callback({}));
        return;
      }

      if (!settings.shieldEnabled || !this.engine) return callback({});
      const pageUrl = wc.getURL();
      let pageHost = "";
      try {
        pageHost = new URL(pageUrl).hostname;
      } catch {
        /* no page yet */
      }
      if (pageHost && profile.shieldData.isException(pageHost)) return callback({});

      const result = decide(this.engine, this.customEngine(profile), { url: details.url, pageUrl: pageUrl || details.url, type: details.resourceType, id: details.id, tabId: details.webContentsId ?? 0 });
      if (result.action === "allow") return callback({});
      this.count(profile, "blocked");
      found.ctx.tabs.noteBlocked(found.tabId);
      if (result.action === "redirect") return callback({ redirectURL: result.url });
      callback({ cancel: true });
    });

    const preload = PRELOAD_PATH();
    if (fs.existsSync(preload)) ses.registerPreloadScript({ type: "frame", filePath: preload });
  }

  /** Cosmetic filtering: the preload in each page asks us which elements to hide and which scriptlets to run. */
  private registerCosmeticIpc(): void {
    ipcMain.handle("@ghostery/adblocker/is-mutation-observer-enabled", (event) => !!findTabByWebContents(event.sender));
    ipcMain.handle("@ghostery/adblocker/inject-cosmetic-filters", (event, url: unknown, msg?: { classes?: string[]; hrefs?: string[]; ids?: string[]; lifecycle?: "start" | "dom-update" }) => {
      if (typeof url !== "string") return;
      const found = findTabByWebContents(event.sender);
      if (!found || !this.engine) return; // only real browsing tabs, never the SIDB UI
      const profile = found.ctx.profile;
      if (!profile.settings.peek().shieldEnabled) return;
      const { hostname, domain } = hostInfo(url);
      if (!hostname) return;
      let pageHost = hostname;
      try {
        pageHost = new URL(event.sender.getURL()).hostname || hostname;
      } catch {
        /* keep frame host */
      }
      if (profile.shieldData.isException(pageHost)) return;

      const query: CosmeticQuery = {
        url,
        hostname,
        domain,
        classes: msg?.classes,
        hrefs: msg?.hrefs,
        ids: msg?.ids,
        first: msg === undefined,
        frameId: event.frameId,
        processId: event.processId,
        lifecycle: msg?.lifecycle,
      };
      const { styles, scripts } = cosmeticsFor(this.engine, this.customEngine(profile), query);
      if (styles) void event.sender.insertCSS(styles, { cssOrigin: "user" }).catch(() => undefined);
      for (const script of scripts) void event.senderFrame?.executeJavaScript(script, true).catch(() => undefined);
    });
  }

  /** For tests and diagnostics. */
  engineInfo(): { ready: boolean; network: number; cosmetic: number } {
    const s = engineStats(this.engine);
    return { ready: this.engine !== null, network: s.network, cosmetic: s.cosmetic };
  }
}
