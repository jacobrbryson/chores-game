import { NextRequest } from "next/server";
import { parseSessionToken } from "@/lib/auth/session";

export function getSessionFromRequest(request: NextRequest) {
  return parseSessionToken(request.cookies.get("session_user")?.value);
}
