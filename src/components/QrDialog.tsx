import { Copy, Download, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MAX_QR_CHARS, qrDataUrl } from "../lib/qr";
import { useDialogOverlay, useDialogs } from "../store/dialogs";
import { useToast } from "../store/toast";

/** QR code generator. Starts with the current page's address, but any text can be typed. */
export function QrDialog() {
  const initial = useDialogs((s) => s.qrText);
  const close = useDialogs((s) => s.closeQr);
  const [text, setText] = useState("");
  useDialogOverlay(initial !== null);

  useEffect(() => {
    if (initial !== null) setText(initial);
  }, [initial]);
  useEffect(() => {
    if (initial === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [initial, close]);

  const image = useMemo(() => qrDataUrl(text), [text]);
  if (initial === null) return null;
  const toast = useToast.getState();

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="QR code" className="glass force-dark w-[22rem] rounded-2xl p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">QR code</h2>
          <button aria-label="Close" className="icon-btn" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="mb-3 grid h-64 place-items-center rounded-xl bg-white">{image ? <img src={image} alt="QR code for the text below" className="h-60 w-60" style={{ imageRendering: "pixelated" }} /> : <span className="px-6 text-center text-[12px] text-neutral-600">{text.trim() ? `Too long for a QR code (limit ${MAX_QR_CHARS} characters).` : "Type something to encode."}</span>}</div>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={2} aria-label="Text to encode" spellCheck={false} className="mb-3 w-full resize-none rounded-lg border border-line bg-black/30 p-2 text-[12px]" />
        <div className="flex gap-2">
          <button
            disabled={!image}
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line text-[12px] hover:bg-white/10 disabled:opacity-40"
            onClick={() => image && void window.sidb.data.capture.copyImage({ dataUrl: image }).then((r) => toast.show(r.message, r.ok ? "info" : "error"))}
          >
            <Copy size={13} /> Copy image
          </button>
          <button
            disabled={!image}
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent text-[12px] font-semibold disabled:opacity-40"
            onClick={() =>
              image &&
              void window.sidb.data.capture.saveImage({ dataUrl: image, name: "SIDB QR code" }).then((r) => {
                if (r.ok) toast.show(`QR code saved${r.path ? `: ${r.path}` : "."}`);
                else if (r.message !== "Cancelled.") toast.show(r.message, "error");
              })
            }
          >
            <Download size={13} /> Save PNG
          </button>
        </div>
      </div>
    </div>
  );
}
