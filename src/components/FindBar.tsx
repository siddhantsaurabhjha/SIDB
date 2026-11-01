import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { selectActiveTab, useTabs } from "../store/tabs";
import { useUi } from "../store/ui";

/** Find-in-page strip. Lives above the page area so it never sits underneath the web view. */
export function FindBar() {
  const tab = useTabs(selectActiveTab);
  const result = useTabs((s) => s.findResult);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const tabId = tab?.id;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      // Clear highlights on whichever tab was searched when the bar closes or the tab changes.
      if (tabId) void window.sidb.find.stop(tabId);
    };
  }, [tabId]);

  const close = () => useUi.getState().setFindOpen(false);
  const run = (value: string, opts?: { forward?: boolean; findNext?: boolean }) => {
    if (!tabId) return;
    if (value) void window.sidb.find.start(tabId, value, opts);
    else void window.sidb.find.stop(tabId);
  };

  const mine = result && result.tabId === tabId && text ? result : null;

  return (
    <div role="search" className="glass flex h-11 shrink-0 items-center gap-2 border-x-0 border-t-0 px-3">
      <input
        ref={inputRef}
        value={text}
        aria-label="Find in page"
        placeholder="Find in page"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          run(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") run(text, { forward: !e.shiftKey, findNext: true });
          if (e.key === "Escape") close();
        }}
        className="h-8 w-64 rounded-lg border border-line bg-black/30 px-3 text-[13px] outline-none focus:border-accent/60"
      />
      <span className="min-w-14 text-[12px] text-muted" aria-live="polite">
        {text ? (mine ? (mine.matches ? `${mine.activeMatchOrdinal}/${mine.matches}` : "No results") : "…") : ""}
      </span>
      <button aria-label="Previous match" className="icon-btn" disabled={!text} onClick={() => run(text, { forward: false, findNext: true })}>
        <ChevronUp size={16} />
      </button>
      <button aria-label="Next match" className="icon-btn" disabled={!text} onClick={() => run(text, { forward: true, findNext: true })}>
        <ChevronDown size={16} />
      </button>
      <button aria-label="Close find" className="icon-btn ml-auto" onClick={close}>
        <X size={16} />
      </button>
    </div>
  );
}
