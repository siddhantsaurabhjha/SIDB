import type { ReactNode } from "react";

/** Common frame for the internal management pages (history, bookmarks, downloads, settings). */
export function PageShell({ icon, title, subtitle, actions, children }: { icon: ReactNode; title: string; subtitle: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="absolute inset-0 overflow-auto bg-page p-6">
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex flex-wrap items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-xl border border-line bg-white/5 text-accent">{icon}</div>
          <div className="mr-auto">
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="text-muted">{subtitle}</p>
          </div>
          {actions}
        </header>
        {children}
      </div>
    </div>
  );
}

export function Panel({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`glass rounded-2xl p-4 ${className}`}>
      {title && <h2 className="mb-3 text-[13px] font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Chip({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`h-8 rounded-lg border px-3 text-[12px] ${active ? "border-accent bg-accent/30 text-fg" : "border-line text-muted hover:text-fg"}`}
    >
      {children}
    </button>
  );
}

export function Btn({ children, onClick, danger, primary, disabled, title, submit }: { children: ReactNode; onClick: () => void; danger?: boolean; primary?: boolean; disabled?: boolean; title?: string; submit?: boolean }) {
  return (
    <button
      type={submit ? "submit" : "button"}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] disabled:opacity-40 ${
        primary ? "border-accent bg-accent font-semibold hover:brightness-110" : danger ? "border-red-400/40 text-red-300 hover:bg-red-400/10" : "border-line hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

/** A website's real icon with a letter fallback. See Favicon. */
export { Favicon as SiteIcon } from "./Favicon";

/** On/off switch. The knob is always white, whatever the theme. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-white/15"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#ffffff] shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}
