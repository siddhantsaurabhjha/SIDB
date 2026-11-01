export interface FilterListInfo {
  id: string;
  title: string;
  description: string;
  url: string;
  enabled: boolean;
  /** Version or last-modified text taken from the list header, if present. */
  version: string | null;
  /** Epoch ms of the last successful download, null if never downloaded. */
  updatedAt: number | null;
  bytes: number;
}

export interface ShieldStatus {
  /** Master switch for this profile. */
  enabled: boolean;
  /** True once an engine with rules is loaded. */
  ready: boolean;
  updating: boolean;
  networkRules: number;
  cosmeticRules: number;
  lists: FilterListInfo[];
  lastCheck: number | null;
  lastSuccess: number | null;
  lastError: string | null;
  stats: { today: number; week: number; total: number; popupsToday: number };
  safeBrowsing: { enabled: boolean; keySet: boolean; secureStorage: boolean };
}

export interface ShieldException {
  host: string;
  createdAt: number;
}
