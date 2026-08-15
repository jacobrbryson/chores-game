import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Records parental consent for the current terms/privacy versions from mobile.
export async function POST(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/family/privacy/consent", { method: "POST" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to record consent",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
