import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import {
  addGhostSuggestion,
  resolveGhostViewerContext,
} from "@/lib/ghost-chores-service";

export const runtime = "nodejs";

type AddBody = {
  assigneeId?: unknown;
  assigneeName?: unknown;
};

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

  let body: AddBody = {};
  try {
    body = (await request.json()) as AddBody;
  } catch {
    body = {};
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

    const result = await addGhostSuggestion({
      context,
      suggestionId,
      actorUid: session.uid,
      actorName: session.name || session.email,
      actorEmail: session.email,
      assigneeId: typeof body.assigneeId === "string" ? body.assigneeId : undefined,
      assigneeName: typeof body.assigneeName === "string" ? body.assigneeName : undefined,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({ success: true, choreId: result.choreId }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[GHOST_SUGGESTION_ADD_ERROR]", reason);
    return NextResponse.json({ error: "ghost_add_failed" }, { status: 500 });
  }
}
