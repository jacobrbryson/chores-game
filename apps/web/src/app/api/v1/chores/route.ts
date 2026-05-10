import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, `/api/chores${request.nextUrl.search}`);
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to list chores", upstream.status, upstream.json);
  }
  return ok({ items: upstream.json.chores ?? [], pagination: upstream.json.pagination ?? { page: 1, pageSize: 50, total: 0, totalPages: 1 } });
}

export async function POST(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/chores", { method: "POST" });
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to create chore", upstream.status, upstream.json);
  }
  return ok(upstream.json, 201);
}
