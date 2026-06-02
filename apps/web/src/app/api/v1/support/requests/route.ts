import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function POST(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/support/requests");
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to create support request",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json, upstream.status);
}
