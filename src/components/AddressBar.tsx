import { Globe, Loader2, Lock, LockOpen, Search, Star } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SEARCH_ENGINES, type SearchEngineId } from "../../shared/constants/search";
import { combine, type Suggestion, type UrlSuggestion } from "../../shared/suggest";
import { buildSearchUrl } from "../../shared/url";
import { useDialogOverlay } from "../store/dialogs";
import { selectActiveTab, useTabs } from "../store/tabs";
import { useUi } from "../store/ui";
import { SiteIcon } from "./PageShell";

const REMOTE_DEBOUNCE_MS = 250;

type RemoteState = "idle" | "loading" | "error";

/** Bolds the words of the query inside a title. Plain text nodes only, so nothing in a title can become markup. */
function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  if (words.length === 0) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-fg">
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** For engine suggestions: the typed part stays normal and what the engine adds is bold, as in Chrome. */
function Completion({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (q && text.toLowerCase().startsWith(q.toLowerCase())) {
    return (
      <>
        <span>{text.slice(0, q.length)}</span>
        <strong className="font-semibold">{text.slice(q.length)}</strong>
      </>
    );
  }
  return <>{text}</>;
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const rest = `${u.pathname === "/" && !u.search ? "" : u.pathname}${u.search}`;
    return `${u.host.replace(/^www\./, "")}${rest}`;
  } catch {
    return url;
  }
}

/** What goes into the address bar while this row is highlighted with the arrow keys. */
function fillText(item: Suggestion): string {
  if (item.kind === "url") return item.url.replace(/^https:\/\//, "");
  return item.text;
}

function Row({ item, selected, query, engineLabel, index, onPick, onHover }: { item: Suggestion; selected: boolean; query: string; engineLabel: string; index: number; onPick: () => void; onHover: () => void }) {
  let icon: ReactNode;
  let title: ReactNode;
  let detail: ReactNode = null;
  let tag: ReactNode = null;

  if (item.kind === "url") {
    icon = (
      <span className="relative">
        <SiteIcon url={item.url} favicon={item.favicon} size={20} />
        {item.bookmarked && <Star size={9} className="absolute -bottom-1 -right-1 fill-amber-400 text-amber-400" aria-label="Bookmarked" />}
      </span>
    );
    title = <Highlight text={item.title} query={query} />;
    detail = <Highlight text={item.source === "site" || item.source === "popular" ? item.host : pathOf(item.url)} query={query} />;
    tag = item.source === "site" ? "Site" : item.source === "bookmark" ? "Bookmark" : item.source === "popular" ? "Suggested site" : null;
  } else if (item.kind === "typed") {
    icon = <span className="grid h-5 w-5 place-items-center text-muted">{item.isAddress ? <Globe size={16} /> : <Search size={16} />}</span>;
    title = <span className="truncate">{item.text}</span>;
    detail = item.isAddress ? "Go to this address" : `Search ${engineLabel}`;
  } else {
    icon = (
      <span className="grid h-5 w-5 place-items-center rounded-full bg-accent/20 text-accent">
        <Search size={11} />
      </span>
    );
    title = <Completion text={item.text} query={query} />;
    tag = `${engineLabel} search`;
  }

  return (
    <li id={`omni-${index}`} role="option" aria-selected={selected}>
      <button
        type="button"
        tabIndex={-1}
        onMouseMove={onHover}
        onClick={onPick}
        className={`flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors ${selected ? "bg-accent/25" : "hover:bg-white/5"}`}
      >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-fg/90">{title}</span>
          {detail && <span className="block truncate text-[11px] text-muted">{detail}</span>}
        </span>
        {tag && <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted">{tag}</span>}
      </button>
    </li>
  );
}

/** The address bar with Chrome-style suggestions: instant local results, debounced engine suggestions, inline completion. */
export function AddressBar() {
  const tab = useTabs(selectActiveTab);
  const isPrivate = useTabs((s) => s.isPrivate);
  const engine: SearchEngineId = useUi((s) => s.settings.searchEngine);
  const suggestionsOn = useUi((s) => s.settings.searchSuggestions);
  const engineLabel = SEARCH_ENGINES[engine].label;

  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [hover, setHover] = useState<number | null>(null); // mouse highlight only; it never changes the typed text
  const [allowInline, setAllowInline] = useState(false);
  const [local, setLocal] = useState<UrlSuggestion[]>([]);
  const [remote, setRemote] = useState<string[]>([]);
  const [remoteState, setRemoteState] = useState<RemoteState>("idle");
  const localSeq = useRef(0);
  const remoteSeq = useRef(0);
  const api = window.sidb.tabs;
  const suggest = window.sidb.data.suggest;

  const internal = tab?.internal ?? true;
  const currentUrl = internal ? "" : (tab?.url ?? "");
  const query = draft ?? "";
  const typing = draft !== null && query.trim() !== "";

  const combined = useMemo(() => (typing ? combine(query, local, remote) : { items: local.slice(0, 8) as Suggestion[], inline: null }), [typing, query, local, remote]);
  const items = combined.items;
  const inlineText = typing && allowInline && selected === 0 ? combined.inline : null;
  const preview = open && selected > 0 && items[selected] ? fillText(items[selected]) : null;
  const shown = preview ?? inlineText ?? draft ?? currentUrl;

  useDialogOverlay(open && items.length > 0);

  const stopRemote = useCallback(() => {
    remoteSeq.current++;
    void suggest.cancelRemote().catch(() => undefined);
    setRemoteState("idle");
  }, [suggest]);

  const close = useCallback(() => {
    setOpen(false);
    setSelected(0);
    setHover(null);
    stopRemote();
  }, [stopRemote]);

  // A different tab (or the page navigating while you are not editing) puts the current address back.
  useEffect(() => {
    setDraft(null);
    close();
  }, [tab?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(null);
  }, [tab?.url]);

  // Main process forwards Ctrl+L as a window event so it works from web content too.
  useEffect(() => {
    const focus = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("sidb:focus-address", focus);
    return () => window.removeEventListener("sidb:focus-address", focus);
  }, []);

  // Local suggestions: asked for on every change (cheap, nothing leaves the device). Late answers are dropped.
  useEffect(() => {
    if (!open) return;
    const seq = ++localSeq.current;
    void suggest
      .local({ query: query.trim() })
      .then((rows) => seq === localSeq.current && setLocal(rows))
      .catch(() => seq === localSeq.current && setLocal([]));
  }, [open, query, suggest]);

  // Engine suggestions: debounced, cancelled when the text changes, never for an empty or address-like query.
  useEffect(() => {
    if (!open || !typing || !suggestionsOn) {
      setRemote([]);
      setRemoteState("idle");
      return;
    }
    const q = query.trim();
    // Keep earlier answers only while they still fit what is typed; they are replaced as soon as fresh ones arrive.
    setRemote((prev) => prev.filter((s) => s.toLowerCase().startsWith(q.toLowerCase())));
    const seq = ++remoteSeq.current;
    const timer = setTimeout(() => {
      setRemoteState("loading");
      void suggest
        .remote({ query: q })
        .then((r) => {
          if (seq !== remoteSeq.current) return; // a newer keystroke owns the list now
          setRemote(r.suggestions);
          setRemoteState(r.error === "network" || r.error === "bad-response" ? "error" : "idle");
        })
        .catch(() => seq === remoteSeq.current && setRemoteState("error"));
    }, REMOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      void suggest.cancelRemote().catch(() => undefined);
    };
  }, [open, typing, query, suggestionsOn, suggest]);

  // Show the completed part of "youtube.com" as a selection after what was typed.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (inlineText && input && document.activeElement === input) input.setSelectionRange(query.length, inlineText.length);
  }, [inlineText, query.length]);

  const run = (item: Suggestion | undefined, newTab: boolean) => {
    const target = item ?? (query.trim() ? ({ kind: "typed", id: "typed", text: query, isAddress: false } as const) : undefined);
    if (!target || !tab) return;
    const destination = target.kind === "url" ? target.url : target.kind === "search" ? buildSearchUrl(target.text, engine) : target.text;
    close();
    setDraft(null);
    inputRef.current?.blur();
    if (newTab) void api.create({ url: destination, activate: true });
    else void api.navigate(tab.id, destination);
  };

  const acceptInline = () => {
    if (inlineText) {
      setDraft(inlineText);
      setAllowInline(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHover(null);
        if (!open) setOpen(true);
        else setSelected((s) => Math.min(items.length - 1, s + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHover(null);
        setSelected((s) => Math.max(0, s - 1));
        break;
      case "Enter":
        e.preventDefault();
        run(open ? items[selected] : undefined, e.altKey);
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          if (selected > 0) setSelected(0); // first Escape undoes the arrow-key preview
          else close();
        } else {
          setDraft(null);
          inputRef.current?.blur();
        }
        break;
      case "Tab":
        if (inlineText && !e.shiftKey) {
          e.preventDefault();
          acceptInline();
          requestAnimationFrame(() => inputRef.current?.setSelectionRange(inlineText.length, inlineText.length));
        } else {
          close();
        }
        break;
      case "ArrowRight":
      case "End":
        acceptInline();
        break;
    }
  };

  const status = remoteState === "loading" ? "Loading search suggestions" : `${items.length} suggestion${items.length === 1 ? "" : "s"}`;

  return (
    <form
      className="relative mx-1 min-w-0 flex-1"
      onSubmit={(e) => {
        e.preventDefault(); // Enter is handled in onKeyDown so the highlighted row is what opens
      }}
    >
      <div className={`glass flex h-9 items-center gap-2 rounded-full px-3 transition-shadow focus-within:border-accent/60 ${open && items.length > 0 ? "shadow-lg shadow-black/20" : ""}`}>
        {tab?.security === "insecure" ? <LockOpen size={14} className="text-amber-400" aria-label="Not secure" /> : <Lock size={14} className="text-muted" aria-label="Secure" />}
        <input
          ref={inputRef}
          value={shown}
          role="combobox"
          aria-label="Address bar"
          aria-autocomplete="both"
          aria-expanded={open && items.length > 0}
          aria-controls="omnibox-list"
          aria-activedescendant={open && items[selected] ? `omni-${selected}` : undefined}
          placeholder={`Search ${engineLabel} or type a URL`}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-muted"
          onFocus={(e) => {
            e.currentTarget.select();
            window.sidb.layout.prepareOverlay(); // so the dropdown can open over the page without a gap
            setOpen(true);
          }}
          onBlur={() => {
            setDraft(null);
            close();
          }}
          onChange={(e) => {
            const value = e.target.value;
            const deleting = /^delete/.test((e.nativeEvent as InputEvent).inputType ?? "");
            setAllowInline(!deleting && value.length > (draft ?? "").length);
            setDraft(value);
            setSelected(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {remoteState === "loading" && <Loader2 size={14} className="omnibox-spinner shrink-0 animate-spin text-muted" aria-hidden />}
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {open ? status : ""}
      </span>

      {open && items.length > 0 && (
        <div className="omnibox-pop glass absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-2xl p-1.5 shadow-2xl shadow-black/30" onMouseDown={(e) => e.preventDefault() /* keep focus in the input while clicking rows */}>
          <ul id="omnibox-list" role="listbox" aria-label="Suggestions" className="max-h-[26rem] overflow-y-auto">
            {items.map((item, i) => (
              <Row key={item.id} item={item} index={i} selected={i === (hover ?? selected)} query={query} engineLabel={engineLabel} onHover={() => setHover(i)} onPick={() => run(item, false)} />
            ))}
          </ul>
          {(remoteState === "loading" || remoteState === "error") && (
            <div className="flex items-center gap-2 px-3 pb-1 pt-1.5 text-[11px] text-muted">
              {remoteState === "loading" ? (
                <span className="omnibox-delayed">Loading {engineLabel} suggestions...</span>
              ) : (
                <span>{engineLabel} suggestions aren't available right now. Showing your own results.</span>
              )}
            </div>
          )}
          {isPrivate && !typing && <div className="px-3 pb-1 pt-1.5 text-[11px] text-muted">Private window: browsing history is not suggested here.</div>}
        </div>
      )}
    </form>
  );
}
