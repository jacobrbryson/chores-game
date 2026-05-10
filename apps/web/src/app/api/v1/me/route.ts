import { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { fail, ok } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
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
