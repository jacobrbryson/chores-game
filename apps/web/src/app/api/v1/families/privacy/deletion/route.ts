import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Schedules a family data deletion. Deletion is never immediate — the upstream
// route schedules it 30 days out and writes the privacy audit entry.
export async function POST(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/family/privacy/deletion", { method: "POST" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to request deletion",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}

// Cancels a previously scheduled deletion during the grace period.
export async function DELETE(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/family/privacy/deletion", { method: "DELETE" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to cancel deletion",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
