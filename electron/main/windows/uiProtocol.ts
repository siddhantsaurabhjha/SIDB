import { net, protocol, session } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { UI_SCHEME } from "../../../shared/uiUrl";
import { uiFileFor } from "./uiPath";

/** Folder with the built UI. Main-process code is bundled into dist-electron/main, next to dist/. */
const UI_ROOT = path.resolve(__dirname, "../../dist");

/**
 * The SIDB interface is served from `sidb-app://ui/` instead of `file://`. A file:// page can be given access to any
 * local file, so the "GrantFileProtocolExtraPrivileges" fuse can be turned off in packaged builds. This scheme is only
 * registered on the default session (used by the interface windows), so web pages in tabs can't load it at all.
 *
 * Must be called before the app is ready.
 */
export function registerUiScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: UI_SCHEME, privileges: { standard: true, secure: true, codeCache: true } }]);
}

/** Serves the UI files. Call once the app is ready. */
export function handleUiScheme(): void {
  session.defaultSession.protocol.handle(UI_SCHEME, async (request) => {
    const file = request.method === "GET" ? uiFileFor(request.url, UI_ROOT) : null;
    if (!file) return new Response("Not found", { status: 404 });
    try {
      const res = await net.fetch(pathToFileURL(file).href); // also reads from inside app.asar
      return res.ok ? res : new Response("Not found", { status: 404 });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
