/**
 * `template` opens a results page; `suggest` is the engine's public autocomplete endpoint (OpenSearch JSON).
 * Both are fixed here on purpose: the suggestion request must never go anywhere else.
 */
export const SEARCH_ENGINES = {
  google: { label: "Google", template: "https://www.google.com/search?q=%s", suggest: "https://suggestqueries.google.com/complete/search?client=firefox&q=%s" },
  duckduckgo: { label: "DuckDuckGo", template: "https://duckduckgo.com/?q=%s", suggest: "https://duckduckgo.com/ac/?type=list&q=%s" },
  bing: { label: "Bing", template: "https://www.bing.com/search?q=%s", suggest: "https://api.bing.com/osjson.aspx?query=%s" },
  brave: { label: "Brave Search", template: "https://search.brave.com/search?q=%s", suggest: "https://search.brave.com/api/suggest?q=%s" },
} as const;

export type SearchEngineId = keyof typeof SEARCH_ENGINES;
export const DEFAULT_SEARCH_ENGINE: SearchEngineId = "google";