import { ipcMain } from "electron";
import type { z } from "zod";
import { IPC } from "../../../shared/ipc/channels";
import { schemas } from "../../../shared/ipc/schemas";
import { createMainWindow } from "../windows/mainWindow";
import { aiCancelSchema, aiSendSchema } from "../../../shared/ipc/aiSchemas";
import { getAi, hostFor } from "../ai/instance";
import { registerDataHandlers } from "./dataHandlers";
import { trustedContext, type WindowContext } from "../windows/registry";

/** Registers every IPC handler once. Each call resolves the calling window and rejects untrusted senders. */
export function registerIpc(): void {
  function handle<S extends z.ZodType>(channel: string, schema: S | null, fn: (ctx: WindowContext, arg: z.infer<S>) => unknown): void {
    ipcMain.handle(channel, (event, raw) => {
      const ctx = trustedContext(event);
      if (!ctx) throw new Error("Untrusted IPC sender");
      const arg = schema ? schema.parse(raw) : undefined;
      return fn(ctx, arg as z.infer<S>);
    });
  }

  function on<S extends z.ZodType>(channel: string, schema: S | null, fn: (ctx: WindowContext, arg: z.infer<S>) => void): void {
    ipcMain.on(channel, (event, raw) => {
      const ctx = trustedContext(event);
      if (!ctx) return;
      const parsed = schema ? schema.safeParse(raw) : { success: true as const, data: undefined };
      if (parsed.success) fn(ctx, parsed.data as z.infer<S>);
    });
  }

  handle(IPC.tabsList, null, (c) => c.tabs.snapshot());
  handle(IPC.tabsCreate, schemas.create, (c, o) => void c.tabs.create(o?.url, o?.activate ?? true));
  handle(IPC.tabsClose, schemas.tabId, (c, id) => c.tabs.close(id));
  handle(IPC.tabsActivate, schemas.tabId, (c, id) => c.tabs.activate(id));
  handle(IPC.tabsNavigate, schemas.navigate, (c, { id, input }) => c.tabs.navigate(id, input));
  handle(IPC.tabsBack, schemas.tabId, (c, id) => c.tabs.back(id));
  handle(IPC.tabsForward, schemas.tabId, (c, id) => c.tabs.forward(id));
  handle(IPC.tabsReload, schemas.tabId, (c, id) => c.tabs.reload(id));
  handle(IPC.tabsStop, schemas.tabId, (c, id) => c.tabs.stop(id));
  handle(IPC.tabsDuplicate, schemas.tabId, (c, id) => c.tabs.duplicate(id));
  handle(IPC.tabsPin, schemas.pin, (c, { id, pinned }) => c.tabs.setPinned(id, pinned));
  handle(IPC.tabsMute, schemas.mute, (c, { id, muted }) => c.tabs.setMuted(id, muted));
  handle(IPC.tabsMove, schemas.move, (c, { id, toIndex }) => c.tabs.move(id, toIndex));
  handle(IPC.tabsGroup, schemas.tabGroup, (c, { id, groupId }) => (groupId ? c.tabs.addToGroup(id, groupId) : c.tabs.removeFromGroup(id)));
  handle(IPC.tabsGroupNew, schemas.tabId, (c, id) => void c.tabs.createGroup(id));
  handle(IPC.groupsUpdate, schemas.groupUpdate, (c, { groupId, patch }) => c.tabs.updateGroup(groupId, patch));
  handle(IPC.tabsProceed, schemas.tabId, (c, id) => c.tabs.proceedAnyway(id));
  handle(IPC.tabsZoom, schemas.zoom, (c, { id, action }) => c.tabs.zoom(id, action));

  handle(IPC.findStart, schemas.findStart, (c, { id, text, forward, findNext }) => c.tabs.findStart(id, text, { forward, findNext }));
  handle(IPC.findStop, schemas.tabId, (c, id) => c.tabs.findStop(id));

  handle(IPC.permissionsList, null, (c) => c.permissions.list());
  handle(IPC.permissionsRespond, schemas.permissionRespond, (c, { id, decision }) => c.permissions.respond(id, decision));

  on(IPC.layoutSetBounds, schemas.bounds, (c, b) => c.tabs.setBounds(b));
  on(IPC.layoutOverlay, schemas.overlay, (c, open) => void c.tabs.setOverlay(open));
  on(IPC.layoutPrepareOverlay, null, (c) => void c.tabs.prepareOverlay());
  on(IPC.tabsMenu, schemas.tabId, (c, id) => c.tabs.showTabMenu(id));
  on(IPC.groupsMenu, schemas.tabId, (c, id) => c.tabs.showGroupMenu(id));
  on(IPC.windowMinimize, null, (c) => c.win.minimize());
  on(IPC.windowToggleMaximize, null, (c) => (c.win.isMaximized() ? c.win.unmaximize() : c.win.maximize()));
  on(IPC.windowClose, null, (c) => c.win.close());
  on(IPC.windowNewPrivate, null, (c) => void createMainWindow({ isPrivate: true, profileId: c.profile.info.id }));
  // AI: returns at once; progress is streamed back as events.
  handle(IPC.aiSend, aiSendSchema, (c, req) => void getAi().send(hostFor(c), req));
  handle(IPC.aiCancel, aiCancelSchema, (c, requestId) => getAi().cancel(c.win.webContents.id, requestId));
  registerDataHandlers();
}
