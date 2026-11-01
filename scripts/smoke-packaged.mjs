// Smoke test of the *packaged* app (out/SIDB-<platform>-<arch>, or a path given as the first argument).
// Usage: npm run package && npm run smoke:packaged
// It starts SIDB with a throwaway --user-data-dir and remote debugging (allowed only with a separate data folder),
// drives the interface through its own window.sidb bridge, and checks the things packaging can break.
// It also checks that remote debugging is refused when no separate data folder is given.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const exe =
  process.argv[2] ??
  process.env.SIDB_SMOKE_EXE ??
  (process.platform === "win32" ? path.join(root, "out", "SIDB-win32-x64", "SIDB.exe") : path.join(root, "out", `SIDB-linux-${process.arch}`, "SIDB"));
if (!existsSync(exe)) {
  console.error(`packaged app not found: ${exe} (run npm run package)`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let current = "starting";
const step = (name) => {
  current = name;
  console.log(`... ${name}`);
};
// Watchdog: a hang becomes a clear failure instead of a stuck CI job.
const WATCHDOG_MS = 5 * 60_000;
setTimeout(() => {
  check(`smoke test finished within ${WATCHDOG_MS / 60_000} minutes`, false, `stuck at: ${current}`);
  if (appProcess) kill(appProcess);
  process.exit(1);
}, WATCHDOG_MS).unref();
let appProcess = null;
const ci = process.env.GITHUB_ACTIONS === "true";
const label = process.env.SIDB_SMOKE_LABEL ?? `${process.platform} packaged`;
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  const line = `${name}${detail ? `  (${detail})` : ""}`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${line}`);
  // On GitHub Actions each result becomes an annotation, visible on the run page.
  if (ci) console.log(`::${ok ? "notice" : "error"} title=${label} smoke::${ok ? "PASS" : "FAIL"} ${line.replace(/[\r\n%]/g, " ")}`);
};

async function targets(port) {
  try {
    return await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) })).json();
  } catch {
    return null;
  }
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onclose = () => {
    // The page went away (renderer crashed, window closed): fail the waiting calls at once instead of hanging.
    for (const resolve of pending.values()) resolve({ result: { exceptionDetails: { exception: { description: "DevTools connection closed (the page went away)" } } } });
    pending.clear();
  };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) events.push(msg);
  };
  const ready = Promise.race([
    new Promise((r, j) => {
      ws.onopen = r;
      ws.onerror = () => j(new Error("DevTools connection failed"));
    }),
    sleep(15_000).then(() => {
      throw new Error("DevTools connection timed out");
    }),
  ]);
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await Promise.race([
      send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
      sleep(60_000).then(() => {
        throw new Error(`no answer within 60 s: ${expression.slice(0, 80)}`);
      }),
    ]);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "evaluation failed");
    if (r.error) throw new Error(`DevTools error: ${r.error.message}`);
    return r.result?.result?.value;
  };
  return { ready, send, evaluate, events, close: () => ws.close() };
}

/** SIDB's own console output (last lines), printed when something fails. */
const appLog = [];
function launch(args, env = process.env) {
  const p = spawn(exe, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  const keep = (d) => {
    for (const line of String(d).split(/\r?\n/)) if (line.trim()) appLog.push(line.slice(0, 400));
    if (appLog.length > 60) appLog.splice(0, appLog.length - 60);
  };
  p.stdout.on("data", keep);
  p.stderr.on("data", keep);
  return p;
}

function kill(p) {
  if (process.platform === "win32") spawn("taskkill", ["/F", "/T", "/PID", String(p.pid)], { stdio: "ignore" });
  else p.kill("SIGKILL");
}

// Note: the refusal of remote debugging *without* --user-data-dir is not tested here on purpose. That case runs on the
// real profile folder (Windows finds it through the shell, not an environment variable), and a test must never touch
// it. The rule is unit tested (tests/unit/hardening.test.ts).

// ---------------------------------------------------------------- the app itself
const dataDir = mkdtempSync(path.join(tmpdir(), "sidb-smoke-"));
const port = 9800 + Math.floor(Math.random() * 150);
step("starting SIDB");
const app = launch([`--user-data-dir=${dataDir}`, `--remote-debugging-port=${port}`]);
appProcess = app;
let appExited = null;
app.on("exit", (code, signal) => (appExited = `exit code ${code}${signal ? `, signal ${signal}` : ""}`));
try {
  step("waiting for the interface");
  let ui = null;
  for (let i = 0; i < 40 && !ui; i++) {
    await sleep(500);
    ui = (await targets(port))?.find((t) => t.type === "page" && t.url.startsWith("sidb-app://")) ?? null;
  }
  check("interface loads from sidb-app://ui/", !!ui, ui?.url ?? (appExited ? `SIDB quit: ${appExited}` : "no interface page within 20 s"));
  if (!ui) throw new Error("no interface");
  const c = cdp(ui.webSocketDebuggerUrl);
  await c.ready;
  await sleep(1500);

  check("not loaded from file://", (await c.evaluate("location.protocol")) === "sidb-app:");
  const snap = await c.evaluate("window.sidb.tabs.list()");
  check("IPC works from the packaged interface", Array.isArray(snap?.tabs), `${snap?.tabs?.length} tab(s)`);
  const upd = await c.evaluate("window.sidb.data.updates.status()");
  check("update status reports an installed build", upd?.packaged === true, `version ${upd?.current}, repo ${upd?.repo ?? "not set"}`);
  const stats = await c.evaluate("window.sidb.data.resources.stats()");
  check("Performance panel data", typeof stats?.sidbMB === "number", `${stats?.sidbMB} MB, GPU on: ${stats?.gpu?.enabledNow}`);
  const settings = await c.evaluate("window.sidb.data.settings.get()");
  check("database opened and migrated", typeof settings?.theme === "string", `theme ${settings?.theme}`);
  const profiles = await c.evaluate("window.sidb.data.profiles.list()");
  const profileDir = path.join(dataDir, "profiles", profiles?.currentId ?? "?");
  check("profile data stays in the given folder", existsSync(path.join(profileDir, "sidb.db")), profileDir);

  // Database writes and reads (SQLite through node:sqlite inside the packaged app).
  const db = await c.evaluate(`(async () => {
    const d = window.sidb.data;
    const b = await d.bookmarks.add({ title: "SIDB smoke", url: "https://example.com/sidb-smoke" });
    const found = await d.bookmarks.findByUrl({ url: "https://example.com/sidb-smoke" });
    await d.bookmarks.remove({ id: b.id });
    const gone = await d.bookmarks.findByUrl({ url: "https://example.com/sidb-smoke" });
    const s = await d.settings.set({ patch: { newTabClock: false } });
    return { added: !!found && found.id === b.id, removed: gone === null, setting: s.newTabClock === false };
  })()`);
  check("database add, read, delete and settings write", db?.added && db?.removed && db?.setting, JSON.stringify(db));

  // Encrypted key storage (OS key store through Electron's async safeStorage). A dummy key in the throwaway profile.
  step("encrypted key storage");
  const keys = await c.evaluate(`(async () => {
    const ai = window.sidb.data.ai;
    await ai.setKey({ key: "smoke-test-dummy-key-0000" });
    const saved = await ai.status();
    await ai.clearKey();
    const cleared = await ai.status();
    return { secureStorage: saved.secureStorage, saved: saved.keySet, cleared: !cleared.keySet };
  })()`);
  check("API keys are saved encrypted and can be removed", keys?.secureStorage && keys?.saved && keys?.cleared, JSON.stringify(keys));

  // Filter lists download on first start; wait for the engine.
  step("waiting for the Shield engine");
  let shield = null;
  for (let i = 0; i < 90; i++) {
    shield = await c.evaluate("window.sidb.data.shield.status()");
    if (shield?.ready) break;
    await sleep(1000);
  }
  check("Shield engine built from downloaded lists (worker thread inside the archive)", !!shield?.ready, `${shield?.networkRules ?? 0} network, ${shield?.cosmeticRules ?? 0} cosmetic rules`);

  // A real page in a tab.
  step("loading a web page");
  await c.evaluate(`window.sidb.tabs.create({ url: "https://example.com/", activate: true })`);
  await sleep(5000);
  const page = (await targets(port)).find((t) => t.type === "page" && t.url.startsWith("https://example.com"));
  check("web page loads in a tab", !!page, page?.title);

  if (page) {
    // Cosmetic filtering needs the Shield preload, which is read from inside app.asar.
    const pc = cdp(page.webSocketDebuggerUrl);
    await pc.ready;
    await pc.evaluate(`(() => { for (const c of ["adsbygoogle", "ad-banner", "pub_300x250", "adsbox", "sponsored-ad", "ad-slot"]) { const d = document.createElement("div"); d.className = c; d.textContent = "ad"; d.style.height = "50px"; document.body.appendChild(d); } return 0; })()`);
    await sleep(2500);
    const hidden = await pc.evaluate(`[...document.querySelectorAll("body > div[class]")].filter(d => getComputedStyle(d).display === "none").map(d => d.className)`);
    check("Shield element hiding works (its preload loads from the archive)", Array.isArray(hidden) && hidden.length > 0, `hidden: ${hidden?.join(", ") || "none"}`);
    const ua = await pc.evaluate("navigator.userAgent");
    check("user agent has no Electron token", !/Electron|SIDB/.test(ua), ua);
    const isolation = await pc.evaluate("({ require: typeof require, process: typeof process, sidb: typeof window.sidb })");
    check("web page has no Node.js and no SIDB bridge (sandbox and isolation)", isolation?.require === "undefined" && isolation?.process === "undefined" && isolation?.sidb === "undefined", JSON.stringify(isolation));
    pc.close();
  }

  // Website icons: fetched from the site itself and cached as a file in the profile.
  step("website icons");
  const icon = await c.evaluate(`window.sidb.data.favicon.get({ url: "https://github.com/" })`);
  const iconDir = path.join(profileDir, "favicons");
  const iconFiles = existsSync(iconDir) ? readdirSync(iconDir).length : 0;
  check("website icon fetched and cached on disk", typeof icon === "string" && icon.startsWith("data:image/") && iconFiles > 0, `${icon ? icon.slice(0, 22) : "none"}, ${iconFiles} cache file(s)`);

  // Ads blocked on a real page (network filtering).
  step("blocking on a real page");
  await c.evaluate(`window.sidb.tabs.create({ url: "https://www.theguardian.com/international", activate: true })`);
  await sleep(10000);
  const tabs = (await c.evaluate("window.sidb.tabs.list()")).tabs;
  const g = tabs.find((t) => t.url.includes("theguardian.com"));
  check("Shield blocks requests on a real page", (g?.blocked ?? 0) > 0, `${g?.blocked ?? 0} blocked`);

  // Private window opens with the packaged interface too.
  step("private window");
  const before = (await targets(port)).filter((t) => t.url.startsWith("sidb-app://")).length;
  await c.evaluate("window.sidb.window.newPrivate()");
  await sleep(3000);
  const after = (await targets(port)).filter((t) => t.url.startsWith("sidb-app://")).length;
  check("private window opens", after === before + 1);
  c.close();
} catch (e) {
  check("smoke run finished without errors", false, `${String(e?.message ?? e)} during: ${current}${appExited ? `; SIDB quit: ${appExited}` : ""}`);
  const t = await targets(port);
  console.log("page targets now:", t ? t.map((x) => `${x.type} ${x.url.slice(0, 80)}`).join(" | ") : "DevTools not answering");
} finally {
  step("closing SIDB");
  kill(app);
  await sleep(2500);
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch {
    /* a file still held by a closing process; the folder is in the temp directory */
  }
}

const failed = results.filter((r) => !r.ok).length;
if (failed) {
  console.log("--- SIDB's last console lines:");
  for (const l of appLog.slice(-30)) console.log("  " + l);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
