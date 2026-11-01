import { KeyRound } from "lucide-react";
import { useState } from "react";
import { useLive } from "../../hooks/useLive";

const errMsg = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "") : String(e));

/** Shown when no NVIDIA key is saved. The key is stored encrypted by the OS and never shown again. */
export function KeySetup({ compact }: { compact?: boolean }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const status = useLive(() => window.sidb.data.ai.status(), ["settings"]);
  const secure = status.data?.secureStorage ?? true;

  return (
    <form
      className={`rounded-xl border border-line bg-white/5 ${compact ? "p-3" : "p-4"}`}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        void window.sidb.data.ai
          .setKey({ key })
          .then(() => setKey(""))
          .catch((er) => setError(errMsg(er)));
      }}
    >
      <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold">
        <KeyRound size={15} className="text-accent" /> Connect SIDB AI
      </div>
      <p className="mb-2 text-[11px] text-muted">
        SIDB AI uses your own NVIDIA API key (free to create at build.nvidia.com). It is saved encrypted by your operating system and is only used for requests you start. Browsing works without it.
      </p>
      {!secure && <p className="mb-2 text-[11px] text-amber-300">Secure storage is not available on this system, so a key can't be saved safely.</p>}
      <div className="flex gap-2">
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="nvapi-..." aria-label="NVIDIA API key" autoComplete="off" className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-black/30 px-3 text-[12px]" />
        <button type="submit" disabled={!key || !secure} className="h-8 rounded-lg bg-accent px-3 text-[12px] font-semibold disabled:opacity-40">
          Save
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
    </form>
  );
}
