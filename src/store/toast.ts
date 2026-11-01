import { create } from "zustand";

interface ToastStore {
  message: string | null;
  kind: "info" | "error";
  show(message: string, kind?: "info" | "error"): void;
  clear(): void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastStore>((set) => ({
  message: null,
  kind: "info",
  show: (message, kind = "info") => {
    clearTimeout(timer);
    set({ message, kind });
    timer = setTimeout(() => set({ message: null }), 6000);
  },
  clear: () => {
    clearTimeout(timer);
    set({ message: null });
  },
}));
