import { AI_LIMITS, type AiEvent, type AiSendRequest } from "../../../shared/types/ai";
import type { AiConversationsService } from "../services/AiConversationsService";
import { AiError, streamChat } from "./NvidiaClient";
import { buildPrompt, titleFrom, type PageContext } from "./prompts";

export const NVIDIA_KEY_SECRET = "nvidiaApiKey";
const LOCAL_LIMIT_PER_MINUTE = 30; // stay under NVIDIA's free-tier limit (about 40 requests per minute)

export interface KeyStore {
  get(name: string): string | null;
}

/** Everything the service needs from one browser window. Keeps Electron out of this file so it can be tested. */
export interface AiHost {
  isPrivate: boolean;
  windowId: number;
  model: string;
  /** True when the active tab is a normal web page that could be read. */
  hasWebPage(): boolean;
  readPage(): Promise<PageContext | null>;
  /** Saved chats for this profile (null in private windows). */
  conversations: AiConversationsService | null;
  emit(event: AiEvent): void;
}

type StreamFn = typeof streamChat;

const PAGE_ACTIONS = new Set(["summarize", "key-points", "ask-page"]);

export class AiService {
  private inflight = new Map<string, { abort: AbortController; windowId: number }>();
  private recent: number[] = [];

  constructor(
    private readonly keys: KeyStore,
    private readonly stream: StreamFn = streamChat,
    private readonly now: () => number = Date.now,
  ) {}

  /** Starts a request and resolves once it has finished (events carry the progress). Never throws. */
  async send(host: AiHost, req: AiSendRequest): Promise<void> {
    const fail = (kind: AiError["kind"], message: string, retryAfterSeconds?: number) => host.emit({ type: "error", requestId: req.requestId, kind, message, retryAfterSeconds });

    const apiKey = this.keys.get(NVIDIA_KEY_SECRET);
    if (!apiKey) return fail("no-key", "Add your NVIDIA API key in AI settings to use SIDB AI.");
    if (this.inflight.has(req.requestId)) return;

    // Which parts of the page the user asked to share.
    const wantsPage = req.usePage || PAGE_ACTIONS.has(req.action);
    const wantsSelection = req.useSelection || ((req.action === "explain" || req.action === "translate" || req.action === "rewrite") && !req.text.trim());
    let page: PageContext | null = null;
    if (wantsPage || wantsSelection) {
      if (host.isPrivate) return fail("private", "Private windows never share page content with AI. Type or paste the text instead.");
      if (!host.hasWebPage()) return fail("no-page", "Open a web page first.");
      page = await host.readPage();
      if (!page) return fail("no-page", "SIDB could not read this page.");
      if (wantsPage && !page.text.trim() && !wantsSelection) return fail("no-page", "This page has no readable text.");
      if (wantsSelection && !page.selection.trim() && !req.text.trim()) return fail("empty-selection", "Select some text on the page first.");
    }
    if (!req.text.trim() && !wantsPage && !wantsSelection) return fail("other", "Type a message first.");

    // Local pacing so a burst of clicks can't push the free tier into errors.
    const cutoff = this.now() - 60_000;
    this.recent = this.recent.filter((t) => t > cutoff);
    if (this.recent.length >= LOCAL_LIMIT_PER_MINUTE) return fail("rate-limit", "Too many requests in a minute. Wait a few seconds.", Math.max(1, Math.ceil((this.recent[0] + 60_000 - this.now()) / 1000)));
    this.recent.push(this.now());

    const built = buildPrompt({
      action: req.action,
      text: req.text,
      language: req.language,
      tone: req.tone,
      page: wantsPage || wantsSelection ? page : null,
      useSelection: wantsSelection,
      history: req.history,
    });

    const abort = new AbortController();
    this.inflight.set(req.requestId, { abort, windowId: host.windowId });
    let answer = "";
    let sawReasoning = false;
    try {
      await this.stream({
        apiKey,
        model: host.model,
        messages: built.messages,
        maxTokens: AI_LIMITS.maxOutputTokens,
        signal: abort.signal,
        onReasoning: () => (sawReasoning = true),
        onDelta: (delta) => {
          answer += delta;
          host.emit({ type: "chunk", requestId: req.requestId, delta });
        },
      });
      if (!answer.trim()) {
        return fail("other", sawReasoning ? "The model spent its whole answer budget thinking and gave no answer. Try again, or ask a shorter question." : "The model returned no text. Try again or choose another model.");
      }

      let conversationId: string | null = null;
      let title: string | null = null;
      const store = host.conversations;
      if (store && !host.isPrivate) {
        try {
          if (req.conversationId && (await store.exists(req.conversationId))) {
            conversationId = req.conversationId;
          } else {
            title = titleFrom(built.displayText);
            conversationId = (await store.create(title)).id;
          }
          await store.append(conversationId, built.displayText, answer);
        } catch {
          conversationId = null; // saving is best effort; the answer is still shown
        }
      }
      host.emit({ type: "done", requestId: req.requestId, conversationId, title, pageChars: built.pageChars, truncated: built.truncated });
    } catch (e) {
      if (abort.signal.aborted) return; // cancelled by the user: the UI already stopped
      if (e instanceof AiError) fail(e.kind, e.message, e.retryAfterSeconds);
      else fail("other", "Something went wrong while talking to NVIDIA.");
    } finally {
      this.inflight.delete(req.requestId);
    }
  }

  cancel(windowId: number, requestId: string): void {
    const entry = this.inflight.get(requestId);
    if (entry && entry.windowId === windowId) entry.abort.abort();
  }

  /** Stops everything a closing window had running. */
  abortWindow(windowId: number): void {
    for (const e of this.inflight.values()) if (e.windowId === windowId) e.abort.abort();
  }

  /** One tiny request to confirm the key and model work together. */
  async test(host: Pick<AiHost, "model" | "windowId">): Promise<{ ok: boolean; message: string }> {
    const apiKey = this.keys.get(NVIDIA_KEY_SECRET);
    if (!apiKey) return { ok: false, message: "No API key saved." };
    const abort = new AbortController();
    let got = "";
    try {
      await this.stream({ apiKey, model: host.model, messages: [{ role: "user", content: "Reply with the single word: ok" }], maxTokens: 8, signal: abort.signal, onDelta: (d) => (got += d) });
      return got.trim() ? { ok: true, message: `Connected. ${host.model} answered.` } : { ok: false, message: "Connected, but the model returned no text." };
    } catch (e) {
      return { ok: false, message: e instanceof AiError ? e.message : "Could not reach NVIDIA." };
    }
  }
}
