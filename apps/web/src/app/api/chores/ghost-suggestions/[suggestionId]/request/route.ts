import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import {
  notifyGhostRequest,
  requestGhostSuggestion,
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

    const result = await requestGhostSuggestion({
      context,
      suggestionId,
      requestedByUid: session.uid,
    });
    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : result.error === "duplicate_request" ? 409 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    await notifyGhostRequest({
      familyId: context.familyId,
      requesterUid: session.uid,
      requesterName: session.name || session.email,
      requesterEmail: session.email,
      suggestionTitle: result.record.suggestedTitle,
    });

    return NextResponse.json({ success: true, status: result.record.status }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[GHOST_SUGGESTION_REQUEST_ERROR]", reason);
    return NextResponse.json({ error: "ghost_request_failed" }, { status: 500 });
  }
}
