import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

export default defineConfig({
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("./shared", import.meta.url)) },
  },
  build: {
    outDir: "dist-electron/main",
    emptyOutDir: true,
    minify: false,
    target: "node22",
    lib: {
      // buildWorker is a separate entry: it runs in a worker thread (filter engine builds).
      entry: { index: "electron/main/index.ts", buildWorker: "electron/main/shield/buildWorker.ts" },
      formats: ["cjs"],
      fileName: (_format, name) => `${name}.cjs`,
    },
    rollupOptions: {
      external: ["electron", "node:sqlite", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
  },
});
