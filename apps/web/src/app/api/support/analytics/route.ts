import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { loadAnalyticsSummary } from "@/lib/analytics/query";

export const runtime = "nodejs";

// Support → Analytics validation page data. Intentionally minimal in V1: total
// events, events today, top events, and recent events — enough to confirm the
// collection pipeline is reliable before any dashboards are built. Admin-gated;
// reads the top-level analyticsEvents collection via service-account credentials.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  try {
    const summary = await loadAnalyticsSummary();
    return NextResponse.json({ summary });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[SUPPORT_ANALYTICS_ERROR]", reason);
    return NextResponse.json({ error: "analytics_unavailable" }, { status: 500 });
  }
}
