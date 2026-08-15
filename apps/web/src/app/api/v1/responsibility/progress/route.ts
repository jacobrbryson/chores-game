import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Mobile proxy for a player's aggregated Responsibility Pillar progress. Powers
// the mobile identity surfaces (journey widget, earned-identity strips) the same
// way /api/responsibility/progress powers the web ones. `?memberId=` is
// forwarded so parents can read a child's progress; the upstream route owns the
// admin check.
export async function GET(request: NextRequest) {
  const upstream = await proxyJson(
    request,
    `/api/responsibility/progress${request.nextUrl.search}`,
  );
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to load responsibility progress",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
