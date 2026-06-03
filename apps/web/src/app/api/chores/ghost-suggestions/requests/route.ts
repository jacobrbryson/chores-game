import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import {
  listRequestedGhostSuggestions,
  resolveGhostViewerContext,
} from "@/lib/ghost-chores-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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

    const requests = await listRequestedGhostSuggestions(context.familyId);
    return NextResponse.json({
      requests: requests.map((record) => ({
        id: record.id,
        suggestedTitle: record.suggestedTitle,
        suggestedDescription: record.suggestedDescription,
        suggestedCoinValue: record.suggestedCoinValue,
        suggestedCategoryIds: record.suggestedCategoryIds,
        source: record.source,
        playerUid: record.playerUid,
        playerMemberId: record.playerMemberId,
        requestedAt: record.requestedAt,
      })),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[GHOST_SUGGESTION_REQUESTS_ERROR]", reason);
    return NextResponse.json({ error: "ghost_requests_unavailable" }, { status: 500 });
  }
}
