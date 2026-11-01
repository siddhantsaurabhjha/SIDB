import type { AiEvent, AiSendRequest } from "../types/ai";
import type { DataApi } from "./dataApi";
import type { ContentBounds, FindResult, PermissionDecision, PermissionPrompt, TabsSnapshot, UiCommand } from "../types/browser";

export const IPC = {
  tabsList: "tabs:list",
  tabsCreate: "tabs:create",
  tabsClose: "tabs:close",
  tabsActivate: "tabs:activate",
  tabsNavigate: "tabs:navigate",
  tabsBack: "tabs:back",
  tabsForward: "tabs:forward",
  tabsReload: "tabs:reload",
  tabsStop: "tabs:stop",
  tabsDuplicate: "tabs:duplicate",
  tabsPin: "tabs:pin",
  tabsMute: "tabs:mute",
  tabsMove: "tabs:move",
  tabsZoom: "tabs:zoom",
  tabsProceed: "tabs:proceed",
  tabsMenu: "tabs:menu",
  groupsMenu: "groups:menu",
  groupsUpdate: "groups:update",
  tabsGroup: "tabs:group",
  tabsGroupNew: "tabs:group-new",
  layoutOverlay: "layout:overlay",
  layoutPrepareOverlay: "layout:prepare-overlay",
  findStart: "find:start",
  findStop: "find:stop",
  permissionsList: "permissions:list",
  permissionsRespond: "permissions:respond",
  layoutSetBounds: "layout:set-bounds",
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggle-maximize",
  windowClose: "window:close",
  windowNewPrivate: "window:new-private",
  dataCall: "data:call",
  aiSend: "ai:send",
  aiCancel: "ai:cancel",
  // main -> renderer events
  evTabsState: "ev:tabs-state",
  evFindResult: "ev:find-result",
  evPermissions: "ev:permissions",
  evCommand: "ev:command",
  evData: "ev:data",
  evAi: "ev:ai",
  evOverlay: "ev:overlay",
  evRenameGroup: "ev:rename-group",
} as const;

/** API surface exposed to the renderer through the preload bridge as `window.sidb`. */
export interface SidbApi {
  platform: NodeJS.Platform;
  tabs: {
    list(): Promise<TabsSnapshot>;
    create(opts?: { url?: string; activate?: boolean }): Promise<void>;
    close(id: string): Promise<void>;
    activate(id: string): Promise<void>;
    navigate(id: string, input: string): Promise<void>;
    back(id: string): Promise<void>;
    forward(id: string): Promise<void>;
    reload(id: string): Promise<void>;
    stop(id: string): Promise<void>;
    duplicate(id: string): Promise<void>;
    pin(id: string, pinned: boolean): Promise<void>;
    mute(id: string, muted: boolean): Promise<void>;
    move(id: string, toIndex: number): Promise<void>;
    zoom(id: string, action: "in" | "out" | "reset"): Promise<void>;
    /** Continue to a site Safe Browsing flagged (explicit user action). */
    proceedAnyway(id: string): Promise<void>;
    /** Native context menus (they draw above web pages). */
    showMenu(id: string): void;
    showGroupMenu(groupId: string): void;
    groupAdd(id: string, groupId: string | null): Promise<void>;
    groupRemove(id: string): Promise<void>;
    groupNew(id: string): Promise<void>;
    updateGroup(groupId: string, patch: { name?: string; color?: string; collapsed?: boolean }): Promise<void>;
    onRenameGroup(cb: (groupId: string) => void): () => void;
    onState(cb: (snapshot: TabsSnapshot) => void): () => void;
  };
  find: {
    start(id: string, text: string, opts?: { forward?: boolean; findNext?: boolean }): Promise<void>;
    stop(id: string): Promise<void>;
    onResult(cb: (r: FindResult) => void): () => void;
  };
  permissions: {
    list(): Promise<PermissionPrompt[]>;
    respond(id: string, decision: PermissionDecision): Promise<void>;
    onChange(cb: (prompts: PermissionPrompt[]) => void): () => void;
  };
  layout: {
    setContentBounds(bounds: ContentBounds): void;
    /** While an HTML dialog is open the page is swapped for a picture of itself. */
    setOverlay(open: boolean): void;
    /** Takes the page picture ahead of time so the next overlay opens without a gap. */
    prepareOverlay(): void;
    onOverlay(cb: (snapshot: string | null) => void): () => void;
  };
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    newPrivate(): void;
  };
  onCommand(cb: (cmd: UiCommand) => void): () => void;
  data: DataApi;
  ai: {
    /** Starts a streamed answer. Progress arrives through onEvent, matched by requestId. */
    send(req: AiSendRequest): Promise<void>;
    cancel(requestId: string): Promise<void>;
    onEvent(cb: (e: AiEvent) => void): () => void;
  };
}
