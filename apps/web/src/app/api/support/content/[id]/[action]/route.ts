import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { transitionPublicContent } from "@/lib/public-content/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; action: string }> };
const ACTIONS = ["submit-review", "approve", "publish", "archive", "unpublish"] as const;

export async function POST(request: NextRequest, context: RouteContext) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSupportAdmin(session)) return NextResponse.json({ error: "support_admin_required" }, { status: 403 });

  const { id, action } = await context.params;
  if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
    return NextResponse.json({ error: "unsupported_action" }, { status: 404 });
  }

  try {
    const result = await transitionPublicContent(id, action as (typeof ACTIONS)[number], session);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ content: result.record });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_ADMIN_HTTP_404")) {
      return NextResponse.json({ error: "content_not_found" }, { status: 404 });
    }
    console.error("[SUPPORT_CONTENT_TRANSITION_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "support_content_transition_failed" }, { status: 500 });
  }
}
