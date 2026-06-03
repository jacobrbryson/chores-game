import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { adminRunQuery } from "@/lib/firestore/admin";
import { parseGhostSuggestionRecord, summarizeGhostSuggestions } from "@/lib/ghost-chores";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  try {
    const docs = await adminRunQuery({
      from: [{ collectionId: "ghostChoreSuggestions", allDescendants: true }],
      limit: 2000,
    });
    const records = docs.map(parseGhostSuggestionRecord);
    const summary = summarizeGhostSuggestions(records);
    return NextResponse.json({ summary });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[GHOST_SUGGESTION_SUMMARY_ERROR]", reason);
    return NextResponse.json({ error: "ghost_summary_unavailable" }, { status: 500 });
  }
}
