import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Thin mobile proxy over GET /api/discovery/summary. Forwards an optional
// `sections` filter so native clients can request a subset.
export async function GET(request: NextRequest) {
  const sections = request.nextUrl.searchParams.get("sections");
  const query = sections ? `?sections=${encodeURIComponent(sections)}` : "";
  const upstream = await proxyJson(request, `/api/discovery/summary${query}`);
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to load discovery summary",
      upstream.status,
      upstream.json,
    );
  }
  return ok({
    sections: upstream.json.sections ?? {},
    totalCount: upstream.json.totalCount ?? 0,
  });
}
