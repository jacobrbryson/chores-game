import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  const upstream = await proxyJson(
    request,
    `/api/family-friends/routines/copy${new URL(request.url).search}`,
    { method: "GET" },
  );
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to preview Family Friend routine",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json ?? {}, upstream.status);
}

export async function POST(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/family-friends/routines/copy", {
    method: "POST",
  });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to copy Family Friend routine",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json ?? {}, upstream.status);
}
