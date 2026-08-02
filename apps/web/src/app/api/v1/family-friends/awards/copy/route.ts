import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function POST(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/family-friends/awards/copy", { method: "POST" });
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to copy Family Friend award", upstream.status, upstream.json);
  }
  return ok(upstream.json ?? {}, upstream.status);
}
