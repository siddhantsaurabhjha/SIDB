# SIDB Project Progress Report

**Report date:** 1 November 2026 (updated after Phase 8)
**Project:** SIDB Desktop Browser, "A Browser Built Around You."
**Reference:** `SIDB_Master_Project_Blueprint_v1.md`

This report separates what was **verified by running it** from what is **written but not verified**, and lists what is **not started**.

---

## 1. Summary

| Phase | Scope (from blueprint) | Status |
|---|---|---|
| 0 | Repository, secure Electron foundation, build/test commands | Done |
| 1 | UI shell, tabs (horizontal and vertical), toolbar, sidebar, New Tab | Done, with gaps (see section 6) |
| 2 | Chromium integration (WebContentsView), navigation, find, zoom, permissions, popups, fullscreen | Done, with gaps |
| 3 | Profiles, SQLite/Drizzle, bookmarks, history, downloads, session restore, backups | Done |
| 4 | SIDB Shield: filtering, lists, exceptions, popups, Safe Browsing, DNS | Done, with gaps (see section 5) |
| 5 | AI assistant (one NVIDIA model) | Built and tested against a stand-in for NVIDIA's server; **not yet tried against the real service** (no API key available) |
| 6 | Customization and productivity (themes, wallpaper, command palette, QR, screenshot) | Done, except Picture-in-Picture, Reader mode and a shortcut editor (see sections 5 and 6) |
| 7 | Performance, security and regression review | Mostly done: measured, hardened, tab sleeping and GPU guard built, two real bugs fixed. A full offline regression run of every feature is not built yet (see section "Phase 7") |
| 8 | Packaging, installers, updates, release | Windows installer built and checked; Linux packages and GitHub release workflow written but **not run** (no Linux machine, no repository yet); manual update check built; README and user guide written. Needs the owner for the repository, installing on this PC, and the first release (see "Phase 8") |

Test status at the time of writing (all passing):

- `npm test`: 163 unit tests (update version rules and release checking, sidb-app:// file mapping, remote debugging guard, Google sign-in rejection detection and user agent format, security audit of the source, memory pressure, tab sleep and GPU crash rules, website icon parsing, safety and caching, URL handling, filter list validation, blocking engine, Safe Browsing logic with a mocked network, AI prompts, streaming and service, Markdown parsing, fuzzy search, tab group ordering, image type detection, address bar ranking and engine suggestion fetching).
- `npm run test:db`: 28 database tests (all services, backup and import, Shield data, AI chats, tab groups in saved sessions, appearance settings), run on Electron's bundled Node.
- `npm run build`: typecheck, renderer build and main/preload build succeed.
- `npm run perf`: developer performance run (see Phase 7). Last run: no exceptions, no crashes, no stalls, no CSP violations.
- `npm run smoke:packaged`: 13 checks on the real packaged app (see Phase 8). Last run: 13/13.

---

## 2. Technology in use

| Layer | Choice | Notes |
|---|---|---|
| Shell and engine | Electron 45.2.1 (Chromium, Node 24) | Pages use `WebContentsView`, no `<webview>` |
| UI | React 19, TypeScript 5.9, Vite 8, Tailwind 4, Zustand | |
| Database | SQLite through Node's built-in `node:sqlite`, Drizzle ORM 0.45 (sqlite-proxy driver), drizzle-kit migrations | See deviation D1 |
| Filtering | `@ghostery/adblocker` (MPL-2.0) engine, own Electron integration | See deviation D2 |
| Tests | Vitest 4 | DB tests run under Electron's Node |
| Packaging | Electron Forge 7.11.2, Squirrel.Windows, deb, rpm, zip, Electron fuses | Forge 8 needs Node 22.13+ |
| Not yet used | Playwright, Cloudflare Pages | Later |

Versions are pinned exactly in `package.json`. Vitest is on 4 and TypeScript on 5.9 because Vitest 5 needs Node 22 and the dev machine has Node 20.19.

---

## 3. What has been built

### Foundation and security (Phases 0 and 2)
- Window runs with `contextIsolation` on, `nodeIntegration` off, `sandbox` on. Web pages never receive the SIDB bridge.
- Renderer talks to the main process only through a small preload API. Every request is validated with Zod, and only the window's own UI frame is trusted.
- Packaged build uses a strict Content Security Policy. Pages can only navigate to http(s). The SIDB UI window can never navigate away.
- Permissions: camera, microphone, location, notifications, clipboard read, pointer lock and screen capture show an in-app prompt (allow once, allow on this site, block). Everything else is denied. Site choices are saved per profile.
- User agent is normalized (the "Electron" and app tokens are removed) so sites treat SIDB as a regular Chromium browser.

### Browser behavior (Phases 1 and 2)
- Tabs: create, close, switch, duplicate, pin, mute, reorder (in code), middle-click close. Horizontal and vertical layouts keep tab state.
- Navigation: address bar (URL or search), back, forward, reload, stop, home, secure/insecure indicator, error page with retry, crash page.
- Find in page, page zoom (keyboard and Ctrl+wheel), page fullscreen, right-click menus, popups open as tabs.
- Shortcuts that work even while a website has focus: Ctrl+T, W, L, F, R, B, Tab, Shift+Tab, 1 to 9, `+`, `-`, 0, F5, F11, Alt+Left/Right, Ctrl+Shift+N (private window), Ctrl+Shift+T (reopen tab).
- Private windows use a separate in-memory session that is wiped on close, write nothing to history or session data, and are labeled in the title bar.
- Screens built from the supplied designs and images: New Tab (dashboard background), Private Browsing page, Settings, Bookmarks, History, Downloads, Shield.

### Data and profiles (Phase 3)
- Each profile has its own folder with its database, its Chromium cookies and cache, and its backups. Only one profile ("Personal") exists by default; more can be added in Settings.
- Bookmarks: nested folders, favorites, pins, edit, search, import and export in the standard browser bookmark HTML format.
- History: grouped by day, search, delete one entry or a range, weekly activity chart, top sites, recently closed tabs.
- Downloads: progress, pause, resume, cancel, retry, open, show in folder, risk hints for executables and http sources. Removing a record never deletes the file. Interrupted downloads are marked failed on next start.
- Settings: tab layout, sidebar, startup behavior (New Tab, restore session, specific pages), search engine, download folder, ask where to save, profiles, backups.
- Session restore: the active tab loads first; other restored tabs stay unloaded until clicked.
- Backups: automatic daily (5 newest kept), manual create, export and import. Each backup is integrity-checked; import checks the file and schema version, makes a safety copy first, and rolls back on error. Cookies and logins are never included.

### SIDB AI (Phase 5)
- **Model:** one NVIDIA-hosted model answers everything. The default is `mistralai/mistral-large-4-1t-a52b` (Mistral Large 4, the owner's choice; NVIDIA lists a 1M-token context and text plus image input). It exists in NVIDIA's public catalog today, but no real chat could be run, so answer quality and speed are untested. SIDB does not send `reasoning_effort`, which NVIDIA documents as "answer directly". If the model streams reasoning anyway it is never shown, and an answer that is empty after reasoning gets its own message. Image input is not used yet. The catalog changes often, so the model id is a setting with a "check and save" button instead of a hard-coded assumption.
- **Key handling:** the NVIDIA key is entered once, encrypted by Windows through Electron `safeStorage`, and never sent back to the UI. It is only sent to `integrate.api.nvidia.com` (the host is fixed in code). If the OS can't encrypt, nothing is saved.
- **What is shared, and when:** only what you ask. Page text goes to NVIDIA only when you press a page action (Summarize, Key points, Ask about page, Explain selection) or switch on "Current page". Private windows never share page content. Plain questions send no page text. Page URLs are shared without query strings or fragments. Page text is read in an isolated script world and capped at 40,000 characters (the answer says when a page was cut).
- **Features:** side panel and full workspace (`sidb://ai`) share one chat; streamed answers; stop button; summarize, key points, explain selection, translate (13 languages), rewrite (5 styles), ask about the page; saved chats grouped by day with delete; copy buttons; clear messages for a bad key, rate limit (with retry time), model not found, page too long, no selection, and private windows.
- **Prompt-injection care:** page text is wrapped in tags and the model is told it is untrusted data. Closing tags inside page text are neutralized. Answers are drawn as plain React elements (headings, lists, code blocks, bold), never as HTML or links.
- **Saved chats:** stored per profile in SQLite as text only (not the page text that was shared). Not saved in private windows. Not part of backups. Exported backup files now have every non-backup table emptied and compacted, so AI chats, open-tab session data and recently closed tabs are not inside them.
- **Pacing and timeouts:** at most 30 requests per minute locally (NVIDIA's free tier is about 40 and can't be raised), 30 seconds to the first byte and 180 seconds in total. Nothing AI-related starts at app launch.
### Customization and productivity (Phase 6)
- **Themes:** dark, light or follow the system; one accent colour (7 presets or any colour). The theme is app-wide: it also changes native menus, dialogs and the window buttons, and web pages see the matching `prefers-color-scheme`. Photo pages (New Tab, Private Browsing, warning page) always keep the dark palette so text stays readable.
- **New Tab page:** backgrounds are Scenery, three gradients (Aurora, Midnight, Dusk) or your own image (PNG, JPEG or WebP up to 8 MB, checked by file content, stored in the profile). The clock, "Continue browsing" (your 4 latest pages) and quick actions can each be turned off.
- **Bookmarks bar:** shows the bookmarks you pinned; Ctrl+Shift+B toggles it.
- **Sidebar and toolbar:** each item can be hidden in Settings. Everything stays reachable from the command palette.
- **Command palette (Ctrl+K or Ctrl+Shift+P):** about 45 commands (tabs, pages, zoom, find, bookmarks, themes, screenshots, QR, AI summary, Shield), your open tabs, bookmarks and history. Typing an address goes to it; typing words ranks commands first and offers "Search for ..." after them. Keyboard only: arrows, Enter, Esc.
- **Tab search (Ctrl+Shift+A):** the same palette limited to open tabs.
- **Tab groups:** right-click a tab (native menu) to add it to a new or existing group, remove it, pin, mute, duplicate, close others or close tabs to the right. Groups have a name and colour, collapse (the active tab stays visible), rename by menu, ungroup or close as a block, work in both tab layouts, and are saved with the session. Pinned tabs can't be grouped.
- **QR code generator:** from the palette, for the current page or any text (up to 1,200 characters). Copy the image or save a PNG.
- **Screenshots (Ctrl+Shift+S opens them in the palette):** visible area or the whole page (long pages are cut at 16,000 px), saved to a file with a Save dialog or copied to the clipboard.
- **How dialogs sit above web pages:** web pages are separate native views that cover HTML, so while a dialog is open SIDB swaps the page for a picture of itself. Messages use a strip above the page for the same reason.
- **Keyboard shortcuts:** a read-only list in Settings.

### Address bar suggestions (added before Phase 7)
- **What it does:** typing in the address bar opens a dropdown without pressing Enter. Rows come from your history, your most visited sites, bookmarks, a small list of well-known sites, and your search engine's own suggestions. Typing "yo" completes inline to "youtube.com" (the completed part is selected), shows YouTube and YouTube Music, then Google-style search suggestions.
- **Ranking:** bands that never mix: exact domain match, then frequently visited (5+ visits), then recent history (last 7 days), then older history, then bookmarks, then well-known sites, then engine suggestions. Inside a band the order uses visit count, how recently you visited, and match quality (the site's name, a prefix of the address, a word in the title, a path). The same address from history and bookmarks is one row with a star. One site never takes more than its home page plus two pages.
- **Engine suggestions:** the selected engine's own endpoint (Google, DuckDuckGo, Bing or Brave Search; fixed in code). Requests start 250 ms after you stop typing, a new keystroke cancels the old request, answers are cached for 5 minutes, a late answer can never replace a newer list, and a slow or failed request leaves your local rows in place with a quiet note.
- **Privacy:** only the typed words go to the engine, with no cookies, and never your history or bookmarks. Text that looks like an address or contains a path, `@`, a scheme or more than 100 characters is never sent. A Settings switch turns engine suggestions off. Private windows never use the profile's history for suggestions (bookmarks and the typed text still work); they do send typed words to the engine while the switch is on, like other browsers' private windows.
- **Safety of the answers:** responses are parsed as plain JSON, limited to 8 short text items with control characters removed, and shown only as text.
- **Keyboard and mouse:** Down/Up move and preview the row in the box, Enter opens the highlighted row (the first row is what Enter did before), Alt+Enter opens it in a new tab, Esc undoes the preview and then closes, Tab accepts the inline completion, Right Arrow or End accepts it too, Backspace removes it without it coming back. Focusing the box with nothing typed shows your most visited sites. Existing shortcuts (Ctrl+L and the rest) are unchanged.
- **Look:** a glass dropdown with favicons (a letter tile when there is none), bold matches, tags (Site, Bookmark, Suggested site, engine name), a star on bookmarked rows, a short fade-in, and dark and light themes.
- **No schema change:** it reuses the history, bookmark, settings and IPC layers. It adds one setting (`searchSuggestions`), two history queries and the `suggest` calls in the data API.

### Website icons (added before Phase 7)
- **What it does:** shortcut tiles, address bar suggestions, History, Bookmarks, the bookmarks bar and "Continue browsing" now show each site's real logo instead of a letter. One component (`Favicon`, exported as `SiteIcon`) and one service (`FaviconService`) serve every screen.
- **Where icons come from (own site only):** icons the page declares in its `<link>` tags (the sharpest first), then `/favicon.ico`, then a few well-known files (`apple-touch-icon.png`, `favicon.png`, `favicon.svg`). It stops as soon as it finds an icon at least 32 px wide (or a vector one). If the first icon is tiny it looks at the next ones and keeps the sharpest. No third-party icon service is ever contacted.
- **Visited pages teach the cache:** when a page loads, the icons it declares are saved right away, which costs no extra request to that site.
- **Cache:** plain files in each profile's own `favicons` folder (no database change): about 24 hex characters per site for the file name, the picture, and a small JSON note. Survives restarts, refreshed after 7 days (the old icon shows at once while the new one loads), "no icon" is remembered for 3 days, being offline is not mistaken for "no icon", and the folder is trimmed to 1,500 entries or 40 MB. Settings has a "Clear saved icons" button.
- **Quality and look:** PNG, ICO, SVG, WebP, JPEG and GIF are accepted, identified by their bytes, not by file name or Content-Type. They are drawn in a fixed square (20 to 36 px depending on the screen) with `object-contain` and a small margin. A short fade replaces the letter once the picture is ready. A black logo on a dark theme (or white on light) sits on a soft tile; coloured logos and pictures with their own background do not.
- **Fallback:** the letter tile is always underneath, so the square is never empty and a failed picture never shows a broken-image mark. A tab's own icon also falls back to the globe if its picture fails.
- **Search suggestions keep the search icon.** Only website rows get logos.
- **Safety:** only `http` and `https` icon addresses are fetched; no `file:`, `data:` or `javascript:`. Local and private-network addresses (localhost, 192.168.x.x, 10.x.x.x, `.local` and so on) are never fetched for an icon, including on redirects, unless the site itself lives there. Every redirect step is checked. Icons are capped at 256 KB, pages are read only up to their `<head>`, and each request times out after 5 seconds. SVG is shown only through an image element (scripts never run there), and files with scripts, `foreignObject`, event handlers, external links or entity tricks are refused. Cached files are re-checked each time they are read.
- **Private windows:** they read the profile's cache but keep anything new in memory only, so private visits leave no icon files on disk.
- **Performance:** at most 4 icon downloads at once, one download shared between simultaneous requests, and a small memory cache so reopening a list does not touch the disk.

### Performance, security and resources (Phase 7)
- **Bugs found and fixed:**
  - Closing any window threw "Object has been destroyed" in its cleanup code. Because of that, the rest of the cleanup never ran: listeners stayed attached, tab views were not disposed, and **a private window's cookies, storage and cache were not wiped on close** (they stayed in memory until SIDB quit, never on disk). On Windows the error also opened a blocking error box that froze SIDB until it was clicked (seen as 6 to 163 second freezes in the perf run). Fixed by reading the window id before it is destroyed. Re-checked: 0 exceptions and 0 freezes over 10 private windows.
  - Tab icons were loaded by the SIDB interface directly from websites (with its own network session, also for private windows). They now come from the icon cache like everywhere else, and the interface's security policy no longer allows any web images (`img-src 'self' data:`).
- **App-wide safety nets** (`electron/main/security/hardening.ts`): `<webview>` is refused everywhere, new windows are denied unless a tab handler allows them, USB, HID, serial and Bluetooth devices are never given to websites (no device picker is ever shown).
- **IPC:** a request is trusted only if it comes from the window's own interface frame **and** that frame shows SIDB's bundled `index.html` (or the dev server). The interface window also refuses redirects, not only navigations, away from it.
- **Security audit test** (`tests/unit/security-audit.test.ts`, 16 checks): scans the source for weakened `webPreferences`, `eval`, HTML injection, `ipcMain` use outside the IPC files, handlers without the sender check, `openExternal` without a URL check, a missing handler for any channel or data method, and the interface CSP. I planted a file with four bad patterns and the test caught all four.
- **Tab sleeping (only when you ask):** right-click a tab ("Sleep tab", "Sleep all background tabs"), or use Settings > Performance. A sleeping tab is dimmed with a moon, keeps its place, and on opening comes back with its back/forward history and scroll position. Tabs that are active, playing sound, using camera/microphone/screen, pinned or still loading are never put to sleep. SIDB never unloads or closes tabs by itself.
- **Low memory strip:** when free system memory drops below 15% (very low below 8%, with recovery margins so it does not flicker), a strip offers to sleep background tabs. "Not now" hides it until memory recovers.
- **Battery:** on battery power the interface drops blur and animations (loading spinners still turn). The same happens always if Windows is set to reduce motion.
- **Settings > Performance:** memory used by SIDB, free memory, memory per tab, sleep buttons, and a hardware acceleration switch (takes effect after restart).
- **GPU crash guard:** if the graphics process crashes 3 times within 10 minutes, SIDB starts with hardware acceleration off next time and says so in Settings.
- **Background tab priority:** not built by SIDB, because Chromium already lowers the priority of hidden tabs.
- **Dependencies:** removed unused `framer-motion` and `@ghostery/adblocker-electron`; Ghostery packages pinned exactly. `npm audit --omit=dev`: 0 issues. Ghostery is MPL-2.0 (its files must stay open source if changed; using it is fine).

### Packaging and release (Phase 8)
- **Tooling:** Electron Forge **7.11.2** (Forge 8 needs Node 22.13+, this PC has Node 20.19.6), `@electron/fuses` 1.8.0, all pinned exactly. `npm audit --omit=dev`: 0 issues; Forge added no new audit findings (the 4 moderate drizzle-kit dev-tool ones remain).
- **Interface served from `sidb-app://ui/` instead of `file://`.** A privileged private scheme registered only on the interface windows' session, so web pages in tabs can't load it. Paths can't leave the `dist` folder (unit tested, including encoded `..`, backslashes and NUL). This made it possible to turn off the `GrantFileProtocolExtraPrivileges` fuse. The IPC sender check now accepts only `sidb-app://ui/index.html` (or the dev server).
- **What ships:** `app.asar` is 2.5 MB and holds only the built interface, the main and preload code, the database migrations, the window icon and Ghostery's element-hiding script with its licence. No `node_modules`, no source maps, no developer tools (`perf`, `diag`). Vite bundles all libraries; the Ghostery script is copied at build time (`scripts/copy-runtime-files.mjs`).
- **Fuses (read back from the built SIDB.exe):** RunAsNode off, NODE_OPTIONS off, `--inspect` off, cookie encryption on, embedded asar integrity validation on, only load from asar on, file:// extra privileges off. Verified: a copy with **one byte changed** in `app.asar` stops at startup with "Integrity check failed" and creates no profile; the unchanged copy runs.
- **Remote debugging guard:** an installed SIDB ignores `--remote-debugging-port`/`-pipe` unless a separate `--user-data-dir` is given (same rule as Chrome 136+, against cookie-stealing malware). Seen working: with the normal profile folder the port stayed closed while SIDB ran; with a separate folder it opened.
- **Icons:** `npm run icons` makes `icon.ico` (16 to 256 px) and `icon.png` (512 px) from the logo, using only the globe mark (the lettering is unreadable at small sizes), centred on the logo's own background colour.
- **Windows installer (Squirrel.Windows):** `SIDB-0.1.0 Setup.exe` (150 MB), the update package and `RELEASES`, a portable zip (152 MB), and `SHA256SUMS-win32.txt`. Per-user install, no administrator rights. SIDB handles the installer's start-up events itself (creates or removes shortcuts, then quits without a window); all four events were run and quit in about 1.3 s with no window and no profile. Uninstalling keeps `%APPDATA%\SIDB`.
- **Not code-signed:** no certificate, so SmartScreen will say "Unknown publisher". The config accepts a certificate through environment variables when there is one.
- **Separate data for runs from source:** `npm start`/`npm run dev` now use `%APPDATA%\SIDB-dev`, because the installed app encrypts cookies and the development binary can't read them. **Your existing data from Phases 1 to 7 stays in `%APPDATA%\SIDB`, where the installed app will use it;** runs from source start empty from now on.
- **Linux:** deb and rpm makers are configured (and a zip). They can't be built on Windows; the release workflow builds them on Ubuntu. **Never built or run yet.** Possible issue: Ubuntu 24.04 restricts the sandbox that Electron uses; the deb normally handles it, but this is untested.
- **Updates (manual path, as the blueprint asks first):** Settings > About and updates shows the version, checks GitHub Releases (once a day in the installed app, or "Check now"; can be turned off), shows the notes and opens the release page in a tab. A short message appears once per new version. SIDB **never downloads or runs an installer itself.** GitHub's answer is validated: drafts, pre-releases and non-version tags are ignored, and the page must be a github.com release page of the configured repository. Version comparison follows Semantic Versioning (unit tested). The repository is **not set yet** (`package.json` > `sidb.updates.github`), so the panel says checks are not set up.
- **Release workflow** (`.github/workflows/release.yml`): on a `v1.2.3` tag, builds on Windows and Ubuntu, runs unit and database tests, checks that the tag matches `package.json`, uploads installers and checksums to a **draft** release for the owner to publish. **Not run** (no GitHub repository yet).
- **Docs:** `README.md` (install, checksums, SmartScreen, data locations, uninstall, build, release steps, security notes, third-party licences) and `docs/USER_GUIDE.md` (every feature as built, Google sign-in limitation, shortcuts, troubleshooting, not-built list). While checking the guide against the code I corrected two claims of mine: there is no Ctrl+D shortcut, and plain site names (for example `localhost`) are sent for search suggestions; only full addresses, paths, logins and query strings are not.
- **Packaged app checks** (`npm run smoke:packaged`, 13/13, throwaway data folder): interface loads from `sidb-app://` (not file://), IPC works, update status reports an installed build, Performance data, database opened and migrated, profile in the given folder, filter lists downloaded and built in the worker thread inside the archive (120,372 + 34,939 rules), example.com loads, element hiding works (the Shield script loads from the archive), user agent has no Electron token, 14 requests blocked on theguardian.com, private window opens.
- **A mistake during testing:** my first check of the remote debugging guard tried to use a temporary data folder by changing the `APPDATA` variable, but Windows finds that folder another way, so the packaged app started twice for about 6 seconds on **your real `%APPDATA%\SIDB` profile** and was force-closed. I checked afterwards: only logs, caches and the database's write-ahead file changed; cookies, settings, profiles and secrets did not; no page was opened. The equivalent of opening and closing SIDB twice. That test was removed from the smoke script and replaced by a unit test.
- **Not verified:** running `Setup.exe` on this PC (it would install SIDB for your user, add shortcuts and start it on your real profile, so I left it for you), Start-menu shortcut, uninstall, updating from one installed version to the next, Linux packages, the release workflow, the update check against a real repository, the installed app's icon in the taskbar.

### Google sign-in compatibility (investigated 1 November 2026)
- **Problem:** Google sign-in in SIDB ends on `accounts.google.com/v3/signin/rejected` ("Couldn't sign you in. This browser or app may not be secure").
- **Root cause:** Google's policy. Since 4 January 2021 Google blocks Google Account sign-in from embedded browser frameworks (CEF-based apps and other non-supported browsers), per [Google's developer guidance](https://developers.googleblog.com/2020/08/guidance-for-our-effort-to-block-less-secure-browser-and-apps.html). SIDB is built on Electron, which is such a framework. **Google does not support SIDB's environment for account sign-in**, and this is not something SIDB can fix inside its own tabs without impersonating another browser.
- **How this was established (all measured on this PC, same Chromium 156, same network):**
  - Control: real Chrome 156 with a fresh profile, given the same made-up address, answered "Couldn't find this account". So Google accepted the browser and moved on to the account lookup.
  - SIDB with the same input was sent to `/signin/rejected` (reason code `rrk=46`, other parameters encrypted) before any account lookup, so the decision is about the browser, not the account or the network.
  - Changing the user agent made no difference: the old per-session override, an app-wide default with the full version, and an app-wide default in Chromium's reduced format were all rejected the same way.
  - Remaining differences from Chrome are things Electron itself doesn't implement. Electron sends no `Sec-CH-UA` client hints on page navigations (only on scripts' requests), doesn't remember `Accept-CH` (so high-detail hints are never sent), and has an empty `window.chrome`. SIDB also correctly reports only the "Chromium" brand, not "Google Chrome". Faking any of these would mean impersonating Chrome or injecting scripts to defeat Google's check, which SIDB does not do.
- **Changes made:**
  - User agent is now set once, app-wide (`app.userAgentFallback`), before any session exists, in Chromium's standard reduced format: `Chrome/156.0.0.0`, with no Electron or app token. Client hint brands are unchanged (Chromium only). The per-session override is gone. This does not unlock Google sign-in; it makes SIDB's identity consistent and covers every session, including private ones.
  - Google's rejection page is detected (it arrives as an in-page navigation of Google's single-page sign-in app). A strip above the page explains that this is Google's rule. One button, only on click, opens the sign-in in the system's default browser. For a plain Google Account sign-in it opens the page the sign-in was heading to (for example `myaccount.google.com`). For "Sign in with Google" on another website it opens **that website**, because Google's own continue address is tied to SIDB's session and the site's sign-in state lives in SIDB's cookies, so neither would work in another browser. In private windows the strip says the default browser opens a normal window. "Learn more" opens Google's help page in a SIDB tab.
  - The UI never chooses what gets opened: it sends only the tab id, and the main process opens the address it stored itself, only plain https and only while the notice is showing.
  - Private windows: the storage wipe on close now runs a second time 2 seconds later. One of four runs had found a single Google cookie set after the first wipe by a response still in flight. It was memory-only and unreachable by other windows, but it is now removed too.
  - Developer tool `electron/main/dev/diag.ts` (runs only unpackaged with `SIDB_DIAG_OUT`): compares identity with real Chrome and runs the checks below.
- **Not applicable:** SIDB has no account integration of its own that signs in with Google (SIDB AI uses an NVIDIA key, Safe Browsing a Google API key). So no system-browser OAuth flow (loopback + PKCE) was built; it would be needed only if such a feature is added later.

| Check (real sites, fresh profile) | Result |
|---|---|
| google.com, youtube.com | Loaded (200), no errors, no notice |
| mail.google.com, drive.google.com (signed out) | Redirected to their Google Workspace pages, loaded, no errors |
| wikipedia.org, github.com, example.com | Loaded, no errors |
| Google Account sign-in, made-up address | Rejected by Google; SIDB notice and strip shown; the handoff would open `https://myaccount.google.com/` (the test replaced the "open in default browser" call with a recorder, so no real browser opened) |
| "Sign in with Google" for a third-party app (Google's public OAuth Playground client) | Rejected by Google; strip names developers.google.com; the handoff would open `https://developers.google.com/` |
| Same tab, then normal browsing (wikipedia.org) | Notice and strip gone, page loaded; the handoff refuses when no notice is showing |
| Private window on Google sign-in | Its own session; 3 Google cookies there, the profile's 14 Google cookies unchanged; 0 left after closing (final run) |
| Regressions | 147 unit tests, 28 DB tests, build; `npm run perf`: 0 CSP violations, 0 exceptions, 0 crashes, IPC check passed, tab sleeping still worked |

- **Not tested:** signing in with a real Google account in the default browser (only the handoff target was checked), the strip in the light theme, Gmail and Drive while signed in (impossible in SIDB because of Google's block), Linux.
- **Remaining restriction:** Google Account sign-in, and "Sign in with Google" on other websites, do not work inside SIDB. Sites that use their own login, or another provider, are unaffected. Signing in through the default browser signs you in **there**, not in SIDB. This will stay so unless Google changes its policy or SIDB stops being an embedded-framework browser.

### SIDB Shield (Phase 4)
- Filter lists: EasyList, EasyPrivacy, uBlock filters, quick fixes, unbreak, privacy, badware, IndianList. They are downloaded from their publishers, not bundled.
- Daily background update. A new version must pass structural checks (not an HTML page, correct title, not less than half the old size) and must build into a working engine before it replaces the old one. The previous files are kept as `.prev` and used as a fallback on startup. A failed update changes nothing.
- The engine is built in a worker thread so the UI does not freeze, then cached on disk for fast startup.
- Network blocking, element hiding and uBlock-style scripts (used for YouTube) run for every tab.
- Per-profile master switch, website exceptions (host and subdomains), custom rules, per-tab blocked counters, daily and total statistics.
- Popup blocking for `window.open` calls with no click or key press on the page in the last 1.5 seconds.
- Safe Browsing (Google v5 `hashes:search`): off by default, needs the user's own API key, key stored with OS encryption only, sends 4-byte hash prefixes, fails open, full-page warning with a deliberate "continue anyway" step.
- Secure DNS (DNS over HTTPS) off by default, provider choice, falls back to system DNS.

---

## 4. Verification results (measured by running the app)

These were run against the packaged build with a throwaway data folder. Browser pages were real websites.

| Check | Result |
|---|---|
| Filter lists: first download and engine build | Ready about 8 seconds after first launch; 120,187 network rules and 34,939 cosmetic rules |
| Second launch | Cached engine was already loaded about 0.2 seconds after process start |
| Blocking on real pages | theguardian.com: 16 requests blocked. forbes.com: 23 blocked |
| Website exception for a site | 0 blocked on that site, tab showed "site-off" |
| Shield switched off | 0 blocked |
| Popup without a click | Blocked (counter 1, no new tab) |
| Popup after a simulated click | Allowed (new tab opened) |
| YouTube, Shield **off** | Ad data present in the player response (1 to 2 ad placements, 6 ad slots on one video) and an ad was showing on one video |
| YouTube, Shield **on** | Ad placements, player ads and ad slots were all 0 on both videos tested; no ad was showing |
| History, bookmarks, shortcuts, downloads, settings after restart | All persisted |
| Session restore after restart | Both tabs restored; only the active one loaded until clicked |
| Private window visit | History row count unchanged |
| Backup, export, import, wrong-version and damaged file | Covered by automated tests; damaged files rejected without touching current data |
| AI request path (real app, stand-in NVIDIA server) | Key sent only in the Authorization header; right model id and streaming flag; summarize included the page text; URL query and fragment were not sent; plain chat sent no page text; selection action sent only the selected text; chat saved with the right title |
| AI in a private window | Page actions refused with no network call; a typed question worked and nothing was saved |
| AI interface | Streamed Markdown with code block and copy button rendered; a rate-limit reply showed the retry time |
| AI key visibility | The UI's view of the API contained no key text |
| Tab groups (real app) | Two tabs grouped, the group stayed one block, collapsed and expanded; after a restart the group and its tabs were restored |
| Command palette over a live page | The page stayed visible behind the dialog as a picture; typing "shield" and pressing Enter opened the Shield page (a bug where Enter ran a web search instead was found and fixed) |
| Tab search | Typing "iana" and pressing Enter switched to the matching tab |
| QR code | The generated image was decoded with an independent QR reader and returned the exact page address |
| Screenshots | On a long Wikipedia page the visible capture was 1072 x 712 and the whole-page capture was 1057 x 6113 |
| Address bar suggestions (real app, real typing) | Typing "yo": rows appeared about 100 ms after the first key (including my polling), with "youtube.com" completed inline; Google's answers followed a moment later. Down twice previewed "music.youtube.com/" in the box; Esc undid it and a second Esc closed the list; Backspace left "y" with no completion; Enter on the completion opened youtube.com; focusing an empty box listed the most visited sites |
| Suggestion privacy and engine choice | "github.com/acme/private" caused no request. With DuckDuckGo selected only duckduckgo.com was contacted and the box said "Search DuckDuckGo"; with suggestions switched off no request was made and local rows still showed. A private window listed no history rows |
| Real website icons (real sites) | The five default shortcuts loaded the true logos: YouTube 144 px PNG, ChatGPT and GitHub SVG, Google 32 px ICO, Notion 512 px PNG, each from the site itself. A shortcut to a non-existent domain kept its letter; a shortcut changed from that domain to mozilla.org showed the Mozilla logo. A restart with all network blocked still showed every icon from the disk cache (0 requests). GitHub and GitLab logos appeared on the address bar suggestion rows while search rows kept the magnifier. A first run showed letters over loaded pictures (a timing bug); it was fixed and re-checked |
| Suggestion speed on a big history | 20,000 history rows searched for "topic 42" in under 400 ms in the test (usually well under 100 ms) |
| Light theme, accent, hidden items, bookmarks bar | Switched through the real settings path: light theme applied (system and page theme followed), accent colour applied, Downloads and AI buttons and the History sidebar item hidden, pinned bookmark shown in the bar |

**Phase 7 performance numbers** (`npm run perf`, Windows, 16 GB RAM, dev build, local test pages with a list, text and a canvas; Shield engine loaded with 120,285 + 34,939 rules). Memory is private memory (what each process alone holds), summed over all SIDB processes:

| Measure | Result |
|---|---|
| Startup (from process start) | Main code loaded 91 ms, Electron ready 123 ms, Shield engine loaded 155 ms, interface loaded and window shown about 740 ms |
| AI service created at startup | No (created on first use) |
| Memory: idle, 1, 5, 10 tabs | 287 MB, 325 MB, 433 MB, 581 MB (about 27 to 30 MB per extra tab) |
| Tab switch (until the interface paints) | Median 16.7 ms, slowest 18 ms over 30 switches (one screen frame) |
| Idle CPU with 10 tabs | 0.1% to 0.6% in total |
| Sleeping 8 background tabs | 637 MB down to 359 MB, tab processes 11 down to 3; pinned and active tab stayed awake; the woken tab had its back history and scroll position (1200 px) |
| Leak check: 30 tab open/close, then 10 private windows | Main heap 10.8 to 11.3 MB, open web contents back to 1, tab processes back to 1, total memory within normal variation |
| Private window open | 65 to 76 ms each |
| First launch (lists not yet downloaded) | The main process grows to about 270 MB while the filter lists are built, then falls back on later launches (about 100 to 112 MB) |

Limits: one machine, local test pages (real sites use more memory), dev build not the packaged app. The tab switch number is the interface frame, not the time until a heavy site has repainted.

Limits of this evidence: YouTube was checked on two videos at one point in time. YouTube changes often, so this is not a guarantee (the blueprint requires "best effort" wording, and the UI says so).

---

## 5. Not verified, or known gaps in built features

**Not verified end to end**
- **Website icons:** the rule that private windows write nothing to disk is covered by an automated test; my live private-window run was done offline, so it did not prove it on its own. Sites that only offer a 16 px icon will look softer than sharp logos. A site's icon is requested the first time it is shown, so the site sees that request (the same kind of request any browser makes); a switch to turn this off is not built. The light theme was looked at on the New Tab page only.
- **Address bar suggestions:** clicking a row with a real mouse, Alt+Enter (new tab), Tab to accept the completion, and typing through an input method (for example Hindi) were not exercised. Removing a single history suggestion with Shift+Delete is not built. While the dropdown is open the page is shown as a still picture (a playing video keeps playing underneath), and the dropdown needs a visible window like the command palette. Engine suggestions depend on each engine's public endpoint staying as it is today.
- **Screenshots and the palette picture need a visible window.** Chromium refuses to capture a window that is fully covered or minimized (the first test run failed that way, behind the editor). SIDB now reports "make sure the window is visible" instead of failing silently, and shows no picture if one can't be taken.
- **Saving files:** the Save dialogs for screenshots and QR PNGs, and the image picker for wallpapers, were not clicked through; copy to clipboard was verified.
- **SIDB AI against the real NVIDIA service:** no API key was available. The streaming code is tested with a stand-in server and uses the OpenAI-compatible format NVIDIA documents, but real answers, speed, free-tier limits and exact error replies have not been seen. The first real use may need small adjustments.
- Google Safe Browsing against the live service: no API key was available. The URL logic matches Google's documented examples and the client is tested with a mocked network. The warning page was not shown in a live run.
- Secure DNS (DNS over HTTPS): the setting is applied through Electron, but no lookup was inspected.
- Right-click menus, find bar, page fullscreen, Ctrl+wheel zoom: implemented, only partly exercised.
- Linux: nothing has been run on Linux yet. Only Windows was used.
- Google Account sign-in is refused by Google in SIDB (Google policy for embedded frameworks). See "Google sign-in compatibility".

**Known gaps against the blueprint**
- Third-party cookie blocking ("intelligent blocking with exceptions") is **not implemented**. Tracker requests that the lists block never send cookies, but there is no separate cookie policy.
- Publisher checksum headers in filter lists are not verified. The one list that publishes a checksum did not match the published algorithm, so integrity relies on HTTPS plus the structural checks and the build test.
- In custom rules, exception lines (`@@`) only affect your own rules, not the downloaded lists. Use website exceptions instead.
- Blocking of malicious redirects is limited to what the lists and Chromium already do. Only the popup case was built.
- YouTube protection depends on list freshness and on scripts running early in the page. It is described as best effort in the UI.

---

## 6. Blueprint features not started or only partly done

**Tabs and windows:** drag-to-reorder tabs and dragging tabs into groups (the reorder logic exists, the dragging does not), multiple normal windows for one profile.
**Customization (Phase 6):** keyboard shortcut editor, a weather widget, Picture-in-Picture and Reader mode. The last two were marked optional in the blueprint and were not started.
**Performance and testing (Phase 7):** a full offline regression run that clicks through every feature (navigation, history, bookmarks, downloads, session restore, Shield blocking with a test rule, suggestions, groups, AI with a stand-in server) is not built; `npm run perf` covers tabs, private windows, tab sleeping, IPC trust, icons and CSP only. The low-memory strip was checked by code and screenshot of Settings, but this machine never reached low memory, so the strip has not appeared in a live run. Battery mode and the GPU crash guard were not triggered for real (no battery, no GPU crash); their rules are unit tested. Real camera/microphone protection from sleeping was not exercised.
**Profiles:** rename and delete profile, profile deletion warning.
**Site permissions:** a settings screen to review or remove saved choices.
**Updates and release (Phase 8):** automatic download and install of updates (needs code signing and verified update metadata first; the Squirrel files needed for it are already produced), code signing, the first GitHub release, Linux builds.
**Website:** Cloudflare Pages landing page.
**Process:** no Git commit has been made yet and there is no GitHub repository. Playwright end-to-end tests are not set up (the packaged smoke test covers the basics).

---

## 7. Decisions that differ from, or add to, the blueprint

| ID | Decision | Reason |
|---|---|---|
| D1 | SQLite through Node's built-in `node:sqlite` with Drizzle's sqlite-proxy driver instead of `better-sqlite3` | No native module to rebuild for Electron; works with Electron's bundled Node 24. Trade-off: tests that touch the database must run on Electron's Node (`npm run test:db`). |
| D2 | Filter engine: `@ghostery/adblocker` core, with SIDB's own Electron wiring instead of its ready-made Electron package | The ready-made package turns off Electron security warnings app-wide, uses one global handler without sender checks, and does not support per-site exceptions or counters. |
| D3 | Safe Browsing uses per-navigation hash-prefix lookups with the user's own key, off by default | The local-database variant needs a large sync system. This is simpler but sends hash fragments for each page; the UI explains this. Google's terms limit the API to non-commercial use. |
| D4 | The sidebar "Workspaces" in the design images are real profiles | Matches the blueprint's profile model. |
| D5 | Shield engine is shared by all profiles; switches, exceptions, custom rules and statistics are per profile | One engine saves memory; user choices stay separate. |
| D6 | Secure DNS is app-wide, not per profile | Electron configures it for the whole app. |
| D7 | The NVIDIA model id is a setting (with a catalog check); default `mistralai/mistral-large-4-1t-a52b` (the owner's choice) | The catalog changes quickly. Context length and quotas are not assumed: pages are capped conservatively even though this model lists a much larger window. |
| D8 | NVIDIA's free tier is for individual development and evaluation; production and commercial use are banned | Fine for a personal browser. If SIDB is ever shared with other people, review NVIDIA's terms first. |
| D9 | Electron Forge 7.11.2, not 8 | Forge 8 requires Node 22.13+; this PC has Node 20.19.6. Moving to Forge 8 only needs a newer Node. |
| D10 | Updates: SIDB checks and tells, the user installs | The blueprint allows automatic installs only after secure infrastructure is verified. There is no code-signing certificate yet, so nothing is downloaded or run automatically. |
| D11 | The interface is served from `sidb-app://` instead of `file://` | Lets the `GrantFileProtocolExtraPrivileges` fuse be turned off, as Electron recommends. |
| D12 | Runs from source use `%APPDATA%\SIDB-dev` | The installed app encrypts cookies with a fuse the development binary lacks; one shared folder would lose cookies. |

---

## 8. Repository map

```
electron/main/        main process
  windows/            window creation and window registry
  tabs/               TabManager (tabs, views, find, zoom, shortcuts, popups)
  ipc/                IPC registration and data handlers
  permissions/        permission prompts and storage
  profiles/           profile manager and per-profile services
  services/           bookmarks, history, downloads, settings, session, backup, Shield data
  downloads/          download manager
  shield/             lists, engine, worker, Safe Browsing, secret store, DNS
  security/           app-wide hardening (webview, devices, window opening)
  resources/          memory pressure monitor, GPU crash guard
  perf/               startup marks and process metrics
  dev/                perf and compatibility harnesses (only run unpackaged with SIDB_PERF_OUT / SIDB_DIAG_OUT; not shipped)
  install/            Squirrel.Windows installer events
  updates/            GitHub Releases update check (never downloads)
  db/                 SQLite open and migrations
electron/preload/     the only bridge exposed to the UI
shared/               IPC contract, schemas, types, URL helpers
database/             Drizzle schema and generated migrations
src/                  React UI (components, pages, stores, hooks)
tests/unit, tests/db  automated tests
scripts/              dev runner and DB test runner
```

---

## 9. How to run

| Command | Purpose |
|---|---|
| `npm run dev` | Run in development mode |
| `npm run build` then `npm start` | Production-style run |
| `npm test` | Unit tests |
| `npm run test:db` | Database tests (uses Electron's Node) |
| `npm run build`, then run Electron with `SIDB_DIAG_OUT=<file>.json` (optional `SIDB_DIAG_EMAIL`, `SIDB_DIAG_CHROME`) | Browser identity and Google compatibility checks (developer only, never in a packaged app) |
| `npm run build` then `npm run perf` | Performance and leak run (developer only, never in a packaged app). Uses `%TEMP%\sidb-perf-profile`; `-- --fresh` starts clean, `-- --json` prints everything |
| `npx drizzle-kit generate --name <name>` | Create a migration after changing `database/schema` |
| `npm run package` | Packaged app in `out/SIDB-win32-x64` |
| `npm run smoke:packaged` | 13 automated checks of the packaged app (throwaway data folder) |
| `npm run make` | Windows installer, zip and `SHA256SUMS-win32.txt` in `out/make` (on Linux: deb, rpm, zip) |
| `npm run icons` | Regenerate the app icons from `resources/icons/logo.png` |

Dependency audit: `npm audit --omit=dev` reports 0 issues. The full `npm audit` reports 4 moderate issues, all inside `drizzle-kit`'s development-only tooling (an old `esbuild`). None ship in the app.

---

## 10. Recommended next steps

1. **Commit** the current state to Git as a milestone, and create the GitHub repository (private or public). Then set `sidb.updates.github` in `package.json` to `<owner>/<repo>`.
2. **Install and try the Windows build:** run `out/make/squirrel.windows/x64/SIDB-0.1.0 Setup.exe` (SmartScreen: More info > Run anyway). It uses your existing `%APPDATA%\SIDB` data. Check the Start menu entry, the taskbar icon, uninstall and reinstall.
3. **First release:** push a `v0.1.0` tag; the workflow builds Windows and Linux on GitHub and makes a draft release. Install the Linux package once on a real Linux machine before publishing the draft.
4. Add your NVIDIA key in Settings, press Test connection, then try Summarize on a few real pages. Tell me anything odd and I will adjust.
5. Test Safe Browsing with a real key and the Google test pages, and check DNS over HTTPS with a network tool.
6. Manual pass on the unverified items in section 5.
7. Look through the light theme page by page. It was checked on Settings and History only; other pages use the same colour system but were not each inspected, and the window buttons' light-theme colour was not seen (screenshots exclude the window frame).
8. Later: the offline regression run (section 6), a code-signing certificate, and then automatic updates (Squirrel already produces the files they need).
