/** Mistral Large 4: text and image model with a very long context. Sent without reasoning_effort, which NVIDIA serves as "answer directly". */
export const DEFAULT_AI_MODEL = "mistralai/mistral-large-4-1t-a52b";
export const AI_MODEL_PATTERN = /^[\w.-]+\/[\w.:-]+$/;

/** Hard limits applied in the main process regardless of what the UI sends. */
export const AI_LIMITS = {
  userText: 8_000,
  selection: 20_000,
  pageChars: 40_000,
  historyMessages: 20,
  historyChars: 8_000,
  maxOutputTokens: 1_500,
} as const;

export type AiAction = "chat" | "summarize" | "key-points" | "explain" | "translate" | "rewrite" | "ask-page";

export interface AiSendRequest {
  /** Chosen by the UI so it can match streamed events to its own request. */
  requestId: string;
  /** Existing saved conversation to append to, or null to start one (not saved in private windows). */
  conversationId: string | null;
  action: AiAction;
  /** What the user typed (question, or text to translate/rewrite). */
  text: string;
  /** Include the current page's text. Only honoured when the user asked for it (page actions, or the Page toggle). */
  usePage: boolean;
  /** Use the text currently selected on the page. */
  useSelection: boolean;
  language?: string;
  tone?: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

export type AiErrorKind = "no-key" | "auth" | "rate-limit" | "model" | "too-long" | "network" | "empty-selection" | "no-page" | "private" | "other";

export type AiEvent =
  | { type: "chunk"; requestId: string; delta: string }
  | { type: "done"; requestId: string; conversationId: string | null; title: string | null; pageChars: number | null; truncated: boolean }
  | { type: "error"; requestId: string; kind: AiErrorKind; message: string; retryAfterSeconds?: number };

export interface AiStatus {
  keySet: boolean;
  secureStorage: boolean;
  model: string;
  /** False in private windows: page text is never shared from there. */
  pageContextAllowed: boolean;
  /** Title and host of the active tab when it is a normal web page. */
  page: { title: string; host: string } | null;
}

export interface AiConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}
