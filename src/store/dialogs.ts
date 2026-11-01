import { useEffect } from "react";
import { create } from "zustand";

interface DialogStore {
  paletteOpen: boolean;
  paletteMode: "all" | "tabs";
  paletteInitial: string;
  qrText: string | null;
  openPalette(mode?: "all" | "tabs", initial?: string): void;
  closePalette(): void;
  openQr(text: string): void;
  closeQr(): void;
  /** Picture of the page shown in place of the (hidden) web view while a dialog is open. */
  snapshot: string | null;
}

export const useDialogs = create<DialogStore>((set) => ({
  paletteOpen: false,
  paletteMode: "all",
  paletteInitial: "",
  qrText: null,
  snapshot: null,
  openPalette: (paletteMode = "all", paletteInitial = "") => set({ paletteOpen: true, paletteMode, paletteInitial }),
  closePalette: () => set({ paletteOpen: false }),
  openQr: (qrText) => set({ qrText }),
  closeQr: () => set({ qrText: null }),
}));

/**
 * Web pages are native views above the UI, so HTML dialogs would hide behind them. While `open` is true the main
 * process swaps the page for a picture of itself.
 */
export function useDialogOverlay(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    window.sidb.layout.setOverlay(true);
    return () => window.sidb.layout.setOverlay(false);
  }, [open]);
}

export function connectOverlay(): () => void {
  return window.sidb.layout.onOverlay((snapshot) => useDialogs.setState({ snapshot }));
}
