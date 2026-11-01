import { z } from "zod";
import { SEARCH_ENGINES } from "../constants/search";
import { AI_MODEL_PATTERN, DEFAULT_AI_MODEL } from "./ai";

export interface BookmarkFolder {
  id: string;
  parentId: string | null;
  name: string;
  position: number;
  createdAt: number;
}

export interface Bookmark {
  id: string;
  folderId: string | null;
  title: string;
  url: string;
  favicon: string | null;
  pinned: boolean;
  favorite: boolean;
  position: number;
  createdAt: number;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  visitCount: number;
  lastVisit: number;
}

export type DownloadState = "in_progress" | "paused" | "completed" | "cancelled" | "failed";

export interface DownloadItem {
  id: string;
  fileName: string;
  savePath: string;
  sourceUrl: string;
  mimeType: string | null;
  totalBytes: number;
  receivedBytes: number;
  state: DownloadState;
  riskWarning: string | null;
  startedAt: number;
  completedAt: number | null;
  /** Bytes per second, only while in progress. */
  speed: number;
  /** Whether the file still exists on disk (completed downloads). */
  exists: boolean;
}

export interface Shortcut {
  id: string;
  title: string;
  url: string;
  position: number;
}

export interface ClosedTab {
  id: string;
  url: string;
  title: string;
  closedAt: number;
}

export interface HistoryStats {
  totalVisits: number;
  /** Visits per day for the last 7 days, oldest first, with the date's epoch ms at local midnight. */
  perDay: Array<{ day: number; visits: number }>;
  topSites: Array<{ host: string; visits: number }>;
}

export interface BackupInfo {
  id: string;
  fileName: string;
  kind: "auto" | "manual";
  sizeBytes: number;
  createdAt: number;
}

export interface ProfileInfo {
  id: string;
  name: string;
  color: string;
}

export const SIDEBAR_ITEMS = ["bookmarks", "history", "downloads", "shield", "ai"] as const;
export const TOOLBAR_ITEMS = ["bookmark", "downloads", "shield", "layout", "sidebar", "ai"] as const;
export const ACCENT_PRESETS = ["#7c5cff", "#4f8dff", "#14b8a6", "#22c55e", "#f97316", "#ec4899", "#ef4444"] as const;

export const settingsSchema = z.object({
  startup: z.enum(["newtab", "restore", "urls"]),
  startupUrls: z.array(z.string().max(2048)).max(10),
  searchEngine: z.enum(Object.keys(SEARCH_ENGINES) as [keyof typeof SEARCH_ENGINES, ...(keyof typeof SEARCH_ENGINES)[]]),
  downloadDir: z.string().max(1024).nullable(),
  askWhereToSave: z.boolean(),
  tabLayout: z.enum(["horizontal", "vertical"]),
  sidebarPinned: z.boolean(),
  shieldEnabled: z.boolean(),
  blockPopups: z.boolean(),
  safeBrowsingEnabled: z.boolean(),
  secureDns: z.boolean(),
  secureDnsProvider: z.enum(["cloudflare", "google", "quad9"]),
  /** User filter rules in Adblock Plus / uBlock Origin syntax. */
  customRules: z.string().max(100_000),
  /** NVIDIA-hosted model id used by SIDB AI. */
  aiModel: z.string().max(100).regex(AI_MODEL_PATTERN),
  theme: z.enum(["dark", "light", "system"]),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  newTabBackground: z.enum(["scenery", "aurora", "midnight", "dusk", "custom"]),
  newTabClock: z.boolean(),
  newTabContinue: z.boolean(),
  newTabQuickActions: z.boolean(),
  bookmarksBar: z.boolean(),
  /** Send what you type in the address bar to your search engine to get suggestions. */
  searchSuggestions: z.boolean(),
  hiddenSidebarItems: z.array(z.enum(SIDEBAR_ITEMS)).max(10),
  hiddenToolbarItems: z.array(z.enum(TOOLBAR_ITEMS)).max(10),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  startup: "newtab",
  startupUrls: [],
  searchEngine: "google",
  downloadDir: null,
  askWhereToSave: false,
  tabLayout: "horizontal",
  sidebarPinned: true,
  shieldEnabled: true,
  blockPopups: true,
  safeBrowsingEnabled: false,
  secureDns: false,
  secureDnsProvider: "cloudflare",
  customRules: "",
  aiModel: DEFAULT_AI_MODEL,
  theme: "dark",
  accent: "#7c5cff",
  newTabBackground: "scenery",
  newTabClock: true,
  newTabContinue: true,
  newTabQuickActions: true,
  bookmarksBar: false,
  searchSuggestions: true,
  hiddenSidebarItems: [],
  hiddenToolbarItems: [],
};

/** Topics a renderer can subscribe to; the main process broadcasts when the data changes. */
export type DataTopic = "bookmarks" | "history" | "downloads" | "settings" | "shortcuts" | "profiles" | "shield" | "ai" | "appearance" | "resources" | "updates";
