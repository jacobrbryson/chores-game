import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Mobile parity for the web Routines page: list the family's routine templates
// and create new ones. Admin-only enforcement lives upstream in /api/routines.
export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/routines");
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to list routines",
      upstream.status,
      upstream.json,
    );
  }
  return ok({
    items: upstream.json.routines ?? [],
    members: upstream.json.members ?? [],
    viewerRole: upstream.json.viewerRole ?? "player",
  });
}

export async function POST(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/routines", { method: "POST" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to create routine",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json, 201);
}
