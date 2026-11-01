import { randomUUID } from "node:crypto";
import type { Session, WebContents } from "electron";
import type { PermissionDecision, PermissionKind, PermissionPrompt } from "../../../shared/types/browser";

/** Permissions that are safe enough to grant without asking. */
const AUTO_ALLOW = new Set(["fullscreen", "clipboard-sanitized-write"]);
const CAPTURE_KINDS = new Set<PermissionKind>(["camera", "microphone", "camera+microphone", "screen-capture"]);

interface Pending {
  prompt: PermissionPrompt;
  key: string;
  callbacks: Array<(granted: boolean) => void>;
}

function kindOf(permission: string, mediaTypes?: string[]): PermissionKind | null {
  switch (permission) {
    case "media": {
      const video = mediaTypes?.includes("video");
      const audio = mediaTypes?.includes("audio");
      return video && audio ? "camera+microphone" : video ? "camera" : "microphone";
    }
    case "geolocation":
      return "location";
    case "notifications":
      return "notifications";
    case "clipboard-read":
      return "clipboard";
    case "pointerLock":
      return "pointer-lock";
    case "display-capture":
      return "screen-capture";
    default:
      return null; // everything else is denied without a prompt
  }
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

export interface PermissionStore {
  load(): Promise<Array<{ origin: string; kind: string; decision: "allow" | "block" }>>;
  save(origin: string, kind: string, decision: "allow" | "block"): Promise<void>;
}

/**
 * "Ask by default" permission policy for one session.
 * Site decisions persist through `store` (normal profiles); private sessions keep them in memory only.
 */
export class PermissionManager {
  private pending: Pending[] = [];
  private remembered = new Map<string, "allow" | "block">();

  constructor(
    session: Session,
    tabIdOf: (wc: WebContents) => string | null,
    private readonly onChange: (prompts: PermissionPrompt[]) => void,
    private readonly store: PermissionStore | null = null,
    /** Told when a tab is given camera, microphone or screen access (such tabs are never put to sleep). */
    private readonly onCaptureGranted: (tabId: string) => void = () => undefined,
  ) {
    void store?.load().then((rows) => {
      for (const r of rows) this.remembered.set(`${r.origin}|${r.kind}`, r.decision);
    }).catch(() => undefined);

    session.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (AUTO_ALLOW.has(permission)) return callback(true);
      const mediaTypes = "mediaTypes" in details ? (details.mediaTypes as string[] | undefined) : undefined;
      const kind = kindOf(permission, mediaTypes);
      const origin = originOf(details.requestingUrl);
      const tabId = tabIdOf(wc);
      if (!kind || !origin || !tabId) return callback(false);

      const key = `${origin}|${kind}`;
      const isCapture = CAPTURE_KINDS.has(kind);
      const reply = (granted: boolean) => {
        if (granted && isCapture) this.onCaptureGranted(tabId);
        callback(granted);
      };
      const known = this.remembered.get(key);
      if (known) return reply(known === "allow");

      const existing = this.pending.find((p) => p.key === key && p.prompt.tabId === tabId);
      if (existing) {
        existing.callbacks.push(reply);
        return;
      }
      this.pending.push({ key, callbacks: [reply], prompt: { id: randomUUID(), tabId, origin, kind } });
      this.emit();
    });

    session.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
      if (AUTO_ALLOW.has(permission)) return true;
      const mediaType = "mediaType" in details ? (details.mediaType as string | undefined) : undefined;
      const kind = kindOf(permission, mediaType && mediaType !== "unknown" ? [mediaType] : undefined);
      const origin = originOf(requestingOrigin);
      return !!kind && !!origin && this.remembered.get(`${origin}|${kind}`) === "allow";
    });
  }

  list(): PermissionPrompt[] {
    return this.pending.map((p) => ({ ...p.prompt }));
  }

  respond(id: string, decision: PermissionDecision): void {
    const entry = this.pending.find((p) => p.prompt.id === id);
    if (!entry) return;
    this.pending = this.pending.filter((p) => p !== entry);
    const granted = decision !== "block";
    if (decision !== "once") {
      const value = granted ? "allow" : "block";
      this.remembered.set(entry.key, value);
      void this.store?.save(entry.prompt.origin, entry.prompt.kind, value).catch(() => undefined);
    }
    entry.callbacks.forEach((cb) => cb(granted));
    this.emit();
  }

  /** Deny and drop prompts of a tab that navigated away or closed. */
  dropForTab(tabId: string): void {
    const dropped = this.pending.filter((p) => p.prompt.tabId === tabId);
    if (dropped.length === 0) return;
    this.pending = this.pending.filter((p) => p.prompt.tabId !== tabId);
    dropped.forEach((p) => p.callbacks.forEach((cb) => cb(false)));
    this.emit();
  }

  private emit(): void {
    this.onChange(this.list());
  }
}
