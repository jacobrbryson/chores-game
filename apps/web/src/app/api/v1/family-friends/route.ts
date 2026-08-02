import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/family-friends");
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to load Family Friends", upstream.status, upstream.json);
  }
  return ok(upstream.json ?? {});
}

export async function POST(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/family-friends", { method: "POST" });
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to invite Family Friends", upstream.status, upstream.json);
  }
  return ok(upstream.json ?? {}, upstream.status);
}
