import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/store");
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to fetch store",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}

export async function POST(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/store");
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to update store",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
