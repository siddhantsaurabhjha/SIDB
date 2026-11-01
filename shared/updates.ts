/**
 * Update rules (pure, unit tested). SIDB only *checks* GitHub Releases and tells the user; it never downloads or runs
 * an installer by itself. Installing stays a manual step until signed automatic updates exist (blueprint section 18).
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** Pre-release identifiers ("beta.2" -> ["beta", "2"]); empty for a normal release. */
  pre: string[];
}

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text: string): Version | null {
  const m = SEMVER.exec(text.trim());
  if (!m) return null;
  const v = { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split(".") : [] };
  return [v.major, v.minor, v.patch].every(Number.isSafeInteger) ? v : null;
}

/** Semantic Versioning 2.0 precedence: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: Version, b: Version): number {
  for (const k of ["major", "minor", "patch"] as const) if (a[k] !== b[k]) return a[k] - b[k];
  if (a.pre.length === 0 || b.pre.length === 0) return (a.pre.length === 0 ? 1 : 0) - (b.pre.length === 0 ? 1 : 0);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn && Number(x) !== Number(y)) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** "owner/name" as GitHub allows it. */
export const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export interface ReleaseInfo {
  version: string;
  /** The release's page on github.com (checked to belong to the configured repository). */
  url: string;
  name: string;
  /** Release notes as plain text, shortened. */
  notes: string;
  publishedAt: number | null;
}

/**
 * Validates GitHub's "latest release" answer. Drafts and pre-releases are ignored, the tag must be a version, and the
 * page address must be on github.com under the configured repository, so a strange answer can never send the user
 * somewhere else.
 */
export function parseLatestRelease(raw: unknown, repo: string): ReleaseInfo | null {
  if (!raw || typeof raw !== "object" || !REPO_PATTERN.test(repo)) return null;
  const r = raw as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return null;
  const tag = typeof r.tag_name === "string" ? r.tag_name : "";
  const v = parseVersion(tag);
  if (!v || v.pre.length > 0) return null;
  const url = typeof r.html_url === "string" ? r.html_url : "";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const prefix = `/${repo.toLowerCase()}/releases/`;
  if (u.protocol !== "https:" || u.hostname !== "github.com" || u.username || u.password || !u.pathname.toLowerCase().startsWith(prefix)) return null;
  const published = typeof r.published_at === "string" ? Date.parse(r.published_at) : Number.NaN;
  return {
    version: `${v.major}.${v.minor}.${v.patch}`,
    url: u.href,
    name: (typeof r.name === "string" && r.name.trim() ? r.name : tag).slice(0, 120),
    notes: (typeof r.body === "string" ? r.body : "").replace(/\r\n/g, "\n").slice(0, 4000),
    publishedAt: Number.isFinite(published) ? published : null,
  };
}

/** True when `latest` is newer than the running version. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  return !!a && !!b && compareVersions(a, b) > 0;
}

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60_000;

/** Whether an automatic check is due (manual checks are always allowed). */
export function checkDue(lastCheckedAt: number | null, now: number): boolean {
  return lastCheckedAt === null || now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS || now < lastCheckedAt;
}

export interface UpdateStatus {
  current: string;
  /** "owner/name" of the GitHub repository releases come from, or null when not set up yet. */
  repo: string | null;
  /** Checks only run in installed builds, not when SIDB runs from source. */
  packaged: boolean;
  autoCheck: boolean;
  checking: boolean;
  lastCheckedAt: number | null;
  latest: ReleaseInfo | null;
  available: boolean;
  error: string | null;
}
