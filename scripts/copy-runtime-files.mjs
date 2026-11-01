// Copies the few files the built app reads at runtime that Vite does not bundle, so the packaged app needs no
// node_modules folder at all:
//  - Ghostery's element-hiding preload (registered on every browsing session by SIDB Shield; MPL-2.0, unchanged)
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(root, "package.json"));
const out = path.join(root, "dist-electron", "shield");
mkdirSync(out, { recursive: true });

const preloadPkg = path.dirname(require.resolve("@ghostery/adblocker-electron-preload/package.json"));
copyFileSync(path.join(preloadPkg, "dist", "index.cjs"), path.join(out, "cosmetic-preload.cjs"));
copyFileSync(path.join(preloadPkg, "LICENSE"), path.join(out, "cosmetic-preload.LICENSE.txt"));
console.log("runtime files copied to dist-electron/shield");
