import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import {
  getGhostSuggestionsForViewer,
  resolveGhostViewerContext,
} from "@/lib/ghost-chores-service";

export const runtime = "nodejs";
// Athena's AI generation can take ~10–30s on a cold call; allow the function to
// run long enough that the platform doesn't kill it before Athena responds.
export const maxDuration = 35;

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
      // No active family (includes support-only operators outside a family context).
      return NextResponse.json({ suggestions: [], hasOpenChores: false, viewerRole: "player", eligible: false, source: "local" });
    }

    // Return a larger pool than the dashboard shows (3) so dismissing/adding a
    // suggestion can be refilled client-side from the next available idea.
    const limitParam = Number(request.nextUrl.searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.trunc(limitParam), 20) : 9;
    // Admins can request suggestions for a selected member (the dashboard empty
    // state) via ?memberId=; players always get suggestions for themselves.
    const requestedSubject = request.nextUrl.searchParams.get("memberId")?.trim() || "";
    const subjectMemberId = context.role === "admin" && requestedSubject ? requestedSubject : undefined;
    const { suggestions, hasOpenChores, source } = await getGhostSuggestionsForViewer(context, limit, {
      subjectMemberId,
    });
    return NextResponse.json({
      suggestions,
      hasOpenChores,
      viewerRole: context.role,
      eligible: context.role === "admin" || !hasOpenChores,
      source,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[GHOST_SUGGESTIONS_LIST_ERROR]", reason);
    return NextResponse.json({ error: "ghost_suggestions_unavailable" }, { status: 500 });
  }
}
