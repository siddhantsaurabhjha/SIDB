import { contextBridge, ipcRenderer } from "electron";
import { IPC, type SidbApi } from "../../shared/ipc/channels";
import { DATA_METHODS, type DataApi } from "../../shared/ipc/dataApi";
import type { DataTopic } from "../../shared/types/data";

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Builds window.sidb.data.<namespace>.<method>(arg) from the allow-list of method names.
function buildDataApi(): DataApi {
  const root: Record<string, Record<string, (arg?: unknown) => Promise<unknown>>> = {};
  for (const name of DATA_METHODS) {
    const [ns, fn] = name.split(".");
    (root[ns] ??= {})[fn] = (arg) => ipcRenderer.invoke(IPC.dataCall, name, arg);
  }
  return { ...root, onChange: (cb: (topic: DataTopic) => void) => subscribe(IPC.evData, cb) } as unknown as DataApi;
}

const api: SidbApi = {
  platform: process.platform,
  tabs: {
    list: () => ipcRenderer.invoke(IPC.tabsList),
    create: (opts) => ipcRenderer.invoke(IPC.tabsCreate, opts),
    close: (id) => ipcRenderer.invoke(IPC.tabsClose, id),
    activate: (id) => ipcRenderer.invoke(IPC.tabsActivate, id),
    navigate: (id, input) => ipcRenderer.invoke(IPC.tabsNavigate, { id, input }),
    back: (id) => ipcRenderer.invoke(IPC.tabsBack, id),
    forward: (id) => ipcRenderer.invoke(IPC.tabsForward, id),
    reload: (id) => ipcRenderer.invoke(IPC.tabsReload, id),
    stop: (id) => ipcRenderer.invoke(IPC.tabsStop, id),
    duplicate: (id) => ipcRenderer.invoke(IPC.tabsDuplicate, id),
    pin: (id, pinned) => ipcRenderer.invoke(IPC.tabsPin, { id, pinned }),
    mute: (id, muted) => ipcRenderer.invoke(IPC.tabsMute, { id, muted }),
    move: (id, toIndex) => ipcRenderer.invoke(IPC.tabsMove, { id, toIndex }),
    zoom: (id, action) => ipcRenderer.invoke(IPC.tabsZoom, { id, action }),
    proceedAnyway: (id) => ipcRenderer.invoke(IPC.tabsProceed, id),
    showMenu: (id) => ipcRenderer.send(IPC.tabsMenu, id),
    showGroupMenu: (groupId) => ipcRenderer.send(IPC.groupsMenu, groupId),
    groupAdd: (id, groupId) => ipcRenderer.invoke(IPC.tabsGroup, { id, groupId }),
    groupNew: (id) => ipcRenderer.invoke(IPC.tabsGroupNew, id),
    groupRemove: (id) => ipcRenderer.invoke(IPC.tabsGroup, { id, groupId: null }),
    updateGroup: (groupId, patch) => ipcRenderer.invoke(IPC.groupsUpdate, { groupId, patch }),
    onRenameGroup: (cb) => subscribe(IPC.evRenameGroup, cb),
    onState: (cb) => subscribe(IPC.evTabsState, cb),
  },
  find: {
    start: (id, text, opts) => ipcRenderer.invoke(IPC.findStart, { id, text, ...opts }),
    stop: (id) => ipcRenderer.invoke(IPC.findStop, id),
    onResult: (cb) => subscribe(IPC.evFindResult, cb),
  },
  permissions: {
    list: () => ipcRenderer.invoke(IPC.permissionsList),
    respond: (id, decision) => ipcRenderer.invoke(IPC.permissionsRespond, { id, decision }),
    onChange: (cb) => subscribe(IPC.evPermissions, cb),
  },
  layout: {
    setContentBounds: (bounds) => ipcRenderer.send(IPC.layoutSetBounds, bounds),
    setOverlay: (open) => ipcRenderer.send(IPC.layoutOverlay, open),
    prepareOverlay: () => ipcRenderer.send(IPC.layoutPrepareOverlay),
    onOverlay: (cb) => subscribe(IPC.evOverlay, cb),
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.windowToggleMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
    newPrivate: () => ipcRenderer.send(IPC.windowNewPrivate),
  },
  onCommand: (cb) => subscribe(IPC.evCommand, cb),
  data: buildDataApi(),
  ai: {
    send: (req) => ipcRenderer.invoke(IPC.aiSend, req),
    cancel: (requestId) => ipcRenderer.invoke(IPC.aiCancel, requestId),
    onEvent: (cb) => subscribe(IPC.evAi, cb),
  },
};

contextBridge.exposeInMainWorld("sidb", api);
