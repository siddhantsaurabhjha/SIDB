import type { Session } from "electron";

/**
 * `fetch` for SIDB's own requests (filter lists, website icons, search suggestions, update check, Safe Browsing,
 * NVIDIA), on Chromium's network stack instead of Node's built-in client.
 *
 * Why: Node's client (undici) has an open bug (nodejs/undici#5360). If a body is read a little slower than it arrives
 * and the server then closes the connection, it throws an assertion no code can catch, which ended the main process
 * (seen on Windows). Chromium's stack also brings the system proxy, the OS certificate store and SIDB's secure-DNS
 * setting to these requests.
 *
 * Privacy: a dedicated in-memory session (nothing on disk, no HTTP cache) and no cookies are sent or kept.
 * Behaviour matches `fetch` where SIDB relies on it: `redirect: "manual"` returns the 3xx answer with its `location`,
 * `redirect: "error"` rejects, network failures reject with a TypeError, and an aborted signal rejects with its reason.
 */

let netSession: Session | null = null;

async function electron(): Promise<typeof import("electron")> {
  return import("electron");
}

async function appSession(): Promise<Session> {
  if (!netSession) {
    const { session } = await electron();
    netSession = session.fromPartition("sidb-app-network", { cache: false });
  }
  return netSession;
}

function toHeaders(raw: Record<string, string | string[]>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(raw)) for (const item of Array.isArray(v) ? v : [v]) h.append(k, item);
  return h;
}

export async function appFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const { net } = await electron();
  const ses = await appSession();
  const signal = init.signal ?? undefined;
  if (signal?.aborted) throw signal.reason;
  const mode = init.redirect ?? "follow";

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const request = net.request({
      url: String(input),
      method: init.method ?? "GET",
      session: ses,
      redirect: "manual", // every hop is decided below
      credentials: "omit",
      useSessionCookies: false,
      cache: "no-store",
    });
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      try {
        request.abort();
      } catch {
        /* already finished */
      }
      reject(e);
    };
    const onAbort = () => fail(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });

    new Headers(init.headers).forEach((value, key) => request.setHeader(key, value));

    request.on("redirect", (statusCode, _method, redirectUrl, responseHeaders) => {
      if (mode === "follow") return request.followRedirect();
      if (mode === "error") return fail(new TypeError("fetch failed: unexpected redirect"));
      // manual: hand the 3xx answer back, like fetch in Node does.
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      const headers = toHeaders(responseHeaders);
      headers.set("location", redirectUrl);
      request.abort();
      resolve(new Response(null, { status: statusCode, headers }));
    });

    request.on("response", (message) => {
      if (settled) return;
      settled = true;
      let closed = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          message.on("data", (chunk: Buffer) => {
            if (!closed) controller.enqueue(new Uint8Array(chunk));
          });
          message.on("end", () => {
            signal?.removeEventListener("abort", onAbort);
            if (!closed) {
              closed = true;
              controller.close();
            }
          });
          message.on("error", (e: Error) => {
            if (!closed) {
              closed = true;
              controller.error(e);
            }
          });
          signal?.addEventListener(
            "abort",
            () => {
              if (!closed) {
                closed = true;
                controller.error(signal.reason);
              }
            },
            { once: true },
          );
        },
        cancel() {
          closed = true;
          signal?.removeEventListener("abort", onAbort);
          try {
            request.abort();
          } catch {
            /* already finished */
          }
        },
      });
      const status = message.statusCode;
      const noBody = status === 204 || status === 205 || status === 304 || init.method === "HEAD";
      if (noBody) body.cancel().catch(() => undefined);
      resolve(new Response(noBody ? null : body, { status, statusText: message.statusMessage, headers: toHeaders(message.headers) }));
    });

    // Chromium reports network problems as "net::ERR_..." errors; fetch reports them as TypeError.
    request.on("error", (e: Error) => fail(new TypeError(`fetch failed: ${e.message}`, { cause: e })));

    if (init.body !== undefined && init.body !== null) request.write(typeof init.body === "string" ? init.body : Buffer.from(init.body as ArrayBuffer));
    request.end();
  });
}
