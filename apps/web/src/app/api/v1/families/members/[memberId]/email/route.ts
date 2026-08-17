import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Change a player's email address from mobile. All authorization, validation,
// invite revocation, and audit logging live in the internal route; this is a
// pass-through so web and mobile cannot drift apart on the security rules.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ memberId: string }> },
) {
  const { memberId } = await context.params;
  const upstream = await proxyJson(request, `/api/family/members/${memberId}/email`, {
    method: "POST",
  });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to update member email address",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
