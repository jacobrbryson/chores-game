import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/quests");
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to list quests", upstream.status, upstream.json);
  }
  return ok({ items: upstream.json.quests ?? [], pagination: { page: 1, pageSize: (upstream.json.quests ?? []).length, total: (upstream.json.quests ?? []).length, totalPages: 1 } });
}
