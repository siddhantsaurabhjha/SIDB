import type { UrlSuggestion } from "../suggest";
import type { MemoryPressure, ResourceStats } from "../resources";
import type { UpdateStatus } from "../updates";
import type { AiConversation, AiMessage, AiStatus } from "../types/ai";
import type { ShieldException, ShieldStatus } from "../types/shield";
import type {
  BackupInfo,
  Bookmark,
  BookmarkFolder,
  ClosedTab,
  DataTopic,
  DownloadItem,
  HistoryEntry,
  HistoryStats,
  ProfileInfo,
  Settings,
  Shortcut,
} from "../types/data";

export type HistoryRange = "all" | "today" | "week" | "month";

/** Everything the UI can ask the main process to do with persistent data. One object argument per call. */
export interface DataApi {
  bookmarks: {
    list(a?: { query?: string }): Promise<{ folders: BookmarkFolder[]; bookmarks: Bookmark[] }>;
    findByUrl(a: { url: string }): Promise<Bookmark | null>;
    add(a: { title: string; url: string; folderId?: string | null; favicon?: string | null }): Promise<Bookmark>;
    update(a: { id: string; patch: Partial<Pick<Bookmark, "title" | "url" | "folderId" | "pinned" | "favorite">> }): Promise<void>;
    remove(a: { id: string }): Promise<void>;
    createFolder(a: { name: string; parentId?: string | null }): Promise<BookmarkFolder>;
    renameFolder(a: { id: string; name: string }): Promise<void>;
    removeFolder(a: { id: string }): Promise<void>;
    importHtml(): Promise<{ added: number; skipped: number } | null>;
    exportHtml(): Promise<string | null>;
  };
  history: {
    list(a?: { query?: string; range?: HistoryRange; limit?: number; offset?: number }): Promise<HistoryEntry[]>;
    remove(a: { ids: string[] }): Promise<void>;
    clear(a: { range: HistoryRange }): Promise<void>;
    stats(): Promise<HistoryStats>;
    recentlyClosed(): Promise<ClosedTab[]>;
    reopenClosed(a?: { id?: string }): Promise<void>;
  };
  downloads: {
    list(): Promise<DownloadItem[]>;
    pause(a: { id: string }): Promise<void>;
    resume(a: { id: string }): Promise<void>;
    cancel(a: { id: string }): Promise<void>;
    retry(a: { id: string }): Promise<void>;
    open(a: { id: string }): Promise<void>;
    reveal(a: { id: string }): Promise<void>;
    remove(a: { id: string }): Promise<void>;
    clearFinished(): Promise<void>;
    chooseFolder(): Promise<string | null>;
  };
  settings: {
    get(): Promise<Settings>;
    set(a: { patch: Partial<Settings> }): Promise<Settings>;
  };
  shortcuts: {
    list(): Promise<Shortcut[]>;
    add(a: { title: string; url: string }): Promise<Shortcut>;
    update(a: { id: string; title?: string; url?: string }): Promise<void>;
    remove(a: { id: string }): Promise<void>;
    reorder(a: { ids: string[] }): Promise<void>;
  };
  profiles: {
    list(): Promise<{ profiles: ProfileInfo[]; currentId: string }>;
    create(a: { name: string }): Promise<ProfileInfo>;
    open(a: { id: string }): Promise<void>;
  };
  backup: {
    list(): Promise<BackupInfo[]>;
    create(): Promise<BackupInfo>;
    exportTo(): Promise<string | null>;
    importFrom(): Promise<boolean>;
  };
  shield: {
    status(): Promise<ShieldStatus>;
    updateNow(): Promise<void>;
    setListEnabled(a: { id: string; enabled: boolean }): Promise<void>;
    exceptions(): Promise<ShieldException[]>;
    addException(a: { host: string }): Promise<string>;
    removeException(a: { host: string }): Promise<void>;
    /** Write-only: the key is encrypted by the OS and never sent back to the UI. */
    setSafeBrowsingKey(a: { key: string }): Promise<void>;
    clearSafeBrowsingKey(): Promise<void>;
  };
  ai: {
    status(): Promise<AiStatus>;
    /** Write-only: the key is encrypted by the OS and never sent back to the UI. */
    setKey(a: { key: string }): Promise<void>;
    clearKey(): Promise<void>;
    /** Sends one tiny request to check that the key and model work. */
    test(): Promise<{ ok: boolean; message: string }>;
    /** Checks that a model id exists in NVIDIA's public catalog. */
    modelExists(a: { model: string }): Promise<boolean>;
    conversations(): Promise<AiConversation[]>;
    messages(a: { id: string }): Promise<AiMessage[]>;
    deleteConversation(a: { id: string }): Promise<void>;
    clearConversations(): Promise<void>;
  };
  capture: {
    /** Screenshot of the active page to a file (with a Save dialog) or to the clipboard. */
    page(a: { mode: "visible" | "full"; dest: "file" | "clipboard" }): Promise<{ ok: boolean; message: string; path?: string }>;
    saveImage(a: { dataUrl: string; name: string }): Promise<{ ok: boolean; message: string; path?: string }>;
    copyImage(a: { dataUrl: string }): Promise<{ ok: boolean; message: string }>;
  };
  appearance: {
    pickWallpaper(): Promise<{ ok: boolean; message: string }>;
    /** The chosen New Tab wallpaper as a data URL, or null. */
    wallpaper(): Promise<string | null>;
    clearWallpaper(): Promise<void>;
  };
  favicon: {
    /** The site's real icon as a data URL, or null if it has none. Served from a local cache; only the site itself is contacted. */
    get(a: { url: string; hint?: string | null }): Promise<string | null>;
    /** Deletes the stored icons of this profile. Returns how many files were removed. */
    clear(): Promise<number>;
  };
  suggest: {
    /** Address bar suggestions from history, bookmarks and well-known sites. Instant; nothing leaves the device. */
    local(a: { query: string }): Promise<UrlSuggestion[]>;
    /** Search engine suggestions for the typed words only. A newer call cancels an older one. */
    remote(a: { query: string }): Promise<{ suggestions: string[]; error?: "disabled" | "skipped" | "network" | "bad-response"; cached?: boolean }>;
    cancelRemote(): Promise<void>;
  };
  resources: {
    /** Memory pressure and power source (cheap; used for the low-memory strip and battery styling). */
    summary(): Promise<{ pressure: MemoryPressure; onBattery: boolean }>;
    /** Full numbers for the Performance panel, including per-tab memory of this window. */
    stats(): Promise<ResourceStats>;
    /** Unloads one background tab of this window. False when the tab is protected (active, playing, pinned...). */
    sleepTab(a: { id: string }): Promise<boolean>;
    /** Unloads every background tab of this window that is safe to unload. Returns how many. */
    sleepBackground(): Promise<number>;
    /** Turns hardware acceleration on or off from the next start. */
    setHardwareAcceleration(a: { enabled: boolean }): Promise<void>;
  };
  compat: {
    /** Opens the sign-in Google refused in the system's default browser (explicit user action). False if there is none. */
    continueSigninExternally(a: { id: string }): Promise<boolean>;
    dismissNotice(a: { id: string }): Promise<void>;
  };
  updates: {
    status(): Promise<UpdateStatus>;
    /** Asks GitHub Releases now. */
    check(): Promise<UpdateStatus>;
    setAutoCheck(a: { enabled: boolean }): Promise<void>;
    /** Opens the newer release's page in a new tab. False when there is no newer release. */
    openRelease(): Promise<boolean>;
  };
  /** Subscribe to change notifications for the current profile. */
  onChange(cb: (topic: DataTopic) => void): () => void;
}

/** "namespace.method" names the main process accepts on the data channel. */
export const DATA_METHODS = [
  "bookmarks.list",
  "bookmarks.findByUrl",
  "bookmarks.add",
  "bookmarks.update",
  "bookmarks.remove",
  "bookmarks.createFolder",
  "bookmarks.renameFolder",
  "bookmarks.removeFolder",
  "bookmarks.importHtml",
  "bookmarks.exportHtml",
  "history.list",
  "history.remove",
  "history.clear",
  "history.stats",
  "history.recentlyClosed",
  "history.reopenClosed",
  "downloads.list",
  "downloads.pause",
  "downloads.resume",
  "downloads.cancel",
  "downloads.retry",
  "downloads.open",
  "downloads.reveal",
  "downloads.remove",
  "downloads.clearFinished",
  "downloads.chooseFolder",
  "settings.get",
  "settings.set",
  "shortcuts.list",
  "shortcuts.add",
  "shortcuts.update",
  "shortcuts.remove",
  "shortcuts.reorder",
  "profiles.list",
  "profiles.create",
  "profiles.open",
  "backup.list",
  "backup.create",
  "backup.exportTo",
  "backup.importFrom",
  "shield.status",
  "shield.updateNow",
  "shield.setListEnabled",
  "shield.exceptions",
  "shield.addException",
  "shield.removeException",
  "shield.setSafeBrowsingKey",
  "shield.clearSafeBrowsingKey",
  "ai.status",
  "ai.setKey",
  "ai.clearKey",
  "ai.test",
  "ai.modelExists",
  "ai.conversations",
  "ai.messages",
  "ai.deleteConversation",
  "ai.clearConversations",
  "capture.page",
  "capture.saveImage",
  "capture.copyImage",
  "appearance.pickWallpaper",
  "appearance.wallpaper",
  "appearance.clearWallpaper",
  "favicon.get",
  "favicon.clear",
  "suggest.local",
  "suggest.remote",
  "suggest.cancelRemote",
  "resources.summary",
  "resources.stats",
  "resources.sleepTab",
  "resources.sleepBackground",
  "resources.setHardwareAcceleration",
  "compat.continueSigninExternally",
  "compat.dismissNotice",
  "updates.status",
  "updates.check",
  "updates.setAutoCheck",
  "updates.openRelease",
] as const;

export type DataMethod = (typeof DATA_METHODS)[number];
