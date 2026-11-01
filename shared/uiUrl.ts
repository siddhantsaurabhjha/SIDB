/** The SIDB interface is served from this private scheme (see electron/main/windows/uiProtocol.ts). */
export const UI_SCHEME = "sidb-app";
export const UI_HOST = "ui";
export const UI_URL = `${UI_SCHEME}://${UI_HOST}/index.html`;

/** True for the bundled interface page, or the Vite dev server origin during development. */
export function isUiUrl(url: string, devUrl?: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === `${UI_SCHEME}:`) return u.host === UI_HOST && u.pathname === "/index.html";
    return !!devUrl && u.origin === new URL(devUrl).origin;
  } catch {
    return false;
  }
}
