import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dedupedFetch, inFlightRequestCount } from "./deduped-fetch";

function deferredResponse(body: unknown) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const respond = async () => {
    await gate;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { respond, release };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dedupedFetch", () => {
  it("collapses concurrent identical GETs into one network request", async () => {
    const { respond, release } = deferredResponse({ balance: 42 });
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(respond);

    const a = dedupedFetch("/api/store?brief=1", { cache: "no-store" });
    const b = dedupedFetch("/api/store?brief=1", { cache: "no-store" });
    expect(inFlightRequestCount()).toBe(1);
    release();

    const [ra, rb] = await Promise.all([a, b]);
    expect(fetch).toHaveBeenCalledTimes(1);
    // Each participant gets an independently readable body.
    await expect(ra.json()).resolves.toEqual({ balance: 42 });
    await expect(rb.json()).resolves.toEqual({ balance: 42 });
  });

  it("does not collapse different URLs", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response("{}", { status: 200 }),
    );

    await Promise.all([
      dedupedFetch("/api/discovery/summary?sections=feed"),
      dedupedFetch("/api/discovery/summary?sections=changelog"),
    ]);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("issues a fresh request once the previous one has settled", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response("{}", { status: 200 }),
    );

    await dedupedFetch("/api/store");
    expect(inFlightRequestCount()).toBe(0);
    await dedupedFetch("/api/store");

    // Sequential calls must NOT be served from a stale cache — this is
    // in-flight deduplication only.
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never shares non-GET requests", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response("{}", { status: 200 }),
    );

    await Promise.all([
      dedupedFetch("/api/store", { method: "POST", body: "{}" }),
      dedupedFetch("/api/store", { method: "POST", body: "{}" }),
    ]);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never shares a request that carries an abort signal", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response("{}", { status: 200 }),
    );

    // One caller aborting must not cancel another caller's request.
    await Promise.all([
      dedupedFetch("/api/store", { signal: new AbortController().signal }),
      dedupedFetch("/api/store", { signal: new AbortController().signal }),
    ]);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("serves a participant that never reads its body without affecting the others", async () => {
    // Regression guard: an earlier implementation handed out response.clone(),
    // which tees the body stream. A caller that checks `ok` and returns without
    // reading (party-confetti-overlay does this when cancelled) left one branch
    // unread and could apply backpressure to the readers that do consume it.
    const payload = { balance: 7, filler: "x".repeat(50_000) };
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response(JSON.stringify(payload), { status: 200 }),
    );

    const [ignored, consumed] = await Promise.all([
      dedupedFetch("/api/store?brief=1"),
      dedupedFetch("/api/store?brief=1"),
    ]);
    void ignored.ok; // deliberately never reads the body

    await expect(consumed.json()).resolves.toEqual(payload);
    expect(fetch).toHaveBeenCalledTimes(1);
    // The abandoned participant is still independently readable.
    await expect(ignored.json()).resolves.toEqual(payload);
  });

  it("preserves status and headers for every participant", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async () =>
        new Response("nope", {
          status: 403,
          statusText: "Forbidden",
          headers: { "content-type": "text/plain", "x-trace": "abc" },
        }),
    );

    const [a, b] = await Promise.all([dedupedFetch("/api/store"), dedupedFetch("/api/store")]);
    for (const r of [a, b]) {
      expect(r.status).toBe(403);
      expect(r.ok).toBe(false);
      expect(r.headers.get("x-trace")).toBe("abc");
    }
    await expect(a.text()).resolves.toBe("nope");
  });

  it("does not attach a body to null-body statuses", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response(null, { status: 304 }),
    );

    // The Response constructor throws if a 204/205/304 is given a body.
    const res = await dedupedFetch("/api/store");
    expect(res.status).toBe(304);
    expect(res.body).toBeNull();
  });

  it("clears the in-flight entry when the request rejects", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));

    await expect(dedupedFetch("/api/store")).rejects.toThrow("offline");
    expect(inFlightRequestCount()).toBe(0);
  });
});
