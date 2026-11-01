import { Bell, Camera, ClipboardPaste, MapPin, Mic, MousePointer2, ScreenShare, ShieldQuestion } from "lucide-react";
import type { ReactNode } from "react";
import type { PermissionKind } from "../../shared/types/browser";
import { useTabs } from "../store/tabs";

const KIND: Record<PermissionKind, { label: string; icon: ReactNode }> = {
  camera: { label: "use your camera", icon: <Camera size={16} /> },
  microphone: { label: "use your microphone", icon: <Mic size={16} /> },
  "camera+microphone": { label: "use your camera and microphone", icon: <Camera size={16} /> },
  location: { label: "know your location", icon: <MapPin size={16} /> },
  notifications: { label: "show notifications", icon: <Bell size={16} /> },
  clipboard: { label: "read your clipboard", icon: <ClipboardPaste size={16} /> },
  "pointer-lock": { label: "lock your mouse pointer", icon: <MousePointer2 size={16} /> },
  "screen-capture": { label: "capture your screen", icon: <ScreenShare size={16} /> },
  other: { label: "use a browser feature", icon: <ShieldQuestion size={16} /> },
};

/** Permission prompt for the active tab. Shown above the page so it can't be covered by the web view. */
export function PermissionBar() {
  const activeTabId = useTabs((s) => s.activeTabId);
  const prompt = useTabs((s) => s.prompts.find((p) => p.tabId === s.activeTabId));
  if (!prompt || !activeTabId) return null;
  const info = KIND[prompt.kind];
  const respond = (d: "once" | "site" | "block") => void window.sidb.permissions.respond(prompt.id, d);

  return (
    <div role="alertdialog" aria-label="Permission request" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-accent/40 bg-accent/15 px-4 py-2">
      <span className="text-accent">{info.icon}</span>
      <span className="min-w-0 flex-1 text-[13px]">
        <strong className="font-semibold">{prompt.origin}</strong> wants to {info.label}
      </span>
      <button className="h-8 rounded-lg bg-accent px-3 text-[12px] font-semibold hover:brightness-110" onClick={() => respond("once")}>
        Allow this time
      </button>
      <button className="h-8 rounded-lg border border-line px-3 text-[12px] hover:bg-white/10" onClick={() => respond("site")}>
        Allow on this site
      </button>
      <button className="h-8 rounded-lg border border-line px-3 text-[12px] text-red-300 hover:bg-white/10" onClick={() => respond("block")}>
        Block
      </button>
    </div>
  );
}
