import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import {
  getClientIp,
  getTokenByIdForUser,
  regenerateApiToken,
  serializeApiToken,
  updateApiTokenStatus,
} from "@/lib/public-api/tokens";

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ tokenId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return unauthorized();
  }

  let body: { action?: unknown };
  try {
    body = (await request.json()) as { action?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { tokenId } = await context.params;
  const token = await getTokenByIdForUser(tokenId, session.uid);
  if (!token) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const common = {
    ipAddress: getClientIp(request),
    userAgent: request.headers.get("user-agent") || "",
  };

  if (action === "disable") {
    await updateApiTokenStatus({ token, action: "disable", ...common });
    return NextResponse.json({ success: true });
  }
  if (action === "delete") {
    await updateApiTokenStatus({ token, action: "delete", ...common });
    return NextResponse.json({ success: true });
  }
  if (action === "regenerate") {
    const rawToken = await regenerateApiToken({ token, ...common });
    const updatedToken = await getTokenByIdForUser(tokenId, session.uid);
    return NextResponse.json({
      token: updatedToken ? serializeApiToken(updatedToken) : serializeApiToken(token),
      rawToken,
      warning: "Copy this token now. It will not be shown again.",
    });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
