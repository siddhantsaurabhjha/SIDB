import { app } from "electron";

const KB = 1024;
const MB = 1024 * 1024;

export interface ProcessGroup {
  count: number;
  /** Memory only this process holds (the honest "how much RAM does it use" number). */
  privateMB: number;
  /** Includes memory shared with other processes, so groups add up to more than reality. */
  workingSetMB: number;
  cpuPercent: number;
}

export interface Metrics {
  totalPrivateMB: number;
  totalWorkingSetMB: number;
  byType: Record<string, ProcessGroup>;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Memory and CPU of every SIDB process, grouped by kind (Browser, Tab, GPU, Utility...). */
export function processMetrics(): Metrics {
  const byType: Record<string, ProcessGroup> = {};
  let priv = 0;
  let ws = 0;
  for (const p of app.getAppMetrics()) {
    const g = (byType[p.type] ??= { count: 0, privateMB: 0, workingSetMB: 0, cpuPercent: 0 });
    const privateMB = (p.memory.privateBytes ?? 0) / KB; // reported in KB
    const workingMB = p.memory.workingSetSize / KB;
    g.count++;
    g.privateMB += privateMB;
    g.workingSetMB += workingMB;
    g.cpuPercent += p.cpu.percentCPUUsage;
    priv += privateMB;
    ws += workingMB;
  }
  for (const g of Object.values(byType)) {
    g.privateMB = round(g.privateMB);
    g.workingSetMB = round(g.workingSetMB);
    g.cpuPercent = round(g.cpuPercent);
  }
  return { totalPrivateMB: round(priv), totalWorkingSetMB: round(ws), byType };
}

export interface SystemMemory {
  totalMB: number;
  freeMB: number;
  usedPercent: number;
}

export function systemMemory(): SystemMemory {
  const m = process.getSystemMemoryInfo(); // KB
  const total = m.total / KB;
  const free = m.free / KB;
  return { totalMB: Math.round(total), freeMB: Math.round(free), usedPercent: total > 0 ? Math.round((1 - free / total) * 1000) / 10 : 0 };
}

export const bytesToMB = (b: number) => round(b / MB);
