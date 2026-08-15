import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Edit / archive a routine template from mobile. Admin-only enforcement lives
// upstream in /api/routines/[routineId].
export async function PATCH(request: NextRequest, context: { params: Promise<{ routineId: string }> }) {
  const { routineId } = await context.params;
  const upstream = await proxyJson(request, `/api/routines/${routineId}`, { method: "PATCH" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to update routine",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ routineId: string }> }) {
  const { routineId } = await context.params;
  const upstream = await proxyJson(request, `/api/routines/${routineId}`, { method: "DELETE" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to delete routine",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
