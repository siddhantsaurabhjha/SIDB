import { Plus, VenetianMask } from "lucide-react";
import logoMark from "../assets/logo-mark.png";
import { useTabs } from "../store/tabs";
import { useUi } from "../store/ui";
import { TabStrip } from "./TabStrip";

/** Top strip: brand + (in horizontal layout) the tab strip. Doubles as the window drag region. */
export function TitleBar() {
  const isPrivate = useTabs((s) => s.isPrivate);
  const layout = useUi((s) => s.tabLayout);

  return (
    <div className="drag flex h-10 shrink-0 items-center gap-2 border-b border-line bg-black/30 pl-3" style={{ paddingRight: 150 }}>
      <div className="flex items-center gap-2 pr-2">
        <img src={logoMark} alt="" width={24} height={24} draggable={false} className="rounded-md" />
        <span className="text-[12px] font-semibold tracking-wide">SIDB</span>
        {isPrivate && (
          <span className="flex items-center gap-1 rounded-full bg-accent/25 px-2 py-0.5 text-[10px] font-semibold text-fg">
            <VenetianMask size={12} /> Private
          </span>
        )}
      </div>

      {layout === "horizontal" ? (
        <div role="tablist" className="flex min-w-0 flex-1 items-center gap-1">
          <TabStrip />
          <button aria-label="New tab" className="icon-btn no-drag" onClick={() => void window.sidb.tabs.create()}>
            <Plus size={16} />
          </button>
        </div>
      ) : (
        <div className="flex-1" />
      )}
    </div>
  );
}
