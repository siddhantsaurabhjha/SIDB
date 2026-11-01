import { getSecrets } from "../shield/instance";
import type { WindowContext } from "../windows/registry";
import { AiService, NVIDIA_KEY_SECRET, type AiHost } from "./AiService";
import { readPage } from "./pageContext";
import { IPC } from "../../../shared/ipc/channels";
import type { AiEvent } from "../../../shared/types/ai";

let service: AiService | null = null;

/** Created on first use, so nothing AI-related runs at startup. */
export function getAi(): AiService {
  return (service ??= new AiService(getSecrets()));
}

export function peekAi(): AiService | null {
  return service;
}

export { NVIDIA_KEY_SECRET };

export function hostFor(ctx: WindowContext): AiHost {
  return {
    isPrivate: ctx.isPrivate,
    windowId: ctx.win.webContents.id,
    model: ctx.profile.settings.peek().aiModel,
    hasWebPage: () => ctx.tabs.activeWebContents() !== null,
    readPage: async () => {
      const wc = ctx.tabs.activeWebContents();
      return wc ? readPage(wc) : null;
    },
    conversations: ctx.isPrivate ? null : ctx.profile.aiConversations,
    emit: (event: AiEvent) => {
      if (!ctx.win.isDestroyed() && !ctx.win.webContents.isDestroyed()) ctx.win.webContents.send(IPC.evAi, event);
    },
  };
}
