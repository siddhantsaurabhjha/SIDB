// Developer tool: runs the built app with the perf harness (electron/main/dev/perf.ts) and prints a summary.
// Usage: npm run build && npm run perf        (add --json for the full result)
// The test profile lives in %TEMP%/sidb-perf-profile and is reused, so filter lists downloaded on the
// first run are measured on later runs (closer to real use). Pass --fresh to start from an empty profile.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const electron = require("electron");
const profileDir = join(tmpdir(), "sidb-perf-profile");
if (process.argv.includes("--fresh")) rmSync(profileDir, { recursive: true, force: true });
const dir = mkdtempSync(join(tmpdir(), "sidb-perf-"));
const out = join(dir, "result.json");

const res = spawnSync(electron, [".", `--user-data-dir=${profileDir}`, "--js-flags=--expose-gc"], {
  env: { ...process.env, SIDB_PERF_OUT: out },
  stdio: "inherit",
  timeout: 240_000,
});

if (!existsSync(out)) {
  console.error(`perf run produced no result (exit ${res.status})`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}
const r = JSON.parse(readFileSync(out, "utf8"));
rmSync(dir, { recursive: true, force: true });

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(r, null, 2));
} else {
  const mem = (m) => (m ? `${m.totalPrivateMB} MB private (${Object.entries(m.byType).map(([k, g]) => `${k} x${g.count} ${g.privateMB}`).join(", ")})` : "n/a");
  const cpu = (m) => (m ? Object.values(m.byType).reduce((s, g) => s + g.cpuPercent, 0).toFixed(1) + "%" : "n/a");
  const leakRow = (s) => `heap ${s.heapMB} MB, ${s.webContents} webContents, ${s.metrics.totalPrivateMB} MB private, ${s.metrics.byType.Tab?.count ?? 0} tab processes`;
  console.log("\nSIDB perf summary");
  console.log("startup marks (ms since process start):", r.startupMarks.map((m) => `${m.name}=${m.atMs}`).join(" "));
  console.log("AI service created at startup:", r.aiInstantiatedAtStartup);
  console.log("Shield engine:", JSON.stringify(r.shieldEngine));
  console.log("baseline:", mem(r.baseline));
  console.log("1 tab:   ", mem(r.tabs1));
  console.log("5 tabs:  ", mem(r.tabs5));
  console.log("10 tabs: ", mem(r.tabs10));
  console.log("tab switch ms:", JSON.stringify(r.tabSwitchMs));
  console.log("idle CPU with 10 tabs (sum of processes):", cpu(r.idle10Tabs));
  console.log("sleep background tabs:", JSON.stringify(r.sleep), "page state:", JSON.stringify(r.pageStateBeforeSleep), "scrollY before:", r.scrollYBeforeSleep);
  if (r.leak) {
    console.log("leak before:        ", leakRow(r.leak.before));
    console.log("after 30 tabs:      ", leakRow(r.leak.afterTabs));
    console.log("after 10 private:   ", leakRow(r.leak.afterPrivate));
  }
  console.log("private window open ms:", (r.privateWindowOpenMs ?? []).join(", "));
  console.log("UI passes IPC sender check:", r.uiIpcWorks);
  console.log("tab strip icons (online check):", JSON.stringify(r.tabStripIcons));
  console.log("CSP violations in the UI:", r.cspViolations?.length ?? "n/a", r.cspViolations?.length ? r.cspViolations : "");
  console.log("event-loop stalls >250ms:", JSON.stringify(r.eventLoopStalls));
  console.log("uncaught exceptions:", r.uncaughtExceptions.length, r.uncaughtExceptions.length ? r.uncaughtExceptions : "");
  console.log("crashed child processes:", JSON.stringify(r.childProcessGone));
  if (r.error) console.log("ERROR:", r.error);
}
const bad = r.error || r.uncaughtExceptions.length > 0 || r.childProcessGone.length > 0 || r.uiIpcWorks !== true || r.cspViolations?.length > 0;
process.exit(bad ? 1 : 0);
