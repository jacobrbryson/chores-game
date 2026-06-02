import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.search ?? "";
  const upstream = await proxyJson(request, `/api/support/requests/my${search}`);
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to fetch support requests",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
