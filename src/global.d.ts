/// <reference types="vite/client" />
import type { SidbApi } from "../shared/ipc/channels";

declare global {
  interface Window {
    sidb: SidbApi;
  }
}

export {};
