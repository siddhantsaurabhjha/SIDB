import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

const MAX_LOG_BYTES = 512 * 1024;

/**
 * Unexpected errors in the main process are written to `<userData>/logs/main.log` (and the console) instead of
 * Electron's default modal error box. On Windows that box blocks the whole app until someone clicks it, which froze
 * SIDB completely on a test machine. The log never contains page content, keys or history; only error messages and
 * code locations.
 */
export function installErrorLogging(): void {
  process.on("uncaughtException", (e) => logError("uncaught exception", e));
  process.on("unhandledRejection", (e) => logError("unhandled promise rejection", e));
}

export function logError(kind: string, e: unknown): void {
  const text = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : String(e);
  const line = `${new Date().toISOString()} [${kind}] ${text.slice(0, 4000)}\n`;
  console.error(`[sidb] ${kind}: ${text.slice(0, 2000)}`);
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "main.log");
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, line);
  } catch {
    /* logging must never throw */
  }
}
