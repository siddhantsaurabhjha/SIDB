/**
 * Site compatibility notices. Pure functions (no Electron), unit tested.
 *
 * Google blocks Google Account sign-in in browsers built on embedded frameworks (CEF, Electron) since January 2021.
 * SIDB is one, so Google answers with its "Couldn't sign you in" page. SIDB does not try to get around that check;
 * it explains what happened and, only if the user asks, continues the same sign-in in the system's default browser.
 */

export const GOOGLE_SIGNIN_HELP_URL = "https://support.google.com/accounts/answer/7675428";

/** Address Google's sign-in falls back to when the rejection page carries no usable "continue" address. */
export const GOOGLE_SIGNIN_URL = "https://accounts.google.com/";

export interface SigninRejection {
  /** The page to open in the default browser if the user asks. Always plain https. */
  continueUrl: string;
  /**
   * For "Sign in with Google" on another website (an OAuth request): that website's host. The handoff then opens the
   * website itself, because Google's own continue address is tied to SIDB's session and the site's sign-in state lives
   * in SIDB's cookies, so neither would work in another browser. Null for a plain Google Account sign-in.
   */
  site: string | null;
}

/** Recognises Google's "This browser or app may not be secure" page (current and older paths). */
export function googleSigninRejection(url: string): SigninRejection | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "accounts.google.com") return null;
  if (!/^\/(?:v\d+\/)?signin\/(?:v\d+\/)?rejected(?:\/|$)/.test(u.pathname)) return null;
  const redirect = u.searchParams.get("client_id") ? safeHttps(u.searchParams.get("redirect_uri")) : null;
  if (redirect) {
    const r = new URL(redirect);
    return { continueUrl: `${r.origin}/`, site: r.hostname };
  }
  return { continueUrl: safeHttps(u.searchParams.get("continue")) ?? GOOGLE_SIGNIN_URL, site: null };
}

/** Only plain https addresses are ever handed to the operating system; anything else falls back to Google's sign-in page. */
function safeHttps(raw: string | null): string | null {
  if (!raw || raw.length > 4096) return null;
  try {
    const c = new URL(raw);
    if (c.protocol !== "https:" || c.username || c.password) return null;
    return c.href;
  } catch {
    return null;
  }
}

/**
 * The user agent Chromium itself would send: Electron's default without the "Electron/x" and app-name tokens, with the
 * version reduced to "major.0.0.0" as every current Chromium browser does (User-Agent reduction).
 * Client hint brands stay Chromium's own; SIDB never claims to be Google Chrome or any other browser.
 */
export function chromiumUserAgent(electronDefault: string): string {
  return electronDefault.replace(/\s(Electron|sidb)\/[\d.]+/gi, "").replace(/Chrome\/(\d+)(\.\d+){3}/, "Chrome/$1.0.0.0");
}
