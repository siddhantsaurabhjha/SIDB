import { app } from "electron";
import { chromiumUserAgent } from "../../../shared/compat";
import type { Settings } from "../../../shared/types/data";

const DOH_SERVERS: Record<Settings["secureDnsProvider"], string> = {
  cloudflare: "https://cloudflare-dns.com/dns-query",
  google: "https://dns.google/dns-query",
  quad9: "https://dns.quad9.net/dns-query",
};

/**
 * DNS over HTTPS. Off by default (system DNS). When on, "automatic" mode uses the chosen provider
 * and falls back to the system resolver if it can't be reached. This setting is app-wide, not per profile.
 */
export function applyDns(settings: Pick<Settings, "secureDns" | "secureDnsProvider">): void {
  app.configureHostResolver(
    settings.secureDns
      ? { secureDnsMode: "automatic", secureDnsServers: [DOH_SERVERS[settings.secureDnsProvider]] }
      : { secureDnsMode: "off", secureDnsServers: [] },
  );
}

/**
 * Sets the app-wide default user agent once, before any session exists. A default (rather than a per-session
 * override) applies to every session, including private ones, and keeps Chromium's own handling of it.
 * Note: Google blocks account sign-in in embedded frameworks such as Electron whatever the user agent says.
 */
export function applyUserAgent(): void {
  app.userAgentFallback = chromiumUserAgent(app.userAgentFallback);
}
