import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  // Forward pagination params so native clients can page the feed like the web client.
  const incoming = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams();
  const page = incoming.get("page");
  const limit = incoming.get("limit");
  const scope = incoming.get("scope");
  // Daily roll-ups are grouped by the viewer's calendar day, so the device's
  // timezone offset has to reach the feed route — without it mobile would group
  // by UTC and split a single evening across two days.
  const tzOffsetMinutes = incoming.get("tzOffsetMinutes");
  if (page) {
    forwarded.set("page", page);
  }
  if (limit) {
    forwarded.set("limit", limit);
  }
  if (scope === "friends") forwarded.set("scope", "friends");
  if (tzOffsetMinutes) {
    forwarded.set("tzOffsetMinutes", tzOffsetMinutes);
  }
  const query = forwarded.toString();
  const upstream = await proxyJson(request, `/api/feed${query ? `?${query}` : ""}`);
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to load family feed",
      upstream.status,
      upstream.json,
    );
  }
  return ok({
    items: upstream.json.items ?? [],
    pagination: upstream.json.pagination ?? {
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1,
      hasMore: false,
    },
  });
}
