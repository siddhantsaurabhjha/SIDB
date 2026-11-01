/**
 * Developer-only performance harness. Runs only when `!app.isPackaged && SIDB_PERF_OUT` (see index.ts).
 * Pages come from a local HTTP server so results do not depend on the internet.
 * Writes JSON to SIDB_PERF_OUT, then quits. Run with `npm run build && npm run perf`.
 */
import { app, BrowserWindow, webContents } from "electron";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { peekAi } from "../ai/instance";
import { getMarks } from "../perf/marks";
import { processMetrics, systemMemory } from "../perf/metrics";
import { getShield } from "../shield/instance";
import { contextOf, type WindowContext } from "../windows/registry";
import { createMainWindow } from "../windows/mainWindow";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rounded = (n: number) => Math.round(n * 10) / 10;
const heapMB = () => rounded(process.memoryUsage().heapUsed / 1048576);

/** A page with some real work in it (DOM, text, canvas), so a tab costs a realistic amount. */
function pageHtml(n: number): string {
  const rows = Array.from({ length: 400 }, (_, i) => `<li>Item ${i} of page ${n} lorem ipsum dolor sit amet</li>`).join("");
  return `<!doctype html><title>Perf ${n}</title><body><h1>Page ${n}</h1><ul>${rows}</ul><canvas id=c width=400 height=300></canvas>
<script>const g=document.getElementById('c').getContext('2d');for(let i=0;i<200;i++){g.fillStyle='hsl('+i*7+',70%,50%)';g.fillRect(i*2,i,40,40)}</script></body>`;
}

async function nextUiFrame(ctx: WindowContext): Promise<void> {
  await ctx.win.webContents.executeJavaScript("new Promise(r => requestAnimationFrame(() => r(0)))");
}

function snapshot() {
  (globalThis as { gc?: () => void }).gc?.();
  return { heapMB: heapMB(), webContents: webContents.getAllWebContents().length, metrics: processMetrics() };
}

export async function runPerf(): Promise<void> {
  const out = process.env.SIDB_PERF_OUT as string;
  const result: Record<string, unknown> = {};

  // Problems that should never happen: crashed child processes, main-process exceptions, event-loop stalls.
  const gone: Array<{ type: string; reason: string }> = [];
  app.on("child-process-gone", (_e, d) => gone.push({ type: d.type, reason: d.reason }));
  const uncaught: string[] = [];
  // Recorded instead of letting Electron show its blocking error dialog.
  process.on("uncaughtException", (e) => uncaught.push(String(e instanceof Error ? e.stack : e).slice(0, 600)));
  let phase = "start";
  const stalls: Array<{ phase: string; lagMs: number }> = [];
  let last = performance.now();
  const lagTimer = setInterval(() => {
    const now = performance.now();
    const lag = now - last - 100;
    if (lag > 250) stalls.push({ phase, lagMs: Math.round(lag) });
    last = now;
  }, 100);

  const server = createServer((req, res) => {
    if (req.url === "/favicon.ico") {
      res.writeHead(404);
      return res.end();
    }
    const n = Number(/\d+/.exec(req.url ?? "")?.[0] ?? 0);
    res.writeHead(200, { "content-type": "text/html" });
    res.end(pageHtml(n));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const win = BrowserWindow.getAllWindows()[0];
    const ctx = win && contextOf(win);
    if (!ctx) throw new Error("no main window context");
    win.setAlwaysOnTop(true); // hidden windows throttle rendering, which would skew the numbers

    // The UI must still pass the IPC sender check, and must not hit CSP violations.
    const cspViolations: string[] = [];
    win.webContents.on("console-message", (e) => {
      if (/Content Security Policy|Refused to/i.test(e.message)) cspViolations.push(e.message.slice(0, 300));
    });
    result.cspViolations = cspViolations;
    result.uiIpcWorks = await win.webContents.executeJavaScript("window.sidb.tabs.list().then(s => Array.isArray(s.tabs)).catch(() => false)");

    result.startupMarks = getMarks();
    result.aiInstantiatedAtStartup = peekAi() !== null;
    result.shieldEngine = getShield().engineInfo();
    result.systemMemory = systemMemory();

    phase = "baseline";
    await sleep(4000);
    result.baseline = processMetrics();

    phase = "open-tabs";
    const ids: string[] = [];
    for (const [count, key] of [[1, "tabs1"], [5, "tabs5"], [10, "tabs10"]] as const) {
      while (ids.length < count) ids.push(ctx.tabs.create(`${base}/${ids.length + 1}`, false));
      await sleep(4000);
      result[key] = processMetrics();
    }

    // Tab switch: from activate() until the UI has painted its next frame.
    phase = "tab-switch";
    // A window that is minimised or covered stops painting, so a sample that takes over 2 s is
    // counted as a timeout (an environment problem) instead of being mixed into the numbers.
    const times: number[] = [];
    let timeouts = 0;
    for (let r = 0; r < 3; r++) {
      for (const id of ids) {
        const t0 = performance.now();
        ctx.tabs.activate(id);
        const painted = await Promise.race([nextUiFrame(ctx).then(() => true), sleep(2000).then(() => false)]);
        if (painted) times.push(performance.now() - t0);
        else timeouts++;
      }
    }
    times.sort((a, b) => a - b);
    result.tabSwitchMs = {
      n: times.length,
      timeouts,
      median: rounded(times[Math.floor(times.length / 2)]),
      p95: rounded(times[Math.floor(times.length * 0.95)]),
      max: rounded(times[times.length - 1]),
    };

    phase = "idle";
    processMetrics(); // CPU % is measured since the previous call
    await sleep(5000);
    result.idle10Tabs = processMetrics();

    // Tab sleeping (user action), driven through the UI's own IPC bridge.
    phase = "sleep";
    {
      const histTab = ids[2];
      const wcOf = (id: string) => {
        const pid = ctx.tabs.resourceTabs().find((t) => t.id === id);
        return pid ? webContents.getAllWebContents().find((w) => ctx.tabs.tabIdFor(w) === id) : undefined;
      };
      // Give one tab a back/forward history and a scroll position.
      ctx.tabs.activate(histTab); // hidden views have no size, so they can't scroll
      ctx.tabs.navigate(histTab, `${base}/99`);
      await sleep(1500);
      await wcOf(histTab)?.executeJavaScript("window.scrollTo(0, 1200)");
      result.scrollYBeforeSleep = await wcOf(histTab)?.executeJavaScript("window.scrollY");
      await sleep(3000); // Chromium commits page state (scroll) periodically
      const entriesBefore = wcOf(histTab)?.navigationHistory.getAllEntries() ?? [];
      result.pageStateBeforeSleep = entriesBefore.map((e) => ({ url: e.url.slice(-4), pageStateChars: e.pageState?.length ?? 0 }));
      ctx.tabs.setPinned(ids[3], true);
      ctx.tabs.activate(ids[0]);
      await sleep(500);
      const before = processMetrics();
      const ui = (js: string) => win.webContents.executeJavaScript(js);
      const statsBefore = await ui("window.sidb.data.resources.stats()");
      const slept: number = await ui("window.sidb.data.resources.sleepBackground()");
      await sleep(3000);
      const after = processMetrics();
      const snap = ctx.tabs.snapshot();
      ctx.tabs.activate(histTab);
      await sleep(2500);
      const woke = wcOf(histTab);
      result.sleep = {
        statsTabsListed: statsBefore.tabs.length,
        slept,
        pinnedStayedAwake: !snap.tabs.find((t) => t.id === ids[3])?.sleeping,
        activeStayedAwake: !snap.tabs.find((t) => t.id === ids[0])?.sleeping,
        privateMBBefore: before.totalPrivateMB,
        privateMBAfter: after.totalPrivateMB,
        tabProcessesBefore: before.byType.Tab?.count ?? 0,
        tabProcessesAfter: after.byType.Tab?.count ?? 0,
        wokeUrl: woke?.getURL(),
        wokeCanGoBack: woke?.navigationHistory.canGoBack(),
        wokeScrollY: await woke?.executeJavaScript("window.scrollY"),
        wokeSleepingFlag: ctx.tabs.snapshot().tabs.find((t) => t.id === histTab)?.sleeping,
      };
      ctx.tabs.setPinned(ids[3], false);
    }

    // Leak check: 30 tab open/close cycles, then 10 private window open/close cycles.
    phase = "tab-churn";
    for (const id of ids) ctx.tabs.close(id);
    await sleep(2500);
    const before = snapshot();
    for (let i = 0; i < 30; i++) {
      const id = ctx.tabs.create(`${base}/${i}`, false);
      await sleep(150);
      ctx.tabs.close(id);
    }
    await sleep(2500);
    const afterTabs = snapshot();

    phase = "private-windows";
    const openMs: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      const pw = await createMainWindow({ isPrivate: true });
      openMs.push(Math.round(performance.now() - t0));
      await sleep(600);
      pw.close(); // the same path as the user clicking X
      await sleep(300);
    }
    await sleep(3000);
    const afterPrivate = snapshot();
    result.privateWindowOpenMs = openMs;
    result.leak = { gcAvailable: typeof (globalThis as { gc?: unknown }).gc === "function", before, afterTabs, afterPrivate };

    // Online check (best effort, last so it can't skew the numbers): real sites' icons must reach the
    // tab strip as data: images under the strict UI CSP.
    phase = "favicons";
    const real = ["https://github.com/", "https://www.wikipedia.org/"].map((u) => ctx.tabs.create(u, false));
    await sleep(8000);
    result.tabStripIcons = await win.webContents.executeJavaScript(`[...document.querySelectorAll('[role="tab"] img')].map(i => i.src.slice(0, 22))`);
    for (const id of real) ctx.tabs.close(id);
  } catch (e) {
    result.error = String(e instanceof Error ? e.stack : e);
  } finally {
    clearInterval(lagTimer);
    result.childProcessGone = gone;
    result.uncaughtExceptions = uncaught;
    result.eventLoopStalls = stalls;
    writeFileSync(out, JSON.stringify(result, null, 2));
    server.close();
    app.exit(0);
  }
}
