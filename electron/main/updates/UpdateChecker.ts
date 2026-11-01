import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { checkDue, isNewer, parseLatestRelease, REPO_PATTERN, type ReleaseInfo, type UpdateStatus } from "../../../shared/updates";
import { getProfiles } from "../profiles/instance";

const FIRST_CHECK_DELAY_MS = 60_000;
const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;

interface Stored {
  autoCheck: boolean;
  lastCheckedAt: number | null;
  latest: ReleaseInfo | null;
}

/** "owner/name" from package.json ("sidb.updates.github"), or null when not set up. */
function configuredRepo(): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf8")) as { sidb?: { updates?: { github?: unknown } } };
    const repo = pkg.sidb?.updates?.github;
    return typeof repo === "string" && REPO_PATTERN.test(repo) ? repo : null;
  } catch {
    return null;
  }
}

/**
 * Looks for a newer SIDB on GitHub Releases: once a day in installed builds (if allowed), or when the user presses
 * "Check now". It sends one anonymous request to api.github.com and nothing about the user. It never downloads or runs
 * anything; the user opens the release page and installs by hand.
 */
class UpdateChecker {
  private readonly file = path.join(app.getPath("userData"), "updates.json");
  private readonly repo = configuredRepo();
  private stored: Stored = { autoCheck: true, lastCheckedAt: null, latest: null };
  private checking = false;
  private error: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    this.stored = this.read();
    if (!app.isPackaged || !this.repo) return;
    const tick = () => {
      if (this.stored.autoCheck && checkDue(this.stored.lastCheckedAt, Date.now())) void this.check();
    };
    setTimeout(tick, FIRST_CHECK_DELAY_MS).unref();
    this.timer = setInterval(tick, 60 * 60_000); // looks every hour whether the daily check is due
    this.timer.unref();
  }

  status(): UpdateStatus {
    const latest = this.stored.latest;
    return {
      current: app.getVersion(),
      repo: this.repo,
      packaged: app.isPackaged,
      autoCheck: this.stored.autoCheck,
      checking: this.checking,
      lastCheckedAt: this.stored.lastCheckedAt,
      latest,
      available: !!latest && isNewer(latest.version, app.getVersion()),
      error: this.error,
    };
  }

  setAutoCheck(on: boolean): void {
    this.stored = { ...this.stored, autoCheck: on };
    this.write();
    getProfiles().broadcast("updates");
  }

  /** The release page to open, only if it is a newer version that passed validation. */
  releaseUrl(): string | null {
    const s = this.status();
    return s.available && s.latest ? s.latest.url : null;
  }

  async check(): Promise<UpdateStatus> {
    if (!this.repo) {
      this.error = "Update source is not set up in this build.";
      return this.status();
    }
    if (this.checking) return this.status();
    this.checking = true;
    getProfiles().broadcast("updates");
    try {
      const res = await fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": `SIDB/${app.getVersion()}` },
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 404) {
        // No published release yet (GitHub answers 404 for "latest" then).
        this.stored = { ...this.stored, lastCheckedAt: Date.now(), latest: null };
        this.error = null;
      } else if (!res.ok) {
        this.error = res.status === 403 || res.status === 429 ? "GitHub is limiting requests right now. Try again later." : `GitHub answered ${res.status}.`;
      } else {
        const text = await res.text();
        if (text.length > MAX_RESPONSE_BYTES) throw new Error("answer too large");
        const latest = parseLatestRelease(JSON.parse(text), this.repo);
        this.stored = { ...this.stored, lastCheckedAt: Date.now(), latest };
        this.error = latest ? null : "The latest release could not be read.";
      }
      this.write();
    } catch (e) {
      this.error = e instanceof Error && e.name === "TimeoutError" ? "GitHub did not answer in time." : "Could not reach GitHub. Check your connection.";
    } finally {
      this.checking = false;
      getProfiles().broadcast("updates");
    }
    return this.status();
  }

  private read(): Stored {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<Stored>;
      const latest = raw.latest && this.repo ? parseLatestRelease(this.asGithub(raw.latest), this.repo) : null;
      return {
        autoCheck: raw.autoCheck !== false,
        lastCheckedAt: typeof raw.lastCheckedAt === "number" && Number.isFinite(raw.lastCheckedAt) ? raw.lastCheckedAt : null,
        latest,
      };
    } catch {
      return { autoCheck: true, lastCheckedAt: null, latest: null };
    }
  }

  /** Stored releases are re-validated with the same rules as fresh answers. */
  private asGithub(r: ReleaseInfo): Record<string, unknown> {
    return { tag_name: `v${r.version}`, html_url: r.url, name: r.name, body: r.notes, published_at: r.publishedAt ? new Date(r.publishedAt).toISOString() : null };
  }

  private write(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.stored));
    } catch {
      /* not fatal */
    }
  }
}

let checker: UpdateChecker | null = null;

export function getUpdates(): UpdateChecker {
  return (checker ??= new UpdateChecker());
}
