import { Copy, FileText, Languages, ListChecks, MessageCircleQuestion, PenLine, Send, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AiAction } from "../../../shared/types/ai";
import { useLive } from "../../hooks/useLive";
import { selectActiveTab, useTabs } from "../../store/tabs";
import { useAi, type ChatMsg } from "../../store/ai";
import { KeySetup } from "./KeySetup";
import { Markdown } from "./Markdown";

export const LANGUAGES = ["English", "Hindi", "Bengali", "Tamil", "Telugu", "Marathi", "Gujarati", "Spanish", "French", "German", "Portuguese", "Japanese", "Chinese"];
export const TONES: Array<[string, string]> = [
  ["improve", "Improve"],
  ["formal", "Formal"],
  ["casual", "Casual"],
  ["shorter", "Shorter"],
  ["longer", "Longer"],
];

/** Status of the key, model and current page. Refreshes when the tab or settings change. */
export function useAiStatus() {
  const tab = useTabs(selectActiveTab);
  return useLive(() => window.sidb.data.ai.status(), ["settings"], [tab?.id, tab?.url, tab?.title, tab?.loading]);
}

function openSettings(tabId: string | undefined) {
  if (tabId) void window.sidb.tabs.navigate(tabId, "sidb://settings");
}

function Message({ m, onSettings }: { m: ChatMsg; onSettings: () => void }) {
  if (m.role === "user") {
    return (
      <div className="ml-auto max-w-[88%] select-text whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent/30 px-3.5 py-2 text-[13px]">{m.content}</div>
    );
  }
  return (
    <div className="max-w-full">
      {m.content ? <Markdown text={m.content} /> : m.status === "streaming" ? <span className="text-[12px] text-muted" aria-live="polite">Thinking...</span> : null}
      {m.status === "streaming" && m.content && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-accent align-middle" aria-hidden />}
      {m.status === "stopped" && <div className="mt-1 text-[11px] text-muted">Stopped.</div>}
      {m.error && (
        <div role="alert" className="mt-1 rounded-lg border border-red-400/40 bg-red-400/10 p-2.5 text-[12px] text-red-200">
          {m.error.message}
          {m.error.retryAfterSeconds ? ` (try again in about ${m.error.retryAfterSeconds}s)` : ""}
          {(m.error.kind === "auth" || m.error.kind === "no-key" || m.error.kind === "model") && (
            <button className="ml-2 underline" onClick={onSettings}>
              Open AI settings
            </button>
          )}
        </div>
      )}
      {m.status === "done" && m.content && (
        <div className="mt-1 flex items-center gap-3 text-[11px] text-muted">
          <button className="flex items-center gap-1 hover:text-fg" aria-label="Copy answer" onClick={() => void navigator.clipboard.writeText(m.content)}>
            <Copy size={11} /> Copy
          </button>
          {m.note && <span>{m.note}</span>}
        </div>
      )}
    </div>
  );
}

function ActionButton({ icon, label, onClick, disabled, title }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className="flex items-center gap-2 rounded-xl border border-line bg-white/5 px-3 py-2 text-left text-[12px] hover:border-accent/50 hover:bg-white/10 disabled:opacity-40">
      <span className="text-accent">{icon}</span>
      {label}
    </button>
  );
}

/** Shared chat surface used by the side panel and the full workspace. */
export function ChatView({ variant }: { variant: "panel" | "workspace" }) {
  const tab = useTabs(selectActiveTab);
  const isPrivate = useTabs((s) => s.isPrivate);
  const { messages, activeRequestId, usePage, setUsePage, send, stop } = useAi();
  const status = useAiStatus();
  const [draft, setDraft] = useState("");
  const [language, setLanguage] = useState("English");
  const [tone, setTone] = useState("improve");
  const endRef = useRef<HTMLDivElement>(null);
  const busy = activeRequestId !== null;
  const s = status.data;
  const pageOk = !!s?.page && s.pageContextAllowed;

  // Braces matter: some Chromium versions return a Promise from scrollIntoView, and an effect must not return one.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    send({ action: usePage && pageOk ? "ask-page" : "chat", text, usePage: usePage && pageOk });
  };

  const pageAction = (action: AiAction, label: string) => send({ action, text: "", label, usePage: true });
  const needsKey = s && !s.keySet;
  const pageTitle = s?.page?.title || s?.page?.host || "";

  const actions = (
    <div className={variant === "workspace" ? "grid grid-cols-2 gap-2 sm:grid-cols-3" : "grid grid-cols-2 gap-2"}>
      <ActionButton icon={<FileText size={15} />} label="Summarize page" disabled={!pageOk || busy} title={!pageOk ? (isPrivate ? "Private windows don't share pages with AI" : "Open a web page first") : undefined} onClick={() => pageAction("summarize", `Summarize this page${pageTitle ? `: ${pageTitle}` : ""}`)} />
      <ActionButton icon={<ListChecks size={15} />} label="Key points" disabled={!pageOk || busy} onClick={() => pageAction("key-points", `Key points of this page${pageTitle ? `: ${pageTitle}` : ""}`)} />
      <ActionButton icon={<Sparkles size={15} />} label="Explain selection" disabled={!pageOk || busy} title="Select text on the page first" onClick={() => send({ action: "explain", text: "", label: "Explain the selected text", useSelection: true })} />
      <ActionButton
        icon={<MessageCircleQuestion size={15} />}
        label="Ask about page"
        disabled={!pageOk || busy}
        onClick={() => {
          setUsePage(true);
          document.getElementById(`ai-input-${variant}`)?.focus();
        }}
      />
      <ActionButton icon={<Languages size={15} />} label={`Translate to ${language}`} disabled={busy} onClick={() => {
          send({ action: "translate", text: draft.trim(), label: `Translate to ${language}${draft.trim() ? `: ${draft.trim().slice(0, 80)}` : " (selected text)"}`, useSelection: !draft.trim(), language });
          setDraft("");
        }}
      />
      <ActionButton icon={<PenLine size={15} />} label="Rewrite" disabled={busy} onClick={() => {
          send({ action: "rewrite", text: draft.trim(), label: `Rewrite (${tone}): ${draft.trim().slice(0, 80) || "selected text"}`, useSelection: !draft.trim(), tone });
          setDraft("");
        }}
      />
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" role="log" aria-label="Conversation" aria-live="polite">
        {needsKey && <KeySetup compact={variant === "panel"} />}
        {messages.length === 0 && !needsKey && (
          <div className={variant === "workspace" ? "mx-auto flex max-w-2xl flex-col items-center gap-3 pt-6 text-center" : "space-y-3"}>
            {variant === "workspace" && (
              <>
                <Sparkles size={40} className="text-accent" />
                <h1 className="text-2xl font-semibold">Hello, I'm SIDB AI</h1>
              </>
            )}
            <p className="text-[12px] text-muted">Ask anything, or work with the page you're on. Page text is only shared when you use a page action or switch on "Current page".</p>
            <div className="w-full text-left">{actions}</div>
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} m={m} onSettings={() => openSettings(tab?.id)} />
        ))}
        <div ref={endRef} />
      </div>

      <div className="space-y-2 border-t border-line p-3">
        {messages.length > 0 && !needsKey && <div className="hidden xl:block">{variant === "workspace" ? actions : null}</div>}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <label className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 ${usePage && pageOk ? "border-accent bg-accent/20 text-fg" : "border-line"} ${!pageOk ? "opacity-50" : ""}`} title={isPrivate ? "Private windows never share page content" : undefined}>
            <input type="checkbox" checked={usePage && pageOk} disabled={!pageOk} onChange={(e) => setUsePage(e.target.checked)} />
            Current page{usePage && pageOk && pageTitle ? `: ${pageTitle.slice(0, 28)}` : ""}
          </label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Translate to" className="h-7 rounded-lg border border-line bg-panel-solid px-1.5 text-[11px]">
            {LANGUAGES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <select value={tone} onChange={(e) => setTone(e.target.value)} aria-label="Rewrite style" className="h-7 rounded-lg border border-line bg-panel-solid px-1.5 text-[11px]">
            {TONES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            id={`ai-input-${variant}`}
            value={draft}
            rows={variant === "panel" ? 2 : 3}
            maxLength={8000}
            disabled={needsKey}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={needsKey ? "Add your NVIDIA API key first" : usePage && pageOk ? "Ask about this page..." : "Ask SIDB AI anything..."}
            aria-label="Message SIDB AI"
            className="min-h-10 flex-1 resize-none rounded-xl border border-line bg-black/30 px-3 py-2 text-[13px] outline-none focus:border-accent/60"
          />
          {busy ? (
            <button aria-label="Stop" className="grid h-10 w-10 place-items-center rounded-xl bg-red-500/80 hover:brightness-110" onClick={stop}>
              <Square size={15} />
            </button>
          ) : (
            <button aria-label="Send" disabled={!draft.trim() || needsKey} className="grid h-10 w-10 place-items-center rounded-xl bg-accent hover:brightness-110 disabled:opacity-40" onClick={submit}>
              <Send size={16} />
            </button>
          )}
        </div>
        <p className="text-[10px] text-muted">Answers come from NVIDIA's hosted model and can be wrong. Check important facts.</p>
      </div>
    </div>
  );
}
