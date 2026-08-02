import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function POST(request: NextRequest, context: { params: Promise<{ inviteId: string }> }) {
  const { inviteId } = await context.params;
  const upstream = await proxyJson(request, `/api/family-friends/invitations/${encodeURIComponent(inviteId)}`, { method: "POST" });
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to confirm Family Friends", upstream.status, upstream.json);
  }
  return ok(upstream.json ?? {});
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ inviteId: string }> }) {
  const { inviteId } = await context.params;
  const upstream = await proxyJson(request, `/api/family-friends/invitations/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to cancel Family Friends request", upstream.status, upstream.json);
  }
  return ok(upstream.json ?? {});
}
