import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  const sourceUrl = new URL(request.url);
  const upstreamPath = `/api/community/awards${sourceUrl.search}`;
  const upstream = await proxyJson(request, upstreamPath);
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to list community awards",
      upstream.status,
      upstream.json,
    );
  }
  return ok({
    items: Array.isArray(upstream.json?.awards) ? upstream.json.awards : [],
    pagination: upstream.json?.pagination ?? { page: 1, limit: 12, total: 0, totalPages: 1 },
  });
}
