/** Startup timeline. Times are milliseconds since the process started, so they include Electron's own boot. */
const marks: Array<{ name: string; atMs: number }> = [];

export function mark(name: string): void {
  marks.push({ name, atMs: Math.round(process.uptime() * 1000) });
}

export function getMarks(): ReadonlyArray<{ name: string; atMs: number }> {
  return marks;
}
