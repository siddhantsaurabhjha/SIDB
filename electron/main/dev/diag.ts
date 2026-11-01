/**
 * Developer-only browser-identity and Google compatibility checks. Runs only when `!app.isPackaged && SIDB_DIAG_OUT`
 * (see index.ts). It only observes and drives SIDB like a user would; it never changes how SIDB identifies itself.
 *
 *  - identity: request headers and navigator facts on a local echo page (and in real Chrome if SIDB_DIAG_CHROME is set)
 *  - sites: Google, YouTube, Gmail, Drive and unrelated sites load
 *  - sign-in: Google account sign-in and a third-party OAuth sign-in with a made-up address (SIDB_DIAG_EMAIL),
 *    expecting Google's rejection page, SIDB's notice, and the default-browser handoff (stubbed: nothing is opened)
 *  - after: normal browsing in the same tab clears the notice
 *  - private: a private window's Google cookies never reach the profile, and are wiped when it closes
 */
import { app, BrowserWindow, shell, webContents, type Session, type WebContents } from "electron";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { contextOf, type WindowContext } from "../windows/registry";
import { createMainWindow } from "../windows/mainWindow";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const PROBE = `
(async () => {
  const n = navigator;
  const out = {
    userAgent: n.userAgent, platform: n.platform, vendor: n.vendor, languages: n.languages, webdriver: n.webdriver,
    plugins: [...n.plugins].map(p => p.name).length,
    brands: n.userAgentData ? n.userAgentData.brands : null,
    fullVersionList: n.userAgentData ? (await n.userAgentData.getHighEntropyValues(["fullVersionList"])).fullVersionList : null,
    windowChrome: typeof window.chrome === "object" ? Object.keys(window.chrome).sort() : null,
  };
  await fetch("/report", { method: "POST", body: JSON.stringify(out) });
  await fetch("/second");
})();`;

/** OAuth 2.0 authorization request of Google's public OAuth Playground client, used as "a third-party site". */
const OAUTH_URL =
  "https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fdevelopers.google.com%2Foauthplayground&prompt=consent&response_type=code&client_id=407408718192.apps.googleusercontent.com&scope=email&access_type=offline";

function tabContents(ctx: WindowContext, id: string): WebContents | undefined {
  return webContents.getAllWebContents().find((w) => ctx.tabs.tabIdFor(w) === id);
}

async function googleCookies(ses: Session): Promise<string[]> {
  const all = await ses.cookies.get({});
  return all.filter((c) => /(^|\.)google\.com$|(^|\.)youtube\.com$/.test(c.domain ?? "")).map((c) => `${c.domain} ${c.name}`).sort();
}

export async function runDiag(): Promise<void> {
  const out = process.env.SIDB_DIAG_OUT as string;
  const email = process.env.SIDB_DIAG_EMAIL ?? "";
  const result: Record<string, unknown> = {};
  const reports: Array<{ ua: string; data: unknown }> = [];
  const headerLog: Array<{ ua: string; path: string; headers: Record<string, string | string[] | undefined> }> = [];

  const server = createServer((req, res) => {
    const ua = String(req.headers["user-agent"] ?? "");
    headerLog.push({ ua, path: req.url ?? "", headers: req.headers });
    if (req.url === "/report") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          reports.push({ ua, data: JSON.parse(body) });
        } catch {
          /* ignore */
        }
        res.end("ok");
      });
      return;
    }
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html", "accept-ch": "Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version, Sec-CH-UA-Arch, Sec-CH-UA-Bitness" });
      return res.end(`<!doctype html><title>probe</title><script>${PROBE}</script>`);
    }
    res.end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // The handoff must never open the developer's real browser during a test run.
  const opened: string[] = [];
  const realOpen = shell.openExternal;
  try {
    (shell as { openExternal: typeof shell.openExternal }).openExternal = async (url: string) => {
      opened.push(url);
    };
    result.openExternalStubbed = shell.openExternal !== realOpen;
  } catch (e) {
    result.openExternalStubbed = false;
    result.stubError = String(e);
  }

  try {
    const win = BrowserWindow.getAllWindows()[0];
    const ctx = win && contextOf(win);
    if (!ctx) throw new Error("no window");
    win.setAlwaysOnTop(true);
    const ses = ctx.profile.session;
    const ui = <T>(js: string): Promise<T> => win.webContents.executeJavaScript(js);
    result.identity = { electron: process.versions.electron, chromium: process.versions.chrome, userAgent: ses.getUserAgent() };

    // ---- identity on the echo page (twice, so a second load would carry hints granted by Accept-CH)
    const probe = ctx.tabs.create(`${base}/`, true);
    await sleep(2500);
    ctx.tabs.navigate(probe, `${base}/`);
    await sleep(2500);
    ctx.tabs.close(probe);
    const chrome = process.env.SIDB_DIAG_CHROME;
    if (chrome) {
      const dir = mkdtempSync(path.join(tmpdir(), "sidb-diag-chrome-"));
      const p = spawn(chrome, [`--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", `${base}/`], { stdio: "ignore" });
      await sleep(7000);
      spawn("taskkill", ["/F", "/T", "/PID", String(p.pid)], { stdio: "ignore" });
      await sleep(1500);
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* Chrome may still hold files */
      }
    }

    // ---- sites load normally
    const sites: Record<string, unknown> = {};
    for (const url of ["https://www.google.com/", "https://www.youtube.com/", "https://mail.google.com/", "https://drive.google.com/", "https://www.wikipedia.org/", "https://github.com/", "https://example.com/"]) {
      const id = ctx.tabs.create(url, true);
      await sleep(300);
      const wc = tabContents(ctx, id);
      let status = 0;
      const fails: string[] = [];
      wc?.on("did-navigate", (_e, _u, code) => (status = code));
      wc?.on("did-fail-load", (_e, code, desc, _u, main) => main && code !== -3 && fails.push(`${code} ${desc}`));
      await sleep(7000);
      const state = ctx.tabs.snapshot().tabs.find((t) => t.id === id);
      sites[url] = { finalUrl: wc?.getURL().slice(0, 120), status, title: wc?.getTitle().slice(0, 60), fails, notice: state?.notice ?? null, error: state?.error?.description ?? null };
      ctx.tabs.close(id);
    }
    result.sites = sites;

    // ---- sign-in flows with a made-up address
    const signin = async (startUrl: string) => {
      const id = ctx.tabs.create(startUrl, true);
      await sleep(200);
      const starts: string[] = [];
      tabContents(ctx, id)?.on("did-start-navigation", (d) => d.isMainFrame && starts.push(`${d.isSameDocument ? "same-doc" : "new-doc"} ${d.url}`));
      await sleep(6800);
      const wc = tabContents(ctx, id);
      const r: Record<string, unknown> = { afterLoad: wc?.getURL().slice(0, 140) };
      if (wc && email) {
        win.focus(); // typed text goes to the focused page only
        wc.focus();
        await wc.executeJavaScript("(document.querySelector('input[type=email]') || { focus() {} }).focus(), 0");
        await sleep(300);
        wc.insertText(email);
        await sleep(400);
        wc.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
        wc.sendInputEvent({ type: "char", keyCode: "\r" });
        wc.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
        await sleep(8000);
      }
      r.afterEmail = wc?.getURL();
      r.navigationStarts = starts;
      r.pageSays = (await wc?.executeJavaScript("document.title").catch(() => null)) ?? null;
      r.notice = ctx.tabs.snapshot().tabs.find((t) => t.id === id)?.notice ?? null;
      await sleep(300);
      r.uiStripShown = await ui<boolean>(`!!document.querySelector('[aria-label="Google sign-in is not available in SIDB"]')`);
      r.uiStripText = await ui<string | null>(`document.querySelector('[aria-label="Google sign-in is not available in SIDB"]')?.innerText ?? null`);
      const shot = await win.webContents.capturePage().catch(() => null);
      if (shot) writeFileSync(`${out.replace(/\.json$/, "")}-${new URL(startUrl).pathname.includes("oauth2") ? "oauth" : "account"}.png`, shot.toPNG());
      const before = opened.length;
      r.handoffResult = await ui<boolean>(`window.sidb.data.compat.continueSigninExternally({ id: ${JSON.stringify(id)} })`);
      r.handoffOpened = opened.slice(before).map((u) => u.slice(0, 160));
      return { id, r };
    };
    const account = await signin("https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmyaccount.google.com%2F");
    result.accountSignin = account.r;
    ctx.tabs.close(account.id);
    const oauth = await signin(OAUTH_URL);
    result.thirdPartyOAuth = oauth.r;

    // ---- normal browsing in the same tab afterwards
    ctx.tabs.navigate(oauth.id, "https://www.wikipedia.org/");
    await sleep(6000);
    const after = ctx.tabs.snapshot().tabs.find((t) => t.id === oauth.id);
    result.afterwards = { url: after?.url, title: after?.title, notice: after?.notice ?? null, uiStripShown: await ui<boolean>(`!!document.querySelector('[aria-label="Google sign-in is not available in SIDB"]')`) };
    result.handoffWithoutNotice = await ui<boolean>(`window.sidb.data.compat.continueSigninExternally({ id: ${JSON.stringify(oauth.id)} })`);
    ctx.tabs.close(oauth.id);

    // ---- private window isolation
    const profileBefore = await googleCookies(ses);
    const pw = await createMainWindow({ isPrivate: true });
    await sleep(1500);
    const pctx = contextOf(pw);
    if (!pctx) throw new Error("no private window context");
    const pses = pctx.tabs.activeWebContents()?.session ?? null;
    const ptab = pctx.tabs.create("https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmyaccount.google.com%2F", true);
    await sleep(7000);
    const pwc = tabContents(pctx, ptab);
    const privateSession = pwc?.session ?? pses;
    const privateCookies = privateSession ? await googleCookies(privateSession) : [];
    const profileDuring = await googleCookies(ses);
    pw.close();
    await sleep(3000);
    const privateAfterClose = privateSession ? await googleCookies(privateSession) : [];
    result.privateIsolation = {
      separateSession: !!privateSession && privateSession !== ses,
      privateGoogleCookies: privateCookies.length,
      profileGoogleCookiesBefore: profileBefore.length,
      profileGoogleCookiesDuring: profileDuring.length,
      profileUnchanged: JSON.stringify(profileBefore) === JSON.stringify(profileDuring),
      privateCookiesAfterClose: privateAfterClose.length,
      privateCookiesAfterCloseNames: privateAfterClose,
    };
  } catch (e) {
    result.error = String(e instanceof Error ? e.stack : e);
  } finally {
    result.identityReports = reports.map((r) => r.data);
    result.echoHeaders = headerLog
      .filter((h) => h.path === "/" || h.path === "/second")
      .map((h) => ({ path: h.path, headers: Object.fromEntries(Object.entries(h.headers).filter(([k]) => /^(user-agent|sec-ch)/i.test(k))) }));
    writeFileSync(out, JSON.stringify(result, null, 2));
    server.close();
    app.exit(0);
  }
}
