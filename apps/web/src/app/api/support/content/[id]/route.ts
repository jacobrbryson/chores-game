import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { getPublicContentRecord, getSeoIssues, updatePublicContent } from "@/lib/public-content/service";
import type { PublicContentInput } from "@/lib/public-content/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function requireSupport(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (!isSupportAdmin(session)) return { ok: false as const, response: NextResponse.json({ error: "support_admin_required" }, { status: 403 }) };
  return { ok: true as const, session };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const support = requireSupport(request);
  if (!support.ok) return support.response;
  const { id } = await context.params;
  try {
    const record = await getPublicContentRecord(id);
    return NextResponse.json({ content: { ...record, seoIssues: getSeoIssues(record) } });
  } catch {
    return NextResponse.json({ error: "content_not_found" }, { status: 404 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const support = requireSupport(request);
  if (!support.ok) return support.response;
  const { id } = await context.params;

  let body: PublicContentInput;
  try {
    body = (await request.json()) as PublicContentInput;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await updatePublicContent(id, body, support.session);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ content: result.record });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_ADMIN_HTTP_404")) {
      return NextResponse.json({ error: "content_not_found" }, { status: 404 });
    }
    console.error("[SUPPORT_CONTENT_UPDATE_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "support_content_update_failed" }, { status: 500 });
  }
}
