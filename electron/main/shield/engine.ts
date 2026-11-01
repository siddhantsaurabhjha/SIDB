import { FiltersEngine, Request } from "@ghostery/adblocker";

export type Decision = { action: "allow" } | { action: "block" } | { action: "redirect"; url: string };

export interface RequestInfo {
  url: string;
  /** URL of the page that issued the request (top-level page). */
  pageUrl: string;
  /** Electron resource type, e.g. "script", "xhr", "image", "subFrame". */
  type: string;
  id: number;
  tabId: number;
}

const ENGINE_CONFIG = { loadCosmeticFilters: true, loadNetworkFilters: true, enableMutationObserver: true } as const;

export function parseEngine(text: string): FiltersEngine {
  return FiltersEngine.parse(text, { ...ENGINE_CONFIG });
}

/** Small engine for the user's own rules. Returns null when there are none. */
export function parseCustomRules(text: string): FiltersEngine | null {
  const trimmed = text.trim();
  return trimmed ? parseEngine(trimmed) : null;
}

export function makeRequest(info: RequestInfo): Request {
  return Request.fromRawDetails({
    requestId: String(info.id),
    tabId: info.tabId,
    url: info.url,
    sourceUrl: info.pageUrl,
    type: info.type as never,
  });
}

/**
 * Custom rules win over the shared lists: a custom exception (@@) allows a request the lists would block,
 * and a custom block rule blocks it.
 */
export function decide(main: FiltersEngine | null, custom: FiltersEngine | null, info: RequestInfo): Decision {
  const request = makeRequest(info);
  if (custom) {
    const c = custom.match(request);
    if (c.exception) return { action: "allow" };
    if (c.redirect) return { action: "redirect", url: c.redirect.dataUrl };
    if (c.match) return { action: "block" };
  }
  if (main) {
    const m = main.match(request);
    if (m.redirect) return { action: "redirect", url: m.redirect.dataUrl };
    if (m.match) return { action: "block" };
  }
  return { action: "allow" };
}

export interface CosmeticQuery {
  url: string;
  hostname: string;
  domain: string;
  classes?: string[];
  hrefs?: string[];
  ids?: string[];
  first: boolean;
  frameId: number;
  processId: number;
  lifecycle?: "start" | "dom-update";
}

/** Element-hiding CSS and scriptlets for a page, combined from the shared lists and the user's rules. */
export function cosmeticsFor(main: FiltersEngine | null, custom: FiltersEngine | null, q: CosmeticQuery): { styles: string; scripts: string[] } {
  let styles = "";
  const scripts: string[] = [];
  for (const engine of [main, custom]) {
    if (!engine) continue;
    const r = engine.getCosmeticsFilters({
      url: q.url,
      hostname: q.hostname,
      domain: q.domain,
      classes: q.classes,
      hrefs: q.hrefs,
      ids: q.ids,
      getBaseRules: q.first,
      getInjectionRules: q.first,
      getExtendedRules: false,
      getRulesFromHostname: q.first,
      getRulesFromDOM: !q.first,
      callerContext: { frameId: q.frameId, processId: q.processId, lifecycle: q.lifecycle },
    });
    if (r.active === false) continue;
    styles += r.styles;
    scripts.push(...r.scripts);
  }
  return { styles, scripts };
}

/** Hostname and registrable domain (public-suffix aware) of a URL. */
export function hostInfo(url: string): { hostname: string; domain: string } {
  const r = Request.fromRawDetails({ url });
  return { hostname: r.hostname, domain: r.domain };
}

export function engineStats(engine: FiltersEngine | null): { network: number; cosmetic: number } {
  if (!engine) return { network: 0, cosmetic: 0 };
  const { networkFilters, cosmeticFilters } = engine.getFilters();
  return { network: networkFilters.length, cosmetic: cosmeticFilters.length };
}

export function loadResources(engine: FiltersEngine, resourcesJson: string): void {
  engine.updateResources(resourcesJson, String(resourcesJson.length));
}

export { FiltersEngine };
