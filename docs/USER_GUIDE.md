# SIDB user guide

Everything here describes what SIDB 0.1.0 actually does. Things that are not built yet are listed at the end.

## Getting started

When SIDB opens you see the New Tab page: a search box, your shortcut tiles and, if you like, a clock and your recent
pages. Type in the address bar at the top (Ctrl+L) to search or to open an address.

The sidebar on the left opens Home, Bookmarks, History, Downloads, Shield, the AI assistant and Settings. Ctrl+B hides
or shows it. Almost everything is also in the **command palette** (Ctrl+K): type what you want and press Enter.

## Tabs

- New tab Ctrl+T, close Ctrl+W, reopen the last closed tab Ctrl+Shift+T. Middle-click closes a tab.
- Right-click a tab for pin, mute, duplicate, reload, groups, sleep and close options.
- **Tab groups:** right-click > "Add to new group". Click a group's name to collapse or expand it.
- **Horizontal or vertical tabs:** the layout button in the toolbar, or Settings > Layout.
- **Search open tabs:** Ctrl+Shift+A.
- **Sleeping tabs:** right-click > "Sleep tab", or Settings > Performance. A sleeping tab is dimmed with a moon. It
  frees its memory and reloads when you open it again, back at the same place with its history. SIDB never puts tabs
  to sleep or closes them on its own. Tabs that play sound, use the camera or microphone, are pinned or still loading
  are never put to sleep.
- On startup SIDB can open a New Tab, restore your last tabs, or open pages you choose (Settings > On startup).
  Restored tabs only load when you click them.

## Address bar

As you type, suggestions appear from your history, most visited sites, bookmarks and your search engine. The best
matching site is completed inline; press Enter to go there, or Backspace to remove the completion. Arrow keys move
through the list, Esc closes it.

What you type is sent to your search engine to get suggestions. Turn that off in Settings > Search; history and
bookmark suggestions keep working and never leave your computer. Full addresses are never sent: anything starting with
a scheme such as `https:`, and any single word containing `/`, `@`, `?` or `#` (paths, logins, query strings), and
anything over 100 characters. A plain site name such as `example.com` or `localhost` is sent like a search word.

## Private windows

Ctrl+Shift+N opens a private window (dark purple). It has its own cookies and storage, writes no history, saves no
session and no AI chats, and everything it held is wiped when you close it. Files you download stay on disk.
Private does not hide you from websites, your employer or your internet provider.

## SIDB Shield

Shield blocks ads, trackers and unwanted popups using public filter lists (EasyList, EasyPrivacy, uBlock Origin lists
and others). The lists download on first start and update once a day in the background.

- The shield icon in the toolbar shows how many requests were blocked on the page and lets you turn Shield off for
  that site.
- The Shield page lets you choose lists, add your own rules, manage site exceptions, and turn on Safe Browsing (needs
  your own Google API key) and secure DNS.
- Blocking is best effort. Sites change, and some (YouTube in particular) may show ads again until the lists catch up.

## Signing in to Google

Google does not allow signing in to a Google Account from browsers built on an embedded framework, and SIDB is one.
This is Google's rule (since 2021), not a problem with your account. When Google shows "Couldn't sign you in", SIDB
explains it in a strip above the page:

- For your Google Account, "Continue in default browser" opens the sign-in in your normal browser (Chrome, Edge,
  Firefox...).
- For "Sign in with Google" on another website, the button opens that website in your default browser, where you can
  sign in.

You are then signed in **in that browser, not in SIDB**. Google services you don't sign in to (Search, YouTube without
an account, Maps) work normally in SIDB. Websites with their own login work normally too.

## SIDB AI

The assistant (sidebar > AI Assistant, or the AI button) uses an NVIDIA-hosted model with **your own API key**:

1. Create a key at build.nvidia.com.
2. Settings > SIDB AI: paste the key and press "Test connection". The key is encrypted by your operating system and is
   never shown again.

Page actions (Summarize, Explain and so on) send the page's text to NVIDIA only when you press them; plain chat sends
only what you type. Private windows never share page text. Chats are saved on this computer only. NVIDIA's free tier is
rate limited and meant for personal use.

## Bookmarks, history, downloads

- The star in the toolbar bookmarks the page. Bookmarks can be organised in folders, pinned to the bookmarks bar
  (Ctrl+Shift+B shows the bar) and imported or exported as an HTML file that other browsers understand.
- History can be searched and cleared by time range.
- Downloads can be paused, resumed, retried and opened. Settings > Downloads chooses the folder.

## Profiles and backups

Each profile has its own bookmarks, history, settings, cookies and logins. Add one in the sidebar (Profiles, +) or in
Settings > Profiles; each opens in its own window.

Settings > Backup and restore keeps the 5 newest daily automatic backups and lets you back up now, export a backup file
and import one. Backups contain bookmarks, history, download records, settings, shortcuts and site permissions;
**never** cookies, logins, API keys or AI chats.

## Appearance

Settings > Appearance: dark, light or system theme; accent colour; New Tab background (including your own picture);
clock, recent pages and quick actions on the New Tab page; which sidebar and toolbar items are shown.

## Performance

Settings > Performance shows the memory SIDB and each tab uses, lets you sleep tabs, and has a "Use hardware
acceleration" switch (takes effect after a restart). When your computer runs low on memory, a strip offers to sleep
background tabs. On battery power SIDB turns off blur and animations. If the graphics process keeps crashing, SIDB turns
hardware acceleration off for the next start and says so in this panel.

## Updates

Settings > About and updates shows your version and checks GitHub Releases for a newer one (automatically once a day,
or "Check now"). When there is one, "Open release page" opens it in a tab. Download the installer there and run it;
your data stays. SIDB never downloads or installs updates by itself.

## Keyboard shortcuts

| Action | Keys |
|---|---|
| Command palette | Ctrl+K or Ctrl+Shift+P |
| Search open tabs | Ctrl+Shift+A |
| New tab / close tab | Ctrl+T / Ctrl+W |
| Reopen closed tab | Ctrl+Shift+T |
| New private window | Ctrl+Shift+N |
| Address bar | Ctrl+L |
| Find in page | Ctrl+F |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Go to tab 1 to 8, last tab | Ctrl+1 to 8, Ctrl+9 |
| Reload | Ctrl+R or F5 |
| Back / forward | Alt+Left / Alt+Right |
| Zoom in / out / reset | Ctrl + / Ctrl - / Ctrl 0 |
| Toggle sidebar | Ctrl+B |
| Toggle bookmarks bar | Ctrl+Shift+B |
| Screenshot | Ctrl+Shift+S |
| Full screen | F11 |

Shortcuts can't be changed yet.

## Troubleshooting

- **A page looks broken:** turn Shield off for that site (shield icon > turn off for this site) and reload.
- **Pages flicker or stay blank:** Settings > Performance > turn off hardware acceleration, then restart SIDB.
- **"Couldn't sign you in" on Google:** see "Signing in to Google" above.
- **Windows says "Unknown publisher":** the installer is not code-signed. Check the SHA-256 checksum from the release
  page before running it (see the README).
- **Start fresh without losing data:** close SIDB and rename the data folder (`%APPDATA%\SIDB` on Windows,
  `~/.config/SIDB` on Linux). Renaming it back restores everything.

## Not built yet

Tab drag-and-drop, a keyboard shortcut editor, Picture-in-Picture and Reader mode, third-party cookie blocking,
renaming or deleting profiles, a screen to review saved site permissions, and automatic installation of updates.
