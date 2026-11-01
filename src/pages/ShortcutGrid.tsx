import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Shortcut } from "../../shared/types/data";
import { useLive } from "../hooks/useLive";
import { SiteIcon } from "../components/PageShell";

// Shown until the user adds their own shortcuts.
const DEFAULTS: Array<{ title: string; url: string }> = [
  { title: "YouTube", url: "https://www.youtube.com" },
  { title: "ChatGPT", url: "https://chatgpt.com" },
  { title: "GitHub", url: "https://github.com" },
  { title: "Google", url: "https://www.google.com" },
  { title: "Notion", url: "https://www.notion.so" },
];

const errMsg = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "") : String(e));

/** User-managed shortcut tiles (stored per profile). Add, edit and delete. */
export function ShortcutGrid({ onOpen, editable = true }: { onOpen: (url: string) => void; editable?: boolean }) {
  const api = window.sidb.data.shortcuts;
  const { data } = useLive(() => api.list(), ["shortcuts"]);
  const [form, setForm] = useState<{ id?: string; title: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items: Array<Partial<Shortcut> & { title: string; url: string }> = data && data.length > 0 ? data : DEFAULTS;
  const custom = !!data && data.length > 0;

  const save = async () => {
    if (!form) return;
    const url = /^https?:\/\//i.test(form.url.trim()) ? form.url.trim() : `https://${form.url.trim()}`;
    try {
      if (form.id) await api.update({ id: form.id, title: form.title, url });
      else {
        // First custom shortcut replaces the defaults, so seed with them first to avoid losing them.
        if (!custom) for (const d of DEFAULTS) await api.add(d);
        await api.add({ title: form.title, url });
      }
      setForm(null);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-4">
        {items.map((s) => (
          <div key={s.id ?? s.url} className="group relative">
            <button onClick={() => onOpen(s.url)} title={s.url} className="glass flex h-24 w-24 flex-col items-center justify-center gap-2 rounded-2xl hover:border-accent/50">
              <SiteIcon url={s.url} size={36} />
              <span className="w-20 truncate text-[11px]">{s.title}</span>
            </button>
            {editable && custom && s.id && (
              <div className="absolute right-0.5 top-0.5 flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                <button aria-label={`Edit ${s.title}`} className="icon-btn !h-6 !w-6" onClick={() => setForm({ id: s.id, title: s.title, url: s.url })}>
                  <Pencil size={12} />
                </button>
                <button aria-label={`Delete ${s.title}`} className="icon-btn !h-6 !w-6" onClick={() => void api.remove({ id: s.id! })}>
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </div>
        ))}
        {editable && (
          <button onClick={() => setForm({ title: "", url: "" })} className="glass flex h-24 w-24 flex-col items-center justify-center gap-2 rounded-2xl text-muted hover:text-fg">
            <Plus size={20} />
            <span className="text-[11px]">Add Shortcut</span>
          </button>
        )}
      </div>

      {form && (
        <form
          className="glass flex flex-wrap items-center gap-2 rounded-xl p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Name" aria-label="Shortcut name" className="h-8 w-36 rounded-lg border border-line bg-black/30 px-2 text-[12px]" />
          <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="example.com" aria-label="Shortcut address" className="h-8 w-56 rounded-lg border border-line bg-black/30 px-2 text-[12px]" />
          <button type="submit" className="h-8 rounded-lg bg-accent px-3 text-[12px] font-semibold">
            Save
          </button>
          <button type="button" className="h-8 rounded-lg border border-line px-3 text-[12px]" onClick={() => setForm(null)}>
            Cancel
          </button>
          {error && <span className="w-full text-[11px] text-red-300">{error}</span>}
        </form>
      )}
    </div>
  );
}
