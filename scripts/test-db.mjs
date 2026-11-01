// Runs the database tests under Electron's bundled Node (24), which ships node:sqlite.
// The system Node may be older, so ELECTRON_RUN_AS_NODE makes the electron binary behave like `node`.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));

const child = spawn(electronPath, [vitest, "--run", "tests/db", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
child.on("exit", (code) => process.exit(code ?? 1));
