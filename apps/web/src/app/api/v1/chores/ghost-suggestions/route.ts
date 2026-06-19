import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Mirror the web route: Athena AI generation can take ~10–30s on a cold call.
export const maxDuration = 35;

export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/chores/ghost-suggestions");
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to fetch ghost chore suggestions",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
