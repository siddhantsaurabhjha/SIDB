import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** All timestamps are Unix epoch milliseconds. */

export const bookmarkFolders = sqliteTable(
  "bookmark_folders",
  {
    id: text("id").primaryKey(),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("bookmark_folders_parent_idx").on(t.parentId)],
);

export const bookmarks = sqliteTable(
  "bookmarks",
  {
    id: text("id").primaryKey(),
    folderId: text("folder_id").references(() => bookmarkFolders.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    favicon: text("favicon"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("bookmarks_folder_idx").on(t.folderId), index("bookmarks_url_idx").on(t.url)],
);

export const historyEntries = sqliteTable(
  "history_entries",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    title: text("title").notNull().default(""),
    favicon: text("favicon"),
    visitCount: integer("visit_count").notNull().default(1),
    lastVisit: integer("last_visit").notNull(),
  },
  (t) => [uniqueIndex("history_url_uq").on(t.url), index("history_last_visit_idx").on(t.lastVisit)],
);

export const downloadRecords = sqliteTable(
  "download_records",
  {
    id: text("id").primaryKey(),
    fileName: text("file_name").notNull(),
    savePath: text("save_path").notNull(),
    sourceUrl: text("source_url").notNull(),
    mimeType: text("mime_type"),
    totalBytes: integer("total_bytes").notNull().default(0),
    receivedBytes: integer("received_bytes").notNull().default(0),
    state: text("state", { enum: ["in_progress", "paused", "completed", "cancelled", "failed"] }).notNull(),
    riskWarning: text("risk_warning"),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (t) => [index("downloads_started_idx").on(t.startedAt)],
);

export const browserSettings = sqliteTable("browser_settings", {
  key: text("key").primaryKey(),
  /** JSON-encoded value. */
  value: text("value").notNull(),
});

export const sessionMetadata = sqliteTable("session_metadata", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  title: text("title").notNull().default(""),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  position: integer("position").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  zoom: real("zoom").notNull().default(1),
  groupId: text("group_id"),
});

export const sessionGroups = sqliteTable("session_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  collapsed: integer("collapsed", { mode: "boolean" }).notNull().default(false),
});

export const recentlyClosedTabs = sqliteTable(
  "recently_closed_tabs",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    title: text("title").notNull().default(""),
    closedAt: integer("closed_at").notNull(),
  },
  (t) => [index("recently_closed_at_idx").on(t.closedAt)],
);

export const customShortcuts = sqliteTable("custom_shortcuts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  position: integer("position").notNull().default(0),
});

export const sitePermissionSettings = sqliteTable(
  "site_permission_settings",
  {
    origin: text("origin").notNull(),
    kind: text("kind").notNull(),
    decision: text("decision", { enum: ["allow", "block"] }).notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("site_permission_uq").on(t.origin, t.kind)],
);

export const backupMetadata = sqliteTable("backup_metadata", {
  id: text("id").primaryKey(),
  fileName: text("file_name").notNull(),
  kind: text("kind", { enum: ["auto", "manual"] }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const shieldExceptions = sqliteTable("shield_exceptions", {
  /** Hostname (without www.) where blocking is turned off. */
  host: text("host").primaryKey(),
  createdAt: integer("created_at").notNull(),
});

/** Requests blocked per local day (epoch ms of local midnight). */
export const shieldStats = sqliteTable("shield_stats", {
  day: integer("day").primaryKey(),
  blocked: integer("blocked").notNull().default(0),
  popups: integer("popups").notNull().default(0),
});

export const aiConversations = sqliteTable(
  "ai_conversations",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("ai_conversations_updated_idx").on(t.updatedAt)],
);

export const aiMessages = sqliteTable(
  "ai_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ai_messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/** Tables included in backups/imports, in dependency order (parents first). */
export const BACKUP_TABLES = [
  "bookmark_folders",
  "bookmarks",
  "history_entries",
  "download_records",
  "browser_settings",
  "custom_shortcuts",
  "site_permission_settings",
  "shield_exceptions",
] as const;
