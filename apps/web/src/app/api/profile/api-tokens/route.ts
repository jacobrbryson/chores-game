import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import {
  createApiToken,
  getClientIp,
  listApiAuditForUser,
  listApiTokensForUser,
  normalizeScopes,
  resolveUserFamilyForApiToken,
  serializeApiToken,
} from "@/lib/public-api/tokens";

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return unauthorized();
  }
  const [tokens, auditEvents] = await Promise.all([
    listApiTokensForUser(session.uid),
    listApiAuditForUser(session.uid, 25),
  ]);
  return NextResponse.json({
    scopes: ["read:profile", "read:players", "read:coins", "read:chores", "read:achievements"],
    tokens: tokens.map(serializeApiToken),
    auditEvents,
  });
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return unauthorized();
  }

  let body: { name?: unknown; scopes?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; scopes?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const scopes = normalizeScopes(body.scopes);
  if (!name) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (scopes.length === 0) {
    return NextResponse.json({ error: "scope_required" }, { status: 400 });
  }

  const context = await resolveUserFamilyForApiToken({
    uid: session.uid,
    email: session.email || "",
  });
  if (!context.familyId) {
    return NextResponse.json({ error: "family_not_found" }, { status: 404 });
  }

  const result = await createApiToken({
    userId: session.uid,
    familyId: context.familyId,
    name,
    scopes,
    ipAddress: getClientIp(request),
    userAgent: request.headers.get("user-agent") || "",
  });

  return NextResponse.json(
    {
      token: serializeApiToken(result.token),
      rawToken: result.rawToken,
      warning: "Copy this token now. It will not be shown again.",
    },
    { status: 201 },
  );
}
