import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Mobile proxy for the routine progress dialog — read one routine assignment
// (steps + completion state). Mirrors the web /api/routines/assignments/[id]
// GET. Step mutations flow through the normal chore PATCH endpoint.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const { assignmentId } = await context.params;
  const upstream = await proxyJson(request, `/api/routines/assignments/${assignmentId}`);
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "assignment_unavailable"),
      "Failed to fetch routine",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
