import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Thin mobile proxy over POST /api/discovery/seen.
export async function POST(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/discovery/seen", {
    method: "POST",
  });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to mark discovery sections seen",
      upstream.status,
      upstream.json,
    );
  }
  return ok({ marked: upstream.json.marked ?? [] });
}
