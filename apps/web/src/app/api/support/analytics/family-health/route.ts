import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import {
  loadFamilyHealthDetail,
  loadFamilyHealthOverview,
} from "@/lib/analytics/family-health-query";
import { DEFAULT_FAMILY_HEALTH_THRESHOLDS } from "@/lib/analytics/family-health";

export const runtime = "nodejs";

// Support → Analytics → Family Health. Admin/support-operator only — this is
// internal operational analytics and must never be exposed to families (V1). The
// overview classifies every family Healthy / At Risk / Inactive from a bounded
// analytics-event scan; `?familyId=` returns the per-family drill-down. Thresholds
// can be overridden per-request (?healthyMin=&atRiskMin=) for tuning without a
// redeploy; otherwise the defaults apply.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const familyId = (url.searchParams.get("familyId") ?? "").trim();
  const thresholds = parseThresholds(url);

  try {
    if (familyId) {
      const detail = await loadFamilyHealthDetail(familyId, thresholds);
      return NextResponse.json({ detail });
    }
    const overview = await loadFamilyHealthOverview(thresholds);
    return NextResponse.json({ overview });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[SUPPORT_FAMILY_HEALTH_ERROR]", reason);
    return NextResponse.json({ error: "family_health_unavailable" }, { status: 500 });
  }
}

function parseThresholds(url: URL) {
  const healthyMin = Number(url.searchParams.get("healthyMin"));
  const atRiskMin = Number(url.searchParams.get("atRiskMin"));
  const thresholds = {
    healthyMin: Number.isFinite(healthyMin)
      ? Math.max(0, Math.min(100, healthyMin))
      : DEFAULT_FAMILY_HEALTH_THRESHOLDS.healthyMin,
    atRiskMin: Number.isFinite(atRiskMin)
      ? Math.max(0, Math.min(100, atRiskMin))
      : DEFAULT_FAMILY_HEALTH_THRESHOLDS.atRiskMin,
  };
  // Guard against an inverted range from a bad query.
  if (thresholds.atRiskMin >= thresholds.healthyMin) {
    return DEFAULT_FAMILY_HEALTH_THRESHOLDS;
  }
  return thresholds;
}
