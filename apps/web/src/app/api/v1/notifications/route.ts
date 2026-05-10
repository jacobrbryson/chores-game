import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/notifications");
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to list notifications", upstream.status, upstream.json);
  }
  return ok({ items: upstream.json.notifications ?? [], pagination: upstream.json.pagination ?? { page: 1, pageSize: 50, total: 0, totalPages: 1 } });
}
