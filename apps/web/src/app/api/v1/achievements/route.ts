import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/achievements");
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to list achievements", upstream.status, upstream.json);
  }
  const achievements = upstream.json.achievements ?? [];
  return ok({
    ...upstream.json,
    items: achievements,
    pagination: {
      page: 1,
      pageSize: achievements.length,
      total: achievements.length,
      totalPages: 1,
    },
  });
}
