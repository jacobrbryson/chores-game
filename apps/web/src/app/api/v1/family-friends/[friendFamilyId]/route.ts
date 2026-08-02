import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function DELETE(request: NextRequest, context: { params: Promise<{ friendFamilyId: string }> }) {
  const { friendFamilyId } = await context.params;
  const upstream = await proxyJson(request, `/api/family-friends/${encodeURIComponent(friendFamilyId)}`, { method: "DELETE" });
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to remove Family Friend", upstream.status, upstream.json);
  }
  return ok(upstream.json ?? {});
}
