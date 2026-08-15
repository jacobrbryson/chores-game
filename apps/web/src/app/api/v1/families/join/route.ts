import { NextRequest } from "next/server";
import { fail, ok, proxyJsonWithCookies } from "@/app/api/v1/_lib/response";

/**
 * Mobile parity for invite-code redemption.
 *
 * Uses the cookie-forwarding proxy because redemption reissues `session_user`
 * with the caller's new role and member id — dropping that cookie would leave
 * the app signed in as a family-less user right after joining.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const upstream = await proxyJsonWithCookies(request, "/api/family/invitations/redeem", {
    method: "POST",
    body,
  });

  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to join family",
      upstream.status,
      upstream.json,
    );
  }

  const response = ok({
    familyId: upstream.json.familyId ?? "",
    familyName: upstream.json.familyName ?? "",
    role: upstream.json.role ?? "player",
    alreadyMember: Boolean(upstream.json.alreadyMember),
  });
  for (const cookie of upstream.setCookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}
