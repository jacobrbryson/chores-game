import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ routineId: string }> },
) {
  const { routineId } = await context.params;
  const upstream = await proxyJson(
    request,
    `/api/routines/${encodeURIComponent(routineId)}/assign`,
    { method: "POST" },
  );
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to assign routine",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json ?? {}, upstream.status);
}
