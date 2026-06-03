import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import {
  rejectGhostSuggestion,
  resolveGhostViewerContext,
} from "@/lib/ghost-chores-service";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ suggestionId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { suggestionId } = await params;
  if (!suggestionId) {
    return NextResponse.json({ error: "suggestion_id_required" }, { status: 400 });
  }

  try {
    const context = await resolveGhostViewerContext({
      uid: session.uid,
      memberId: session.memberId,
      email: session.email,
    });
    if (!context) {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (context.role !== "admin") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }

    const result = await rejectGhostSuggestion({
      familyId: context.familyId,
      suggestionId,
      reviewerUid: session.uid,
    });
    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[GHOST_SUGGESTION_REJECT_ERROR]", reason);
    return NextResponse.json({ error: "ghost_reject_failed" }, { status: 500 });
  }
}
