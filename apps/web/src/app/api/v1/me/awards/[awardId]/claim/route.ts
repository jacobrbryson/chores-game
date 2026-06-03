import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";
import { getSessionFromRequest } from "@/lib/auth/request-session";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ awardId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return fail("unauthorized", "Sign in required", 401);
  }

  const { awardId } = await context.params;
  if (!awardId) {
    return fail("award_id_required", "Award ID required", 400);
  }

  const memberId = session.memberId || session.uid;
  const proxied = await proxyJson(
    request,
    `/api/family/members/${encodeURIComponent(memberId)}/awards/${encodeURIComponent(awardId)}`,
    { method: "PATCH", body: "{}" },
  );
  if (proxied.status >= 400) {
    const error = String(proxied.json?.error ?? proxied.json?.error?.code ?? `HTTP_${proxied.status}`);
    return fail(error, error, proxied.status, proxied.json);
  }
  return ok(proxied.json);
}
