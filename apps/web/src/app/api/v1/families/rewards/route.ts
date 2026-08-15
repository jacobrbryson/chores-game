import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Family Awards management for mobile. Distinct from /api/v1/rewards, which is
// the read-only store projection kids redeem from — this is the parent-side CRUD
// backing the mobile Manage Family awards tab.
export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, `/api/family/rewards${request.nextUrl.search}`);
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to list family awards",
      upstream.status,
      upstream.json,
    );
  }
  return ok({
    items: upstream.json?.rewards ?? [],
    viewerRole: upstream.json?.viewerRole ?? "player",
  });
}

export async function POST(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/family/rewards", { method: "POST" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to create family award",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json, 201);
}
