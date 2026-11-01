import { FileText, Globe, ListChecks, MessageSquare, Plus, Sparkles, Trash2 } from "lucide-react";
import { useMemo } from "react";
import type { AiConversation } from "../../shared/types/ai";
import { ChatView, useAiStatus } from "../components/ai/ChatView";
import { useLive } from "../hooks/useLive";
import { useAi } from "../store/ai";
import { useTabs } from "../store/tabs";

function groupConversations(list: AiConversation[]): Array<{ label: string; items: AiConversation[] }> {
  const startOfDay = (ts: number) => new Date(new Date(ts).getFullYear(), new Date(ts).getMonth(), new Date(ts).getDate()).getTime();
  const today = startOfDay(Date.now());
  const groups = new Map<string, AiConversation[]>();
  for (const c of list) {
    const diff = Math.round((today - startOfDay(c.updatedAt)) / 86_400_000);
    const label = diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : diff <= 7 ? "Previous 7 days" : "Older";
    groups.set(label, [...(groups.get(label) ?? []), c]);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}

/** Full-screen AI workspace (sidb://ai): saved chats, the conversation, and page context. */
export function AiPage() {
  const isPrivate = useTabs((s) => s.isPrivate);
  const conversationId = useAi((s) => s.conversationId);
  const status = useAiStatus();
  const list = useLive(() => window.sidb.data.ai.conversations(), ["ai"]);
  const groups = useMemo(() => groupConversations(list.data ?? []), [list.data]);
  const page = status.data?.page;
  const busy = useAi((s) => s.activeRequestId !== null);
  const actionDisabled = !page || busy;

  return (
    <div className="absolute inset-0 flex bg-page-ai">
      <aside aria-label="Chats" className="glass hidden w-64 shrink-0 flex-col border-y-0 border-l-0 p-3 md:flex">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles size={20} className="text-accent" />
          <div>
            <div className="font-semibold leading-tight">SIDB AI</div>
            <div className="text-[11px] text-muted">Your smart browsing assistant</div>
          </div>
        </div>
        <button className="mb-3 flex h-9 items-center justify-center gap-2 rounded-xl bg-accent text-[13px] font-semibold hover:brightness-110" onClick={() => useAi.getState().newChat()}>
          <Plus size={15} /> New Chat
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isPrivate && <p className="text-[11px] text-muted">Chats in private windows are not saved.</p>}
          {groups.map((g) => (
            <div key={g.label} className="mb-3">
              <div className="mb-1 px-1 text-[11px] font-semibold text-muted">{g.label}</div>
              {g.items.map((c) => (
                <div key={c.id} className={`group flex items-center rounded-lg ${c.id === conversationId ? "bg-accent/25" : "hover:bg-white/5"}`}>
                  <button className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[12px]" onClick={() => void useAi.getState().openConversation(c.id)} title={c.title}>
                    <MessageSquare size={13} className="shrink-0 text-muted" />
                    <span className="truncate">{c.title}</span>
                  </button>
                  <button
                    aria-label={`Delete chat ${c.title}`}
                    className="icon-btn !h-6 !w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => {
                      if (c.id === conversationId) useAi.getState().newChat();
                      void window.sidb.data.ai.deleteConversation({ id: c.id });
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          ))}
          {!isPrivate && list.data?.length === 0 && <p className="text-[11px] text-muted">No saved chats yet.</p>}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <ChatView variant="workspace" />
      </main>

      <aside aria-label="Page context" className="glass hidden w-72 shrink-0 flex-col gap-3 border-y-0 border-r-0 p-3 xl:flex">
        <section className="rounded-xl border border-line bg-white/5 p-3">
          <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold">
            <Globe size={13} className="text-accent" /> Current page
          </h2>
          {page ? (
            <>
              <div className="truncate text-[13px]" title={page.title}>
                {page.title || page.host}
              </div>
              <div className="mb-2 truncate text-[11px] text-muted">{page.host}</div>
              <button disabled={actionDisabled} className="h-8 w-full rounded-lg bg-accent text-[12px] font-semibold disabled:opacity-40" onClick={() => useAi.getState().send({ action: "summarize", text: "", label: `Summarize this page: ${page.title || page.host}`, usePage: true })}>
                Summarize this page
              </button>
            </>
          ) : (
            <p className="text-[12px] text-muted">{isPrivate ? "Private windows never share page content with AI." : "Switch to a web page tab to use page actions. Nothing is read until you ask."}</p>
          )}
        </section>
        <section className="rounded-xl border border-line bg-white/5 p-3">
          <h2 className="mb-2 text-[12px] font-semibold">Quick tools</h2>
          <button disabled={actionDisabled} className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12px] hover:bg-white/10 disabled:opacity-40" onClick={() => useAi.getState().send({ action: "key-points", text: "", label: "Key points of this page", usePage: true })}>
            <ListChecks size={14} className="text-accent" /> Find key points
          </button>
          <button disabled={actionDisabled} className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12px] hover:bg-white/10 disabled:opacity-40" onClick={() => useAi.getState().send({ action: "explain", text: "", label: "Explain the selected text", useSelection: true })}>
            <FileText size={14} className="text-accent" /> Explain selected text
          </button>
        </section>
      </aside>
    </div>
  );
}
