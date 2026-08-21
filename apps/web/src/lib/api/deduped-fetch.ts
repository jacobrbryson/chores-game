// Collapses concurrent identical GET requests into a single network round trip.
//
// Why: independent components mount together on a page load and each fetch what
// they need, with no knowledge of one another. Measured on a single /family
// load, three URLs were each requested twice at the same moment —
// /api/store?brief=1 and two /api/discovery/summary variants — six requests
// where three would do. Duplicates are not merely wasted bandwidth: the server
// does the full (expensive) work for each copy, and on a single-CPU container
// the redundant copies slow down the request the user is actually waiting on.
//
// Scope is deliberately narrow — *in-flight* only, with no completed-response
// cache. A caller that starts while an identical request is still open would
// have received that same response anyway, so sharing it introduces no staleness
// a plain fetch did not already have. Anything longer-lived would risk serving
// pre-mutation data after a write, which is what a real data cache (see
// lib/family/summary-cache.ts) is for.

// The shared value is a *snapshot* of the response, never the Response object.
//
// Handing each caller a `response.clone()` would tee the body stream, and a tee
// only drains as fast as its slowest branch: a caller that inspects
// `response.ok` and returns without reading the body (party-confetti-overlay
// does exactly that when its effect is cancelled) leaves one branch unread,
// buffering the whole payload and risking backpressure on the readers that do
// consume it. Buffering the body once and constructing an independent Response
// per caller sidesteps the tee entirely, and frees the connection sooner.
type ResponseSnapshot = {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
};

const inFlight = new Map<string, Promise<ResponseSnapshot>>();

// Statuses the Response constructor requires to have a null body.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function toResponse(snapshot: ResponseSnapshot): Response {
  return new Response(NULL_BODY_STATUSES.has(snapshot.status) ? null : snapshot.body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  });
}

function isDedupable(init?: RequestInit) {
  if (!init) {
    return true;
  }
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    return false;
  }
  // A shared request must not be abortable by one participant: whoever aborts
  // would cancel it for every other caller too.
  return !init.signal && !init.body;
}

export async function dedupedFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!isDedupable(init)) {
    return fetch(url, init);
  }

  let shared = inFlight.get(url);
  if (!shared) {
    shared = (async (): Promise<ResponseSnapshot> => {
      const response = await fetch(url, init);
      return {
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
        // Read once, here — every caller is served from this buffer.
        body: await response.text(),
      };
    })();
    inFlight.set(url, shared);

    const settle = () => {
      if (inFlight.get(url) === shared) {
        inFlight.delete(url);
      }
    };
    shared.then(settle, settle);
  }

  return toResponse(await shared);
}

// Test/debug aid: number of requests currently sharing the map.
export function inFlightRequestCount() {
  return inFlight.size;
}
