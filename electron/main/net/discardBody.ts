/**
 * Cancels a response body that won't be read. Leaving one unread and paused made Node's built-in HTTP client hit an
 * internal assertion (`assert(!this.paused)`) when the server later closed the connection, seen on Windows.
 * Accepts test doubles without a body.
 */
export async function discardBody(res: unknown): Promise<void> {
  const body = (res as { body?: { locked?: boolean; cancel?: () => Promise<void> } | null } | null)?.body;
  if (!body || body.locked || typeof body.cancel !== "function") return;
  await body.cancel().catch(() => undefined);
}
