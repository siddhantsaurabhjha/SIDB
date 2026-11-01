import { z } from "zod";
import { AI_LIMITS } from "../types/ai";

const id = z.string().min(1).max(64);

export const aiSendSchema = z.object({
  requestId: id,
  conversationId: id.nullable(),
  action: z.enum(["chat", "summarize", "key-points", "explain", "translate", "rewrite", "ask-page"]),
  text: z.string().max(AI_LIMITS.userText),
  usePage: z.boolean(),
  useSelection: z.boolean(),
  language: z.string().max(40).optional(),
  tone: z.string().max(40).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(AI_LIMITS.historyChars) }))
    .max(AI_LIMITS.historyMessages),
});

export const aiCancelSchema = id;
