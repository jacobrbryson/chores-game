import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  // Forward paging/filter params (page, limit, unseen, q, sortBy, sortDir).
  const upstream = await proxyJson(request, `/api/notifications${request.nextUrl.search}`);
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to list notifications", upstream.status, upstream.json);
  }
  return ok({
    items: upstream.json.notifications ?? [],
    unseenCount: upstream.json.unseenCount ?? 0,
    pagination: upstream.json.pagination ?? { page: 1, pageSize: 50, total: 0, totalPages: 1 },
  });
}

// Mark notifications as seen from the mobile Notifications screen.
export async function PATCH(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/notifications", { method: "PATCH" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to update notifications",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
