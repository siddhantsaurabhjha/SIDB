export interface TabError {
  code: number;
  description: string;
  url: string;
}

export interface TabState {
  id: string;
  /** Current URL. `sidb://<page>` for internal pages. */
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  pinned: boolean;
  muted: boolean;
  audible: boolean;
  /** True when the tab shows a renderer-drawn sidb:// page instead of a web view. */
  internal: boolean;
  /** "secure" = valid https, "insecure" = http, "internal" = sidb://, "none" = nothing loaded. */
  security: "secure" | "insecure" | "internal" | "none";
  /** Page zoom factor, 1 = 100%. */
  zoom: number;
  /** Set when the main-frame load failed; the renderer then draws an error page. */
  error: TabError | null;
  /** Requests Shield blocked since this page started loading. */
  blocked: number;
  popupsBlocked: number;
  /** "site-off" = Shield disabled for this site by the user, "off" = disabled for the whole profile. */
  shield: "on" | "site-off" | "off";
  /** Set when Safe Browsing flagged the page; the renderer then draws a warning page instead of the site. */
  warning: { url: string; threats: string[] } | null;
  /** Tab group this tab belongs to, if any. Tabs of a group are always next to each other. */
  groupId: string | null;
  /**
   * Put to sleep by the user to free memory: the page was unloaded and reloads when the tab is opened again.
   * Optional so older fixtures and saved data stay valid.
   */
  sleeping?: boolean;
  /** A compatibility notice for the current page, shown as a strip above it. Cleared by the next navigation. */
  notice?: { kind: "google-signin-blocked"; /** The website being signed in to with Google, or null for a Google Account sign-in. */ site: string | null } | null;
}

export const GROUP_COLORS = ["#7c5cff", "#4f8dff", "#14b8a6", "#22c55e", "#f59e0b", "#f97316", "#ec4899", "#ef4444"] as const;

export interface TabGroup {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
}

export interface TabsSnapshot {
  tabs: TabState[];
  activeTabId: string | null;
  /** True for private browsing windows. */
  isPrivate: boolean;
  groups: TabGroup[];
}

export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PermissionKind = "camera" | "microphone" | "camera+microphone" | "location" | "notifications" | "clipboard" | "pointer-lock" | "screen-capture" | "other";

export interface PermissionPrompt {
  id: string;
  tabId: string;
  origin: string;
  kind: PermissionKind;
}

export type PermissionDecision = "once" | "site" | "block";

export interface FindResult {
  tabId: string;
  activeMatchOrdinal: number;
  matches: number;
}

/** Commands the main process asks the renderer UI to perform (from global shortcuts). */
export type UiCommand = "focus-address" | "find" | "escape" | "toggle-sidebar" | "palette" | "tab-search" | "toggle-bookmarks-bar" | "screenshot";
