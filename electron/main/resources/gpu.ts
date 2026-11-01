import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { parseGpuState, recordGpuCrash, type GpuState } from "../../../shared/resources";

/**
 * Hardware acceleration switch and crash-loop guard. The choice applies from the next start, because Electron
 * only allows turning acceleration off before the app is ready.
 */
const file = () => path.join(app.getPath("userData"), "gpu.json");
let state: GpuState | null = null;
let enabledNow = true;

function read(): GpuState {
  try {
    return parseGpuState(JSON.parse(fs.readFileSync(file(), "utf8")));
  } catch {
    return parseGpuState(null);
  }
}

function write(next: GpuState): void {
  state = next;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(next));
  } catch {
    /* not fatal: the guard simply starts fresh next time */
  }
}

/** Must be called before `app.whenReady()`. */
export function applyGpuPreference(): void {
  state = read();
  enabledNow = state.hardwareAcceleration;
  if (!enabledNow) app.disableHardwareAcceleration();

  app.on("child-process-gone", (_e, details) => {
    if (details.type !== "GPU" || details.reason === "clean-exit" || details.reason === "killed") return;
    const before = state ?? read();
    const next = recordGpuCrash(before, Date.now());
    write(next);
    if (before.hardwareAcceleration && !next.hardwareAcceleration) {
      console.warn("[sidb] the graphics process keeps crashing; hardware acceleration will be off from the next start");
    }
  });
}

export function gpuStatus(): { enabledNow: boolean; enabledNextStart: boolean; autoDisabled: boolean } {
  const s = state ?? read();
  return { enabledNow, enabledNextStart: s.hardwareAcceleration, autoDisabled: s.autoDisabled };
}

/** The user's choice in Settings. Takes effect after a restart. */
export function setHardwareAcceleration(enabled: boolean): void {
  write({ hardwareAcceleration: enabled, autoDisabled: false, recentCrashes: [] });
}
