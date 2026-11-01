import { Maximize2, Plus, Sparkles, X } from "lucide-react";
import { selectActiveTab, useTabs } from "../store/tabs";
import { useAi } from "../store/ai";
import { useUi } from "../store/ui";
import { ChatView } from "./ai/ChatView";

/** Quick AI side panel next to the page. The full workspace is the sidb://ai page. */
export function AiPanel() {
  const tab = useTabs(selectActiveTab);
  return (
    <aside aria-label="SIDB AI" className="glass flex w-96 shrink-0 flex-col border-y-0 border-r-0">
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        <Sparkles size={16} className="text-accent" />
        <span className="mr-auto font-semibold">SIDB AI</span>
        <button aria-label="New chat" title="New chat" className="icon-btn" onClick={() => useAi.getState().newChat()}>
          <Plus size={16} />
        </button>
        <button aria-label="Open full workspace" title="Open full workspace" className="icon-btn" onClick={() => tab && void window.sidb.tabs.navigate(tab.id, "sidb://ai")}>
          <Maximize2 size={15} />
        </button>
        <button aria-label="Close AI panel" className="icon-btn" onClick={() => useUi.getState().toggleAiPanel()}>
          <X size={16} />
        </button>
      </div>
      <ChatView variant="panel" />
    </aside>
  );
}
