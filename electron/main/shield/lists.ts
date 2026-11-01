export interface ListDef {
  id: string;
  title: string;
  description: string;
  url: string;
  defaultEnabled: boolean;
  /** Text that must appear in the first lines of a genuine download (guards against HTML error pages). */
  expectTitle: string;
}

/**
 * Filter lists are downloaded at runtime from their publishers' own HTTPS URLs and are never bundled with SIDB.
 * Licences: EasyList/EasyPrivacy/IndianList are GPLv3+ / CC BY-SA, uBlock filters are GPLv3. Review before redistributing.
 */
export const FILTER_LISTS: ListDef[] = [
  { id: "easylist", title: "EasyList", description: "General ad blocking", url: "https://easylist.to/easylist/easylist.txt", defaultEnabled: true, expectTitle: "EasyList" },
  { id: "easyprivacy", title: "EasyPrivacy", description: "Tracker and analytics blocking", url: "https://easylist.to/easylist/easyprivacy.txt", defaultEnabled: true, expectTitle: "EasyPrivacy" },
  { id: "ublock-filters", title: "uBlock filters", description: "Ads, trackers and YouTube rules maintained for uBlock Origin", url: "https://ublockorigin.github.io/uAssets/filters/filters.txt", defaultEnabled: true, expectTitle: "uBlock filters" },
  { id: "ublock-quick-fixes", title: "uBlock quick fixes", description: "Fast-moving fixes, including YouTube changes", url: "https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt", defaultEnabled: true, expectTitle: "Quick fixes" },
  { id: "ublock-unbreak", title: "uBlock unbreak", description: "Exceptions that keep sites working", url: "https://ublockorigin.github.io/uAssets/filters/unbreak.txt", defaultEnabled: true, expectTitle: "Unbreak" },
  { id: "ublock-privacy", title: "uBlock privacy", description: "Extra tracker rules", url: "https://ublockorigin.github.io/uAssets/filters/privacy.txt", defaultEnabled: true, expectTitle: "Privacy" },
  { id: "ublock-badware", title: "uBlock badware risks", description: "Known malicious and abusive sites", url: "https://ublockorigin.github.io/uAssets/filters/badware.txt", defaultEnabled: true, expectTitle: "Badware" },
  { id: "indianlist", title: "IndianList", description: "Regional ads on Indian-language sites", url: "https://easylist-downloads.adblockplus.org/indianlist.txt", defaultEnabled: true, expectTitle: "IndianList" },
];

/** Scriptlet and redirect resources used by uBlock-style rules (needed for YouTube protection). */
export const RESOURCES_URL = "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json";

export const MAX_LIST_BYTES = 25 * 1024 * 1024;
