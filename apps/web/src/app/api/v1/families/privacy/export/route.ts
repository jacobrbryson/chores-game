import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Family data export for mobile. The web route streams a downloadable
// attachment; mobile has no file system to save into, so this returns the same
// export payload as JSON for the client to hand to the OS share sheet. The
// upstream route still writes the privacy audit entry either way.
export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/family/privacy/export");
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to export family data",
      upstream.status,
      upstream.json,
    );
  }
  return ok({ export: upstream.json });
}
