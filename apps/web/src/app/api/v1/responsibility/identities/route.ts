import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Mobile proxy for every family member's Responsibility Identity summary in one
// read. Powers the mobile identity chips on the switch-account and kiosk player
// selection tiles, the same surfaces /api/responsibility/identities powers on web.
export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/responsibility/identities");
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to load responsibility identities",
      upstream.status,
      upstream.json,
    );
  }
  return ok({ members: upstream.json?.members ?? [] });
}
