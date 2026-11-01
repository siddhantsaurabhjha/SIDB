import { ExternalLink, Info, X } from "lucide-react";
import { GOOGLE_SIGNIN_HELP_URL } from "../../shared/compat";
import { selectActiveTab, useTabs } from "../store/tabs";

/**
 * Explains Google's "Couldn't sign you in" page. Google blocks Google Account sign-in in browsers built on embedded
 * frameworks (SIDB is built on Electron), whatever the browser does. SIDB does not work around that check; it offers to
 * continue the same sign-in in the system's default browser, only when the user presses the button.
 */
export function CompatBar() {
  const tab = useTabs(selectActiveTab);
  const isPrivate = useTabs((s) => s.isPrivate);
  const notice = tab?.notice;
  if (!tab || notice?.kind !== "google-signin-blocked") return null;
  const api = window.sidb.data.compat;
  const site = notice.site?.replace(/^www\./, "") ?? null;

  return (
    <div role="status" aria-label="Google sign-in is not available in SIDB" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-accent/40 bg-accent/15 px-4 py-2">
      <Info size={16} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-[13px]">
        Google does not allow signing in to a Google Account from browsers built on an embedded framework, and SIDB is one. This is Google's rule, not a problem with your account or connection.
        {site ? ` To use "Sign in with Google" on ${site}, open ${site} in your default browser and sign in there.` : " You can sign in to Google in your default browser instead."}
        {isPrivate && " That opens a normal (not private) window of your default browser."}
      </span>
      <button className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12px] font-semibold hover:brightness-110" onClick={() => void api.continueSigninExternally({ id: tab.id })}>
        <ExternalLink size={13} /> {site ? `Open ${site} in default browser` : "Continue in default browser"}
      </button>
      <button className="h-8 rounded-lg border border-line px-3 text-[12px] hover:bg-white/10" onClick={() => void window.sidb.tabs.create({ url: GOOGLE_SIGNIN_HELP_URL, activate: true })}>
        Learn more
      </button>
      <button aria-label="Dismiss" className="rounded p-1 hover:bg-white/10" onClick={() => void api.dismissNotice({ id: tab.id })}>
        <X size={14} />
      </button>
    </div>
  );
}
