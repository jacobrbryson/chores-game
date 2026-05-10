import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/achievements");
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to list achievements", upstream.status, upstream.json);
  }
  return ok({ items: upstream.json.achievements ?? [], pagination: { page: 1, pageSize: (upstream.json.achievements ?? []).length, total: (upstream.json.achievements ?? []).length, totalPages: 1 } });
}
