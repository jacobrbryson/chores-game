import { after } from "next/server";

// Runs best-effort side-effect work *after* the HTTP response has been flushed.
//
// Why: mutation handlers (chore complete/approve/reject, etc.) were awaiting a
// long tail of work that never contributes to the response body — WS publishes,
// analytics writes, audit logs, achievement crediting, Google Tasks sync. Each
// one is a separate network round trip, and `publishFamilyActivity` in
// particular can block on a cold WS container. Awaiting them inline is what made
// "complete a chore" take seconds on mobile.
//
// `after()` throws when there is no request context — unit tests invoke route
// handlers directly, and some callers are cron/internal paths. In that case we
// fall back to running the work inline so behaviour (and existing test
// assertions) stay identical outside a real request.
//
// Note on Cloud Run: post-response work can be CPU-throttled unless the service
// runs with CPU always allocated. These callbacks are all best-effort and
// already swallow their own failures, so throttling delays them rather than
// breaking them.
export async function runAfterResponse(
  label: string,
  work: () => Promise<unknown>,
): Promise<void> {
  const guarded = async () => {
    try {
      await work();
    } catch (error) {
      console.warn(`after-response work failed: ${label}`, error);
    }
  };

  try {
    after(guarded);
  } catch {
    // No request scope available — run inline rather than dropping the work.
    await guarded();
  }
}
