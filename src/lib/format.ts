export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDay(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  const label = d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return diff === 0 ? `Today - ${label}` : diff === 1 ? `Yesterday - ${label}` : label;
}

export function formatEta(secondsLeft: number): string {
  if (!Number.isFinite(secondsLeft) || secondsLeft <= 0) return "";
  if (secondsLeft < 60) return `${Math.ceil(secondsLeft)}s left`;
  if (secondsLeft < 3600) return `${Math.ceil(secondsLeft / 60)} mins left`;
  return `${Math.round(secondsLeft / 3600)} h left`;
}
