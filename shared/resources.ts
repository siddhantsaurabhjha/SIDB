/**
 * Pure resource-management rules (no Electron imports, so they are unit tested).
 * SIDB never closes or sleeps tabs on its own: these rules only decide when to *offer* it and which tabs are safe.
 */

export type MemoryPressure = "normal" | "elevated" | "critical";

/** Free system memory, in percent of total. Separate enter/leave levels stop the state flickering near a threshold. */
export const PRESSURE_LEVELS = {
  enterElevated: 15,
  enterCritical: 8,
  leaveCritical: 12, // critical -> elevated once free memory is above this
  leaveElevated: 20, // elevated -> normal once free memory is above this
} as const;

export function nextPressure(prev: MemoryPressure, freePercent: number): MemoryPressure {
  const L = PRESSURE_LEVELS;
  if (!Number.isFinite(freePercent)) return prev;
  if (freePercent < L.enterCritical) return "critical";
  if (prev === "critical") return freePercent > L.leaveCritical ? (freePercent > L.leaveElevated ? "normal" : "elevated") : "critical";
  if (freePercent < L.enterElevated) return "elevated";
  if (prev === "elevated") return freePercent > L.leaveElevated ? "normal" : "elevated";
  return "normal";
}

export interface SleepCandidate {
  id: string;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  loading: boolean;
  /** The page was given camera, microphone or screen access since it loaded. */
  capturing: boolean;
  /** Already asleep, or an internal sidb:// page (nothing to free). */
  idle: boolean;
  /** When the user last looked at the tab (ms). */
  lastActiveAt: number;
}

/** Why a tab must never be put to sleep, or null if it can be. */
export function protectedReason(t: SleepCandidate): string | null {
  if (t.idle) return "nothing to free";
  if (t.active) return "you are looking at it";
  if (t.audible) return "playing sound";
  if (t.capturing) return "using camera, microphone or screen";
  if (t.pinned) return "pinned";
  if (t.loading) return "still loading";
  return null;
}

/** Tabs that may sleep, least recently used first. */
export function sleepCandidates(tabs: SleepCandidate[]): string[] {
  return tabs
    .filter((t) => protectedReason(t) === null)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    .map((t) => t.id);
}

// ------------------------------------------------------------------ GPU crash guard ----------

/** Three GPU process crashes within ten minutes means hardware acceleration is unstable on this machine. */
export const GPU_CRASH_LIMIT = 3;
export const GPU_CRASH_WINDOW_MS = 10 * 60_000;

export interface GpuState {
  /** User setting. When false, SIDB starts with hardware acceleration off. */
  hardwareAcceleration: boolean;
  /** Set when SIDB turned acceleration off by itself after repeated crashes (shown in Settings). */
  autoDisabled: boolean;
  recentCrashes: number[];
}

export const DEFAULT_GPU_STATE: GpuState = { hardwareAcceleration: true, autoDisabled: false, recentCrashes: [] };

/** Records a GPU crash; turns acceleration off for the next start when crashes repeat. */
export function recordGpuCrash(state: GpuState, now: number): GpuState {
  const recentCrashes = [...state.recentCrashes.filter((t) => now - t < GPU_CRASH_WINDOW_MS), now].slice(-10);
  if (state.hardwareAcceleration && recentCrashes.length >= GPU_CRASH_LIMIT) {
    return { hardwareAcceleration: false, autoDisabled: true, recentCrashes: [] };
  }
  return { ...state, recentCrashes };
}

/** Reads a stored GPU state defensively; anything malformed falls back to the defaults. */
export function parseGpuState(raw: unknown): GpuState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_GPU_STATE };
  const r = raw as Record<string, unknown>;
  return {
    hardwareAcceleration: typeof r.hardwareAcceleration === "boolean" ? r.hardwareAcceleration : true,
    autoDisabled: r.autoDisabled === true,
    recentCrashes: Array.isArray(r.recentCrashes) ? r.recentCrashes.filter((n): n is number => typeof n === "number" && Number.isFinite(n)).slice(-10) : [],
  };
}

// ------------------------------------------------------------------ stats sent to the UI ------

export interface TabResourceInfo {
  id: string;
  title: string;
  url: string;
  sleeping: boolean;
  /** Private memory of the tab's renderer process in MB, or null if it has none (asleep, internal page). Tabs of one site can share a process. */
  memoryMB: number | null;
  cpuPercent: number | null;
  /** Why it can't sleep, or null. */
  protectedReason: string | null;
}

export interface ResourceStats {
  pressure: MemoryPressure;
  onBattery: boolean;
  system: { totalMB: number; freeMB: number; usedPercent: number };
  /** All SIDB processes together (private memory). */
  sidbMB: number;
  byType: Record<string, { count: number; privateMB: number; cpuPercent: number }>;
  tabs: TabResourceInfo[];
  gpu: { enabledNow: boolean; enabledNextStart: boolean; autoDisabled: boolean };
}
