import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Sandboxed preload scripts can only require("electron"), so everything else is bundled.
export default defineConfig({
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("./shared", import.meta.url)) },
  },
  build: {
    outDir: "dist-electron/preload",
    emptyOutDir: true,
    minify: false,
    target: "node22",
    lib: {
      entry: "electron/preload/index.ts",
      formats: ["cjs"],
      fileName: () => "index.cjs",
    },
    rollupOptions: { external: ["electron"] },
  },
});
