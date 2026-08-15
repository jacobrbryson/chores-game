import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Mobile proxy for the family privacy overview (consent versions, data summary,
// deletion state). Backs the mobile Manage Family privacy tab, the counterpart
// of web's FamilyPrivacyTab. The upstream route owns the admin-only check.
export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/family/privacy");
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to load family privacy",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
