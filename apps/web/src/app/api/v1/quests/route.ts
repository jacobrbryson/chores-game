import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/quests");
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to list quests", upstream.status, upstream.json);
  }
  const items = upstream.json.quests ?? [];
  return ok({
    items,
    meta: upstream.json.meta ?? {},
    pagination: { page: 1, pageSize: items.length, total: items.length, totalPages: 1 },
  });
}
