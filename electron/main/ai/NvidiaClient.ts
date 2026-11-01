import type { AiErrorKind } from "../../../shared/types/ai";
import type { ChatMessage } from "./prompts";
import { appFetch } from "../net/appFetch";
import { discardBody } from "../net/discardBody";

/** The only host the API key is ever sent to. Not configurable on purpose. */
export const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
const FIRST_BYTE_TIMEOUT_MS = 30_000;
const TOTAL_TIMEOUT_MS = 180_000;

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface StreamOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  /** Called when the model streams reasoning text (which is never shown). Lets the caller explain an empty answer. */
  onReasoning?: () => void;
}

/**
 * Answer text from a delta. Usually a string; some providers send a list of chunks instead
 * ({type:"text"} for the answer, {type:"thinking"} for reasoning), so only text chunks are kept.
 */
export function answerText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (c && typeof c === "object" && (c as { type?: unknown }).type === "text" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : "")).join("");
}

/** Pulls a readable message out of the API's error body ({detail}, {error:{message}} or {message}). */
export function errorDetail(body: string): string {
  try {
    const j = JSON.parse(body) as { detail?: unknown; title?: unknown; message?: unknown; error?: { message?: unknown } | string };
    const pick = [j.detail, typeof j.error === "string" ? j.error : j.error?.message, j.message, j.title].find((v) => typeof v === "string" && v);
    return typeof pick === "string" ? pick.slice(0, 300) : "";
  } catch {
    return "";
  }
}

export function classifyHttp(status: number, detail: string, retryAfter: string | null): AiError {
  const lower = detail.toLowerCase();
  if (status === 401 || status === 403) return new AiError("auth", "NVIDIA rejected the API key. Check the key in AI settings.");
  if (status === 429) {
    const secs = Number(retryAfter);
    return new AiError("rate-limit", "NVIDIA's free tier is rate limited. Wait a moment and try again.", Number.isFinite(secs) && secs > 0 ? Math.ceil(secs) : undefined);
  }
  if (status === 404) return new AiError("model", "That model is not available on NVIDIA's API right now. Pick another model in AI settings.");
  if (status === 400 || status === 413 || status === 422) {
    if (/context|token|too long|too large|maximum/.test(lower)) return new AiError("too-long", "The page or message is too long for this model. Try a selection instead.");
    return new AiError("other", detail ? `NVIDIA could not process the request: ${detail}` : "NVIDIA could not process the request.");
  }
  if (status >= 500) return new AiError("network", "NVIDIA's service had a problem. Try again in a moment.");
  return new AiError("other", detail ? `Unexpected response (${status}): ${detail}` : `Unexpected response (${status}).`);
}

/**
 * Streams a chat completion from NVIDIA's OpenAI-compatible endpoint.
 * Only the answer text (`delta.content`) is forwarded; reasoning fields are never shown.
 * No `reasoning_effort` is sent, so reasoning-capable models (such as Mistral Large 4) answer directly.
 * Returns the number of characters received.
 */
export async function streamChat(opts: StreamOptions, fetchImpl: FetchLike = appFetch): Promise<number> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (opts.signal.aborted) controller.abort();
  opts.signal.addEventListener("abort", onAbort, { once: true });
  const total = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
  let first: NodeJS.Timeout | undefined = setTimeout(() => controller.abort(), FIRST_BYTE_TIMEOUT_MS);

  try {
    let res: Response;
    try {
      res = await fetchImpl(`${NVIDIA_BASE}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json", accept: "text/event-stream", "user-agent": "SIDB-Browser/0.1" },
        body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true, temperature: 0.3, top_p: 0.9, max_tokens: opts.maxTokens }),
        signal: controller.signal,
      });
    } catch (e) {
      if (opts.signal.aborted) throw e;
      throw new AiError("network", "Could not reach NVIDIA. Check your internet connection.");
    }

    if (!res.ok) throw classifyHttp(res.status, errorDetail(await res.text().catch(() => "")), res.headers.get("retry-after"));
    if (!res.body) throw new AiError("other", "NVIDIA returned an empty response.");

    clearTimeout(first);
    first = undefined;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let received = 0;
    const handleLine = (line: string): boolean => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return false;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return true;
      try {
        const j = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown } }>; error?: { message?: string } };
        if (j.error?.message) throw new AiError("other", j.error.message.slice(0, 300));
        const delta = j.choices?.[0]?.delta;
        if (delta?.reasoning_content || delta?.reasoning) opts.onReasoning?.();
        const piece = answerText(delta?.content);
        if (piece) {
          received += piece.length;
          opts.onDelta(piece);
        }
      } catch (e) {
        if (e instanceof AiError) throw e; // bad JSON in a keep-alive line is ignored
      }
      return false;
    };

    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (opts.signal.aborted) throw e;
        throw new AiError("network", "The connection to NVIDIA was interrupted.");
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (handleLine(line)) return received;
      }
    }
    if (buffer) handleLine(buffer);
    return received;
  } finally {
    clearTimeout(total);
    if (first) clearTimeout(first);
    opts.signal.removeEventListener("abort", onAbort);
  }
}

/** Public endpoint: confirms the model id exists in NVIDIA's catalog. Does not use or validate the key. */
export async function modelExists(model: string, fetchImpl: FetchLike = appFetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${NVIDIA_BASE}/models/${model}`, { signal: AbortSignal.timeout(15_000) });
    await discardBody(res); // only the status matters
    return res.ok;
  } catch {
    return false;
  }
}
