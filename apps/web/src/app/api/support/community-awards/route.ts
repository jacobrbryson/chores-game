import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { COMMUNITY_AWARD_STATUSES, listCommunityAwardRecords } from "@/lib/community-awards";

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
    const status = new URL(request.url).searchParams.get("status") ?? "";
    const allRecords = await listCommunityAwardRecords();
    const records = allRecords
      .filter((record) => !status || record.status === status)
      .sort((a, b) => (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0));
    const counts = Object.fromEntries(
      COMMUNITY_AWARD_STATUSES.map((entry) => [entry, allRecords.filter((record) => record.status === entry).length]),
    );
    return NextResponse.json({
      awards: records,
      counts,
      reports: {
        mostVoted: [...allRecords].sort((a, b) => b.voteCount - a.voteCount).slice(0, 5),
        mostCopied: [...allRecords].sort((a, b) => b.copyCount - a.copyCount).slice(0, 5),
        recentSubmissions: [...allRecords].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)).slice(0, 5),
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_COMMUNITY_AWARDS_GET_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "support_community_awards_unavailable" }, { status: 500 });
  }
}
