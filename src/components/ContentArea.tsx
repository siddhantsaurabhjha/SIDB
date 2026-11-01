import { useEffect, useRef } from "react";
import { internalPageOf } from "../../shared/url";
import { selectActiveTab, useTabs } from "../store/tabs";
import { AiPage } from "../pages/AiPage";
import { ErrorPage } from "../pages/ErrorPage";
import { NewTabPage } from "../pages/NewTabPage";
import { BookmarksPage } from "../pages/BookmarksPage";
import { DownloadsPage } from "../pages/DownloadsPage";
import { HistoryPage } from "../pages/HistoryPage";
import { SettingsPage } from "../pages/SettingsPage";
import { ShieldPage } from "../pages/ShieldPage";
import { WarningPage } from "../pages/WarningPage";
import { PrivateNewTabPage } from "../pages/PrivateNewTabPage";
import { useDialogs } from "../store/dialogs";

/**
 * The rectangle where the active web view is placed. Its bounds are reported to the main process;
 * for internal sidb:// tabs and failed loads the renderer draws the page here instead.
 */
export function ContentArea() {
  const ref = useRef<HTMLDivElement>(null);
  const tab = useTabs(selectActiveTab);
  const isPrivate = useTabs((s) => s.isPrivate);
  const snapshot = useDialogs((s) => s.snapshot);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const report = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        window.sidb.layout.setContentBounds({ x: r.x, y: r.y, width: r.width, height: r.height });
      });
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener("resize", report);
    report();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", report);
    };
  }, []);

  const page = tab?.internal ? internalPageOf(tab.url) : null;

  return (
    <div ref={ref} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      {snapshot && <img src={snapshot} alt="" aria-hidden draggable={false} className="absolute inset-0 h-full w-full object-cover object-top opacity-60" />}
      {tab?.warning ? <WarningPage tab={tab} /> : tab?.error ? <ErrorPage tab={tab} /> : null}
      {page === "newtab" && (isPrivate ? <PrivateNewTabPage /> : <NewTabPage />)}
      {page === "ai" && <AiPage />}
      {page === "bookmarks" && <BookmarksPage />}
      {page === "history" && <HistoryPage />}
      {page === "downloads" && <DownloadsPage />}
      {page === "settings" && <SettingsPage />}
      {page === "shield" && <ShieldPage />}
    </div>
  );
}
