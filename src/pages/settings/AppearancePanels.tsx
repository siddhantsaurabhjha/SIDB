import { useState, type ReactNode } from "react";
import { ACCENT_PRESETS, SIDEBAR_ITEMS, TOOLBAR_ITEMS, type Settings } from "../../../shared/types/data";
import { Btn, Chip, Panel, Toggle } from "../../components/PageShell";
import { useUi } from "../../store/ui";

const set = (patch: Partial<Settings>) => void window.sidb.data.settings.set({ patch });


function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-0">
      <div className="mr-auto min-w-40">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="text-[11px] text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

const SIDEBAR_LABELS: Record<(typeof SIDEBAR_ITEMS)[number], string> = { bookmarks: "Bookmarks", history: "History", downloads: "Downloads", shield: "Shield", ai: "AI Assistant" };
const TOOLBAR_LABELS: Record<(typeof TOOLBAR_ITEMS)[number], string> = { bookmark: "Bookmark star", downloads: "Downloads", shield: "Shield", layout: "Tab layout switch", sidebar: "Sidebar toggle", ai: "AI button" };
const BACKGROUNDS: Array<[Settings["newTabBackground"], string]> = [
  ["scenery", "Scenery"],
  ["aurora", "Aurora"],
  ["midnight", "Midnight"],
  ["dusk", "Dusk"],
  ["custom", "My image"],
];

const SHORTCUTS: Array<[string, string]> = [
  ["Command palette", "Ctrl+K or Ctrl+Shift+P"],
  ["Search open tabs", "Ctrl+Shift+A"],
  ["New tab / Close tab", "Ctrl+T / Ctrl+W"],
  ["Reopen closed tab", "Ctrl+Shift+T"],
  ["New private window", "Ctrl+Shift+N"],
  ["Address bar", "Ctrl+L"],
  ["Find in page", "Ctrl+F"],
  ["Next / previous tab", "Ctrl+Tab / Ctrl+Shift+Tab"],
  ["Go to tab 1 to 8, last tab", "Ctrl+1 to 8, Ctrl+9"],
  ["Reload", "Ctrl+R or F5"],
  ["Back / forward", "Alt+Left / Alt+Right"],
  ["Zoom in / out / reset", "Ctrl + / Ctrl - / Ctrl 0"],
  ["Toggle sidebar", "Ctrl+B"],
  ["Toggle bookmarks bar", "Ctrl+Shift+B"],
  ["Screenshot", "Ctrl+Shift+S"],
  ["Full screen", "F11"],
];

/** Theme, accent, New Tab look, and which sidebar and toolbar items are shown. */
export function AppearancePanels() {
  const s = useUi((st) => st.settings);
  const [custom, setCustom] = useState(s.accent);
  const [note, setNote] = useState<string | null>(null);

  const toggleIn = <T extends string>(list: readonly T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  return (
    <>
      <Panel title="Appearance">
        <Row label="Theme" hint="System follows your operating system.">
          <div className="flex gap-2">
            {(["dark", "light", "system"] as const).map((t) => (
              <Chip key={t} active={s.theme === t} onClick={() => set({ theme: t })}>
                {t[0].toUpperCase() + t.slice(1)}
              </Chip>
            ))}
          </div>
        </Row>
        <Row label="Accent colour">
          <div className="flex flex-wrap items-center gap-2">
            {ACCENT_PRESETS.map((c) => (
              <button
                key={c}
                aria-label={`Accent ${c}`}
                aria-pressed={s.accent.toLowerCase() === c}
                onClick={() => {
                  setCustom(c);
                  set({ accent: c });
                }}
                className={`h-6 w-6 rounded-full border-2 ${s.accent.toLowerCase() === c ? "border-fg" : "border-transparent"}`}
                style={{ background: c }}
              />
            ))}
            <input type="color" value={custom} aria-label="Custom accent colour" onChange={(e) => setCustom(e.target.value)} onBlur={() => custom !== s.accent && set({ accent: custom })} className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent" />
          </div>
        </Row>
        <Row label="Show bookmarks bar" hint="Shows the bookmarks you pinned. Ctrl+Shift+B toggles it.">
          <Toggle label="Show bookmarks bar" checked={s.bookmarksBar} onChange={(v) => set({ bookmarksBar: v })} />
        </Row>
      </Panel>

      <Panel title="New Tab page">
        <Row label="Background">
          <div className="flex flex-wrap gap-2">
            {BACKGROUNDS.map(([id, label]) => (
              <Chip key={id} active={s.newTabBackground === id} onClick={() => (id === "custom" ? void window.sidb.data.appearance.pickWallpaper().then((r) => setNote(r.ok || r.message === "Cancelled." ? null : r.message)) : set({ newTabBackground: id }))}>
                {label}
              </Chip>
            ))}
          </div>
        </Row>
        {s.newTabBackground === "custom" && (
          <div className="flex gap-2 py-2">
            <Btn onClick={() => void window.sidb.data.appearance.pickWallpaper().then((r) => setNote(r.ok || r.message === "Cancelled." ? null : r.message))}>Choose another image</Btn>
            <Btn danger onClick={() => void window.sidb.data.appearance.clearWallpaper()}>
              Remove image
            </Btn>
          </div>
        )}
        {note && <p role="status" className="text-[11px] text-amber-300">{note}</p>}
        <p className="pb-2 text-[11px] text-muted">Images up to 8 MB (PNG, JPEG or WebP). The picture stays on this device, in this profile.</p>
        <Row label="Website icons" hint="Logos shown on shortcuts, bookmarks, history and suggestions are saved on this device, in this profile, and fetched only from the sites themselves.">
          <Btn onClick={() => void window.sidb.data.favicon.clear().then((n) => setNote(n ? "Saved website icons cleared. They will be fetched again when needed." : "There were no saved icons."))}>Clear saved icons</Btn>
        </Row>
        <Row label="Clock">
          <Toggle label="Show clock" checked={s.newTabClock} onChange={(v) => set({ newTabClock: v })} />
        </Row>
        <Row label="Continue browsing" hint="Your most recent pages.">
          <Toggle label="Show continue browsing" checked={s.newTabContinue} onChange={(v) => set({ newTabContinue: v })} />
        </Row>
        <Row label="Quick actions">
          <Toggle label="Show quick actions" checked={s.newTabQuickActions} onChange={(v) => set({ newTabQuickActions: v })} />
        </Row>
      </Panel>

      <Panel title="Sidebar and toolbar">
        <p className="mb-2 text-[11px] text-muted">Hide what you don't use. Everything stays available from the command palette (Ctrl+K).</p>
        <div className="mb-3">
          <div className="mb-1 text-[12px] font-semibold">Sidebar items</div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {SIDEBAR_ITEMS.map((item) => (
              <label key={item} className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={!s.hiddenSidebarItems.includes(item)} onChange={() => set({ hiddenSidebarItems: toggleIn(s.hiddenSidebarItems, item) })} /> {SIDEBAR_LABELS[item]}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[12px] font-semibold">Toolbar buttons</div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {TOOLBAR_ITEMS.map((item) => (
              <label key={item} className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={!s.hiddenToolbarItems.includes(item)} onChange={() => set({ hiddenToolbarItems: toggleIn(s.hiddenToolbarItems, item) })} /> {TOOLBAR_LABELS[item]}
              </label>
            ))}
          </div>
        </div>
      </Panel>
    </>
  );
}

export function ShortcutsPanel() {
  return (
    <Panel title="Keyboard shortcuts">
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[12px]">
        {SHORTCUTS.map(([name, keys]) => (
          <div key={name} className="contents">
            <dt className="text-muted">{name}</dt>
            <dd className="text-right font-mono text-[11px]">{keys}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-muted">Shortcuts can't be changed yet.</p>
    </Panel>
  );
}
