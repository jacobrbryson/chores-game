import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { loadAllSupportRequests, summarizeSupportRequests } from "@/lib/support/management";

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
    const requests = await loadAllSupportRequests();
    return NextResponse.json({ summary: summarizeSupportRequests(requests) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_REQUESTS_SUMMARY_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "support_requests_unavailable" }, { status: 500 });
  }
}
