// Dev runner: builds main/preload, starts the Vite dev server, then launches Electron against it.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer, build } from "vite";

const require = createRequire(import.meta.url);
const electronPath = require("electron");

await build({ configFile: "vite.main.config.ts", logLevel: "warn" });
await build({ configFile: "vite.preload.config.ts", logLevel: "warn" });

const server = await createServer({ configFile: "vite.config.ts" });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? "http://localhost:5173/";
console.log(`[sidb] renderer at ${url}`);

const child = spawn(electronPath, ["."], {
  stdio: "inherit",
  env: { ...process.env, SIDB_DEV_URL: url },
});
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
