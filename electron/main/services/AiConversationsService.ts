import { randomUUID } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { aiConversations, aiMessages } from "../../../database/schema";
import type { AiConversation, AiMessage } from "../../../shared/types/ai";
import type { Db } from "../db/database";

const MAX_CONVERSATIONS = 200;

/** Saved SIDB AI chats for a profile. Only the chat text is stored, never the web page text that was shared. */
export class AiConversationsService {
  constructor(private readonly db: Db) {}

  async list(): Promise<AiConversation[]> {
    return this.db.orm.select().from(aiConversations).orderBy(desc(aiConversations.updatedAt)).limit(MAX_CONVERSATIONS);
  }

  async messages(conversationId: string): Promise<AiMessage[]> {
    const rows = await this.db.orm.select().from(aiMessages).where(eq(aiMessages.conversationId, conversationId)).orderBy(asc(aiMessages.createdAt), asc(aiMessages.id));
    return rows.map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt }));
  }

  async exists(id: string): Promise<boolean> {
    const [row] = await this.db.orm.select().from(aiConversations).where(eq(aiConversations.id, id)).limit(1);
    return !!row;
  }

  async create(title: string): Promise<AiConversation> {
    const now = Date.now();
    const row: AiConversation = { id: randomUUID(), title, createdAt: now, updatedAt: now };
    await this.db.orm.insert(aiConversations).values(row);
    await this.prune();
    return row;
  }

  async append(conversationId: string, user: string, assistant: string): Promise<void> {
    const now = Date.now();
    await this.db.orm.insert(aiMessages).values([
      { id: randomUUID(), conversationId, role: "user", content: user, createdAt: now },
      { id: randomUUID(), conversationId, role: "assistant", content: assistant, createdAt: now + 1 },
    ]);
    await this.db.orm.update(aiConversations).set({ updatedAt: now }).where(eq(aiConversations.id, conversationId));
  }

  async remove(id: string): Promise<void> {
    await this.db.orm.delete(aiConversations).where(eq(aiConversations.id, id));
  }

  async clearAll(): Promise<void> {
    await this.db.orm.delete(aiConversations);
  }

  private async prune(): Promise<void> {
    const extra = await this.db.orm.select().from(aiConversations).orderBy(desc(aiConversations.updatedAt)).limit(50).offset(MAX_CONVERSATIONS);
    for (const c of extra) await this.remove(c.id);
  }
}
