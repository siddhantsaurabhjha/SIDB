import { app, powerMonitor } from "electron";
import { nextPressure, type MemoryPressure, type ResourceStats } from "../../../shared/resources";
import { processMetrics, systemMemory } from "../perf/metrics";
import { getProfiles } from "../profiles/instance";
import type { WindowContext } from "../windows/registry";
import { gpuStatus } from "./gpu";

const SAMPLE_MS = 30_000;

/**
 * Watches free system memory and the power source. It only reports: the UI offers to sleep background tabs
 * when memory runs low, and nothing is ever unloaded without the user asking for it.
 */
class ResourceMonitor {
  private pressure: MemoryPressure = "normal";
  private onBattery = false;
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer) return;
    this.onBattery = powerMonitor.isOnBatteryPower();
    this.sample();
    this.timer = setInterval(() => this.sample(), SAMPLE_MS);
    this.timer.unref();
    const power = (onBattery: boolean) => {
      if (this.onBattery === onBattery) return;
      this.onBattery = onBattery;
      getProfiles().broadcast("resources");
    };
    powerMonitor.on("on-battery", () => power(true));
    powerMonitor.on("on-ac", () => power(false));
    app.on("will-quit", () => this.timer && clearInterval(this.timer));
  }

  private sample(): void {
    const m = systemMemory();
    const free = m.totalMB > 0 ? (m.freeMB / m.totalMB) * 100 : Number.NaN;
    const next = nextPressure(this.pressure, free);
    if (next !== this.pressure) {
      this.pressure = next;
      getProfiles().broadcast("resources");
    }
  }

  /** Cheap summary for the UI's memory strip and power styling. */
  summary(): { pressure: MemoryPressure; onBattery: boolean } {
    return { pressure: this.pressure, onBattery: this.onBattery };
  }

  /** Full numbers for the Performance panel (reads process metrics, so only on request). */
  stats(ctx: WindowContext): ResourceStats {
    this.sample();
    const metrics = processMetrics();
    const byPid = new Map(app.getAppMetrics().map((p) => [p.pid, p]));
    const tabs = ctx.tabs.resourceTabs().map((t) => {
      const p = t.pid !== null ? byPid.get(t.pid) : undefined;
      return {
        id: t.id,
        title: t.title,
        url: t.url,
        sleeping: t.sleeping,
        memoryMB: p ? Math.round((p.memory.privateBytes ?? p.memory.workingSetSize) / 1024) : null,
        cpuPercent: p ? Math.round(p.cpu.percentCPUUsage * 10) / 10 : null,
        protectedReason: t.protectedReason,
      };
    });
    const byType: ResourceStats["byType"] = {};
    for (const [k, g] of Object.entries(metrics.byType)) byType[k] = { count: g.count, privateMB: g.privateMB, cpuPercent: g.cpuPercent };
    return { ...this.summary(), system: systemMemory(), sidbMB: metrics.totalPrivateMB, byType, tabs, gpu: gpuStatus() };
  }
}

let monitor: ResourceMonitor | null = null;

export function getResourceMonitor(): ResourceMonitor {
  return (monitor ??= new ResourceMonitor());
}
