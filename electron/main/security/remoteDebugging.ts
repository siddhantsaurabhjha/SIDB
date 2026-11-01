/**
 * Whether remote debugging must be switched off for this run: an installed SIDB asked to open a debugging port or
 * pipe on its normal profile folder (what cookie-stealing malware does). Allowed with a separate --user-data-dir,
 * and always when running from source.
 */
export function refuseRemoteDebugging(isPackaged: boolean, hasSwitch: (name: string) => boolean): boolean {
  if (!isPackaged) return false;
  const wants = hasSwitch("remote-debugging-port") || hasSwitch("remote-debugging-pipe");
  return wants && !hasSwitch("user-data-dir");
}
