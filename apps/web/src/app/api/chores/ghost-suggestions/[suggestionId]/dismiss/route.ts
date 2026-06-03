import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import {
  dismissGhostSuggestion,
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

    const result = await dismissGhostSuggestion({ context, suggestionId });
    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ success: true, status: result.record.status });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[GHOST_SUGGESTION_DISMISS_ERROR]", reason);
    return NextResponse.json({ error: "ghost_dismiss_failed" }, { status: 500 });
  }
}
