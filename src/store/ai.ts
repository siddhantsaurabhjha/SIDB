import { create } from "zustand";
import { AI_LIMITS, type AiAction, type AiErrorKind, type AiEvent } from "../../shared/types/ai";

export interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "error" | "stopped";
  error?: { kind: AiErrorKind; message: string; retryAfterSeconds?: number };
  /** Small note under an answer, e.g. how much of the page was shared. */
  note?: string;
}

export interface SendOptions {
  action: AiAction;
  text: string;
  /** Text shown in the chat for the user's turn (defaults to `text`). */
  label?: string;
  usePage?: boolean;
  useSelection?: boolean;
  language?: string;
  tone?: string;
}

interface AiStore {
  messages: ChatMsg[];
  conversationId: string | null;
  activeRequestId: string | null;
  /** Page-context toggle for free-form chat. */
  usePage: boolean;
  setUsePage(v: boolean): void;
  send(opts: SendOptions): void;
  stop(): void;
  newChat(): void;
  openConversation(id: string): Promise<void>;
  handleEvent(e: AiEvent): void;
}

const uid = () => crypto.randomUUID();

export const useAi = create<AiStore>((set, get) => ({
  messages: [],
  conversationId: null,
  activeRequestId: null,
  usePage: false,
  setUsePage: (usePage) => set({ usePage }),

  send: (opts) => {
    if (get().activeRequestId) return;
    const requestId = uid();
    const state = get();
    const history = state.messages
      .filter((m) => m.status === "done" && m.content)
      .slice(-AI_LIMITS.historyMessages)
      .map((m) => ({ role: m.role, content: m.content.slice(0, AI_LIMITS.historyChars) }));

    const user: ChatMsg = { id: uid(), role: "user", content: opts.label ?? opts.text, status: "done" };
    const assistant: ChatMsg = { id: requestId, role: "assistant", content: "", status: "streaming" };
    set({ messages: [...state.messages, user, assistant], activeRequestId: requestId });

    void window.sidb.ai
      .send({
        requestId,
        conversationId: state.conversationId,
        action: opts.action,
        text: opts.text.slice(0, AI_LIMITS.userText),
        usePage: opts.usePage ?? state.usePage,
        useSelection: opts.useSelection ?? false,
        language: opts.language,
        tone: opts.tone,
        history,
      })
      .catch(() => get().handleEvent({ type: "error", requestId, kind: "other", message: "SIDB AI could not start the request." }));
  },

  stop: () => {
    const id = get().activeRequestId;
    if (!id) return;
    void window.sidb.ai.cancel(id);
    set((s) => ({
      activeRequestId: null,
      messages: s.messages.map((m) => (m.id === id ? { ...m, status: "stopped" as const } : m)),
    }));
  },

  newChat: () => {
    get().stop();
    set({ messages: [], conversationId: null });
  },

  openConversation: async (id) => {
    get().stop();
    const rows = await window.sidb.data.ai.messages({ id });
    set({ conversationId: id, messages: rows.map((m) => ({ id: m.id, role: m.role, content: m.content, status: "done" as const })) });
  },

  handleEvent: (e) => {
    const { activeRequestId } = get();
    if (e.requestId !== activeRequestId) return; // stopped or from an older request
    if (e.type === "chunk") {
      set((s) => ({ messages: s.messages.map((m) => (m.id === e.requestId ? { ...m, content: m.content + e.delta } : m)) }));
    } else if (e.type === "done") {
      const note = e.pageChars ? `Used ${e.pageChars.toLocaleString()} characters of the page${e.truncated ? " (the page was cut because it is long)" : ""}.` : undefined;
      set((s) => ({
        activeRequestId: null,
        conversationId: e.conversationId ?? s.conversationId,
        messages: s.messages.map((m) => (m.id === e.requestId ? { ...m, status: "done" as const, note } : m)),
      }));
    } else {
      set((s) => ({
        activeRequestId: null,
        messages: s.messages.map((m) => (m.id === e.requestId ? { ...m, status: "error" as const, error: { kind: e.kind, message: e.message, retryAfterSeconds: e.retryAfterSeconds } } : m)),
      }));
    }
  },
}));

/** Listens for streamed AI events. Cheap: nothing runs in the main process until the user sends something. */
export function connectAi(): () => void {
  return window.sidb.ai.onEvent((e) => useAi.getState().handleEvent(e));
}
