import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Chore categories for the mobile Manage Family screen. The chore editor reads
// categories off the family summary; this endpoint is for managing them.
export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/family/categories");
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to list categories",
      upstream.status,
      upstream.json,
    );
  }
  return ok({
    items: upstream.json.categories ?? [],
    viewerRole: upstream.json.viewerRole ?? "player",
  });
}

export async function POST(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/family/categories", { method: "POST" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to create category",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json, 201);
}
