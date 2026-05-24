import { NextRequest, NextResponse } from "next/server";
import { fail, ok } from "@/app/api/v1/_lib/response";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { getPublicApiMe } from "@/lib/public-api/data";
import { withPublicApi } from "@/lib/public-api/middleware";

export async function GET(request: NextRequest) {
  if (!request.headers.get("authorization")) {
    const session = getSessionFromRequest(request);
    if (!session?.uid) {
      return fail("unauthorized", "Sign in required", 401);
    }
    return ok({
      uid: session.uid,
      memberId: session.memberId,
      name: session.name,
      email: session.email,
      role: session.role,
    });
  }

  return withPublicApi(request, ["read:profile"], async ({ token }) => {
    return NextResponse.json(await getPublicApiMe(token));
  });
}
