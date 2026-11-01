/**
 * Static security audit: scans the source for patterns that would weaken the Electron security baseline.
 * These are regression guards, not proof of safety. A failure means "look at this before shipping".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_METHODS } from "../../shared/ipc/dataApi";
import { IPC } from "../../shared/ipc/channels";

const ROOT = path.resolve(__dirname, "../..");

function files(dir: string, exts = [".ts", ".tsx"]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, exts));
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

const SOURCES = ["electron", "src", "shared"].flatMap((d) => files(path.join(ROOT, d)));
const read = (p: string) => readFileSync(p, "utf8");
const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, "/");
/** Source with line and block comments removed, so explanations in comments don't trigger matches. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

function offenders(pattern: RegExp, allow: string[] = []): string[] {
  return SOURCES.filter((f) => !allow.includes(rel(f)) && pattern.test(code(f))).map(rel);
}

describe("security audit: webPreferences", () => {
  it("never weakens isolation, sandboxing or web security", () => {
    expect(offenders(/nodeIntegration\s*:\s*true/)).toEqual([]);
    expect(offenders(/nodeIntegrationIn(SubFrames|Worker)\s*:\s*true/)).toEqual([]);
    expect(offenders(/contextIsolation\s*:\s*false/)).toEqual([]);
    expect(offenders(/sandbox\s*:\s*false/)).toEqual([]);
    expect(offenders(/webSecurity\s*:\s*false/)).toEqual([]);
    expect(offenders(/allowRunningInsecureContent\s*:\s*true/)).toEqual([]);
    expect(offenders(/webviewTag\s*:\s*true/)).toEqual([]);
    expect(offenders(/experimentalFeatures\s*:\s*true|enableBlinkFeatures/)).toEqual([]);
  });

  it("every window and view sets the full secure baseline explicitly", () => {
    let seen = 0;
    for (const f of SOURCES) {
      const src = code(f);
      for (const m of src.matchAll(/new (BrowserWindow|WebContentsView)\(\{/g)) {
        seen++;
        const block = src.slice(m.index, m.index + 1500);
        for (const key of ["sandbox: true", "contextIsolation: true", "nodeIntegration: false", "webSecurity: true"]) {
          expect(block, `${rel(f)}: ${m[1]} is missing "${key}"`).toContain(key);
        }
      }
    }
    expect(seen).toBeGreaterThanOrEqual(2); // the UI window and the tab view; guards against a scan that finds nothing
  });

  it("the scanner sees the source tree and strips comments", () => {
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(code(path.join(ROOT, "electron/main/ipc/register.ts"))).toContain("ipcMain.handle(");
    expect("x // eval(1)".replace(/(^|[^:"'`])\/\/.*$/gm, "$1").trim()).toBe("x");
    expect(/nodeIntegration\s*:\s*true/.test("webPreferences: { nodeIntegration: true }")).toBe(true);
  });

  it("nothing turns off Electron's security warnings", () => {
    expect(offenders(/ELECTRON_DISABLE_SECURITY_WARNINGS/)).toEqual([]);
  });
});

describe("security audit: code execution and HTML injection", () => {
  it("has no eval, new Function, innerHTML or document.write", () => {
    expect(offenders(/\beval\s*\(|new Function\s*\(/)).toEqual([]);
    expect(offenders(/dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/)).toEqual([]);
  });

  it("the UI CSP blocks remote scripts, eval and remote images", () => {
    const cfg = read(path.join(ROOT, "vite.config.ts"));
    const csp = /"Content-Security-Policy"[\s\S]*?content:\s*"([^"]+)"/.exec(cfg)?.[1] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    const img = /img-src ([^;]+)/.exec(csp)?.[1] ?? "";
    expect(img).not.toMatch(/https?:|\*/);
  });
});

describe("security audit: IPC surface", () => {
  it("only the IPC registration files talk to ipcMain", () => {
    expect(offenders(/\bipcMain\b/, ["electron/main/ipc/register.ts", "electron/main/ipc/dataHandlers.ts", "electron/main/shield/ShieldService.ts"])).toEqual([]);
  });

  it("every UI IPC handler checks the sender", () => {
    for (const f of ["electron/main/ipc/register.ts", "electron/main/ipc/dataHandlers.ts"]) {
      const src = code(path.join(ROOT, f));
      for (const m of src.matchAll(/ipcMain\.(handle|on)\(/g)) {
        expect(src.slice(m.index, m.index + 300), `${f}: an ipcMain handler without trustedContext`).toContain("trustedContext(event)");
      }
    }
  });

  it("Shield's page IPC only answers our own tabs", () => {
    const src = code(path.join(ROOT, "electron/main/shield/ShieldService.ts"));
    for (const m of src.matchAll(/ipcMain\.handle\(/g)) {
      expect(src.slice(m.index, m.index + 400)).toContain("findTabByWebContents(event.sender)");
    }
  });

  it("the preload never hands raw ipcRenderer to the page", () => {
    const src = code(path.join(ROOT, "electron/preload/index.ts"));
    expect(src).toMatch(/contextBridge\.exposeInMainWorld\(\s*"sidb"/);
    expect(src).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer\s*[,)]/);
    // Every channel is a fixed constant, so the page can never pick which channel to use.
    for (const m of src.matchAll(/ipcRenderer\.(invoke|send)\(\s*([^,)]+)/g)) expect(m[2].trim()).toMatch(/^IPC\.\w+$/);
    for (const m of src.matchAll(/\bsubscribe\(\s*([^,)]+)/g)) {
      if (m[1].includes(":")) continue; // the helper's own declaration
      expect(m[1].trim()).toMatch(/^IPC\.ev\w+$/);
    }
  });

  it("every renderer-to-main channel has a handler", () => {
    const register = code(path.join(ROOT, "electron/main/ipc/register.ts")) + code(path.join(ROOT, "electron/main/ipc/dataHandlers.ts"));
    const missing = Object.entries(IPC)
      .filter(([key]) => !key.startsWith("ev"))
      .filter(([key]) => !register.includes(`IPC.${key}`))
      .map(([, ch]) => ch);
    expect(missing).toEqual([]);
  });

  it("every data method has a validated handler and nothing else is accepted", () => {
    const src = code(path.join(ROOT, "electron/main/ipc/dataHandlers.ts"));
    const missing = DATA_METHODS.filter((m) => !new RegExp(`"${m.replace(".", "\\.")}"\\s*:\\s*\\{\\s*schema`).test(src));
    expect(missing).toEqual([]);
    expect(new Set(DATA_METHODS).size).toBe(DATA_METHODS.length);
  });
});

describe("security audit: navigation and external links", () => {
  it("shell.openExternal is only called with a URL checked by isSafeWebUrl", () => {
    let seen = 0;
    for (const f of SOURCES) {
      const lines = code(f).split("\n");
      lines.forEach((line, i) => {
        if (!/shell\.openExternal\s*\(/.test(line)) return; // calls only (the dev harness replaces it with a stub)
        seen++;
        const context = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
        expect(context, `${rel(f)}:${i + 1} openExternal without isSafeWebUrl`).toContain("isSafeWebUrl(");
      });
    }
    expect(seen).toBeGreaterThanOrEqual(1);
  });

  it("the UI window refuses to navigate or redirect away from the SIDB UI", () => {
    const src = code(path.join(ROOT, "electron/main/windows/mainWindow.ts"));
    expect(src).toMatch(/"will-navigate"[\s\S]{0,80}isUiUrl\(url\)/);
    expect(src).toMatch(/"will-redirect"[\s\S]{0,80}isUiUrl\(url\)/);
  });

  it("app-wide hardening is installed and covers webviews and devices", () => {
    expect(code(path.join(ROOT, "electron/main/index.ts"))).toContain("installHardening()");
    const h = code(path.join(ROOT, "electron/main/security/hardening.ts"));
    for (const s of ["web-contents-created", "session-created", "will-attach-webview", "setDevicePermissionHandler", "select-bluetooth-device", "select-hid-device", "select-serial-port", "select-usb-device"]) {
      expect(h).toContain(s);
    }
  });

  it("developer tools never run in a packaged app", () => {
    const idx = code(path.join(ROOT, "electron/main/index.ts"));
    for (const m of idx.matchAll(/import\("\.\/dev\//g)) {
      expect(idx.slice(Math.max(0, m.index - 200), m.index)).toContain("!app.isPackaged");
    }
  });
});
