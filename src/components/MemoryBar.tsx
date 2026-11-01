import { MemoryStick, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { MemoryPressure } from "../../shared/resources";

/**
 * Shown when the computer runs low on memory. It only offers to put background tabs to sleep;
 * nothing happens unless the user presses the button. "Not now" hides it until memory recovers and runs low again.
 */
export function MemoryBar({ pressure }: { pressure: MemoryPressure }) {
  const [dismissed, setDismissed] = useState(false);
  const [sleepable, setSleepable] = useState(0);
  const low = pressure !== "normal";

  useEffect(() => {
    if (!low) {
      setDismissed(false); // recovered: offer again next time
      return;
    }
    let alive = true;
    void window.sidb.data.resources
      .stats()
      .then((s) => alive && setSleepable(s.tabs.filter((t) => t.protectedReason === null).length))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [low, pressure]);

  if (!low || dismissed || sleepable === 0) return null;
  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-400/40 bg-amber-500/15 px-4 py-2">
      <MemoryStick size={16} className="text-amber-300" />
      <span className="min-w-0 flex-1 text-[13px]">
        {pressure === "critical" ? "Your computer is very low on memory." : "Your computer is running low on memory."} Putting {sleepable} background tab{sleepable === 1 ? "" : "s"} to sleep frees memory. They reload when you open them.
      </span>
      <button
        className="h-8 rounded-lg bg-accent px-3 text-[12px] font-semibold hover:brightness-110"
        onClick={() => void window.sidb.data.resources.sleepBackground().then(() => setDismissed(true))}
      >
        Sleep {sleepable} tab{sleepable === 1 ? "" : "s"}
      </button>
      <button aria-label="Not now" className="rounded p-1 hover:bg-white/10" onClick={() => setDismissed(true)}>
        <X size={14} />
      </button>
    </div>
  );
}
