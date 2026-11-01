# SIDB

**A Browser Built Around You.** A personal desktop web browser for Windows and Linux, built on Electron (Chromium).

Version 0.1.0. This is a personal project, not a public product. See [progress.md](progress.md) for exactly what has
and has not been verified, and the [user guide](docs/USER_GUIDE.md) for how to use it.

## What's in it

- Tabs (horizontal or vertical), tab groups, pinning, muting, sleeping background tabs, session restore
- Smart address bar with history, bookmarks and search-engine suggestions
- Private windows that keep nothing after they close
- Profiles, bookmarks (with HTML import and export), history, downloads, backups
- **SIDB Shield:** ad and tracker blocking with public filter lists, popup blocking, optional Safe Browsing and secure DNS
- **SIDB AI:** an assistant using NVIDIA's hosted models with your own API key
- Themes, accent colours, New Tab page, command palette, QR codes, screenshots
- Performance panel with per-tab memory, low-memory and battery behaviour, update check

## Install

### Windows 10 and 11 (64-bit)

1. Download `SIDB-<version>-Setup.exe` from the [latest release](https://github.com/siddhantsaurabhjha/SIDB/releases/latest).
2. Optional: check the download. In PowerShell, `Get-FileHash .\SIDB-<version>-Setup.exe -Algorithm SHA256` must
   print the value listed for that file in `SHA256SUMS.txt` on the release.
3. Run it. It installs for your user only (no administrator rights) and starts SIDB.

The installer is **not code-signed**, so Windows SmartScreen shows "Windows protected your PC / Unknown publisher" the
first time. Choose "More info", then "Run anyway", only if the checksum matched.

A portable zip (`SIDB-<version>-win-x64.zip`) is also provided. It uses the same data folder as the installed app.

### Linux (64-bit)

`.deb` for Debian, Ubuntu and relatives (installed and tested on Ubuntu in CI), `.rpm` for Fedora, openSUSE and
relatives (built, not yet installed in testing) and a portable zip.

```bash
sha256sum -c --ignore-missing SHA256SUMS.txt
sudo apt install ./sidb_<version>_amd64.deb      # or: sudo dnf install ./sidb-<version>-1.x86_64.rpm
```

## Updating

SIDB checks GitHub Releases once a day (Settings > About and updates; it can be turned off) and tells you when a newer
version exists. It **never downloads or installs anything by itself**. To update, open the release page from that
panel, download the installer and run it. Your data is kept.

## Your data

| | Windows | Linux |
|---|---|---|
| Profiles, history, bookmarks, settings, Shield lists | `%APPDATA%\SIDB` | `~/.config/SIDB` |
| The program (installed) | `%LOCALAPPDATA%\SIDB` | `/usr/lib/sidb` |

Uninstalling (Windows: Settings > Apps > SIDB) removes the program and its shortcuts but **keeps your data**, so a
reinstall finds everything. Delete the data folder yourself to remove it. Cookies are encrypted with your operating
system's key store; the NVIDIA and Safe Browsing keys are stored only through the OS key store as well.

Runs from source (`npm start`, `npm run dev`) use a separate folder, `SIDB-dev`, so development never touches the data
of the installed app.

## Build from source

Requires Node.js 20.19 or newer and npm. Windows builds need Windows; Linux packages need Linux with `fakeroot`, `dpkg`
and `rpm`.

| Command | Purpose |
|---|---|
| `npm ci` | Install exactly the locked dependencies |
| `npm run dev` | Run with live reload |
| `npm run build` then `npm start` | Production-style run from source |
| `npm test` / `npm run test:db` | Unit tests / database tests |
| `npm run package` | Packaged app in `out/SIDB-<platform>-<arch>` |
| `npm run smoke:packaged` | Automated checks of the packaged app (throwaway data folder) |
| `npm run make` | Installers and archives, renamed for release, in `out/release`, with `SHA256SUMS-<platform>.txt` |
| `npm run icons` | Regenerate `resources/icons/icon.ico` and `icon.png` from `logo.png` |
| `npm run perf` | Performance and leak measurement (developer only) |

## Releasing

The update check and releases use `"sidb": { "updates": { "github": "siddhantsaurabhjha/SIDB" } }` in `package.json`.

1. Raise `version` in `package.json` (Semantic Versioning) and write `docs/release-notes/v<version>.md`.
2. Run locally: `npm test`, `npm run test:db`, `npm run build`, `npm run perf`, `npm run package`, `npm run smoke:packaged`.
3. Commit to `main`, then tag and push: `git tag v<version> && git push origin v<version>`.
4. The [workflow](.github/workflows/release.yml) builds on Windows and Ubuntu, runs the tests, smoke-tests the packaged
   app, installs, uninstalls and reinstalls on Windows, installs the `.deb` on Ubuntu, and only then publishes the
   release with all files and `SHA256SUMS.txt`. It refuses to overwrite an existing release; a fix gets a new version.

Every push to `main` runs the same builds and tests without releasing.

## Security notes

Context isolation, sandboxing and web security are on for every window and tab; web pages never get SIDB's bridge.
Packaged builds flip these Electron fuses: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, cookie
encryption on, the app only loads from its integrity-checked `app.asar`, and `file://` gets no extra privileges (the
interface is served from `sidb-app://`). Remote debugging is refused unless a separate `--user-data-dir` is given.
`tests/unit/security-audit.test.ts` checks the source for regressions.

Google does not allow Google Account sign-in in browsers built on embedded frameworks, which includes SIDB; see the
user guide.

## Third-party software

SIDB includes Electron (MIT) and Chromium (BSD-style and others, listed in `LICENSES.chromium.html` next to the
program), React (MIT), Zustand (MIT), Zod (MIT), Drizzle ORM (Apache-2.0), lucide-react (ISC), qrcode-generator (MIT)
and Ghostery's adblocker (MPL-2.0; the element-hiding script ships unchanged with its licence). Filter lists (EasyList,
EasyPrivacy, uBlock Origin lists and others) are downloaded from their publishers at runtime under their own licences
and are not part of the program.
