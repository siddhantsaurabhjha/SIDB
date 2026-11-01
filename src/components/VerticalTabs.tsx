import { Plus } from "lucide-react";
import { TabStrip } from "./TabStrip";

export function VerticalTabs() {
  return (
    <aside aria-label="Tabs" className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-black/20 p-2">
      <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-1">
        <TabStrip vertical />
      </div>
      <button className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-[12px] text-muted hover:bg-white/5" onClick={() => void window.sidb.tabs.create()}>
        <Plus size={14} /> New tab
      </button>
    </aside>
  );
}
