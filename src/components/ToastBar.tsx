import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useToast } from "../store/toast";

/** Short status messages. A strip above the page (not a floating box) so the web view can't cover it. */
export function ToastBar() {
  const { message, kind, clear } = useToast();
  if (!message) return null;
  return (
    <div role="status" aria-live="polite" className={`flex h-9 shrink-0 items-center gap-2 border-b border-line px-4 text-[12px] ${kind === "error" ? "bg-red-500/15" : "bg-accent/15"}`}>
      {kind === "error" ? <CircleAlert size={14} className="text-red-400" /> : <CircleCheck size={14} className="text-accent" />}
      <span className="min-w-0 flex-1 truncate">{message}</span>
      <button aria-label="Dismiss message" className="icon-btn !h-6 !w-6" onClick={clear}>
        <X size={13} />
      </button>
    </div>
  );
}
