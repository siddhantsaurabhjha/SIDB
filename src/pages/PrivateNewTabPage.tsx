import { EyeOff, Search, ShieldCheck, VenetianMask } from "lucide-react";
import { useState } from "react";
import privateBg from "../assets/private-bg.jpg";
import { selectActiveTab, useTabs } from "../store/tabs";
import { ShortcutGrid } from "./ShortcutGrid";

const FACTS = [
  "Browsing history is not saved",
  "Cookies and site data live in a separate temporary session",
  "Everything is cleared when you close this window",
  "Files you download stay on your device",
];

export function PrivateNewTabPage() {
  const tab = useTabs(selectActiveTab);
  const go = (input: string) => tab && void window.sidb.tabs.navigate(tab.id, input);
  const [query, setQuery] = useState("");

  return (
    <div className="force-dark absolute inset-0 overflow-auto bg-cover bg-center" style={{ backgroundImage: `linear-gradient(rgb(7 4 20 / 0.3), rgb(7 4 20 / 0.5)), url(${privateBg})` }}>
      <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center gap-6 p-6 pt-14">
        <VenetianMask size={72} className="text-accent drop-shadow-[0_0_24px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]" />
        <div className="text-center">
          <h1 className="text-4xl font-semibold">
            Private <span className="text-accent">Browsing</span>
          </h1>
          <p className="mt-1 text-muted">Browse freely. Your activity stays private.</p>
        </div>

        <form
          className="glass flex h-12 w-full items-center gap-3 rounded-full px-5 focus-within:border-accent/60"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) go(query);
          }}
        >
          <Search size={17} className="text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search privately or type a URL"
            placeholder="Search privately or type a URL"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted"
          />
        </form>

        <ShortcutGrid onOpen={go} />

        <div className="glass w-full rounded-2xl p-5">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <EyeOff size={18} className="text-accent" /> SIDB won't save your browsing activity
          </div>
          <ul className="space-y-1.5 text-[12px] text-muted">
            {FACTS.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <ShieldCheck size={13} className="shrink-0 text-accent-2" /> {f}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted">Websites, your network and your employer or school can still see your activity. Tracker and ad blocking arrive with SIDB Shield.</p>
        </div>
      </div>
    </div>
  );
}
