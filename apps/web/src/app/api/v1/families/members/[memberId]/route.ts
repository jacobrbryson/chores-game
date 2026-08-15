import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Edit (name, role, locale, colour) or remove a family member from mobile.
export async function PATCH(request: NextRequest, context: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await context.params;
  const upstream = await proxyJson(request, `/api/family/members/${memberId}`, { method: "PATCH" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to update family member",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await context.params;
  const upstream = await proxyJson(request, `/api/family/members/${memberId}`, { method: "DELETE" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to remove family member",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
