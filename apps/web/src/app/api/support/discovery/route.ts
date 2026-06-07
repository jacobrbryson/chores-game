import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { adminRunQuery } from "@/lib/firestore/admin";
import { documentIdFromName, readString, readTimestamp } from "@/lib/firestore/rest";
import { DISCOVERY_SECTIONS } from "@/lib/discovery/sections";

export const runtime = "nodejs";

// GET /api/support/discovery
// Lightweight operator diagnostics for the Discovery / What's New system. Uses
// server-side admin credentials and a collection-group query over the
// per-profile `discoveryState` subcollections. Reports system health only — no
// child-identifying detail beyond opaque profile uids needed for triage.
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
      from: [{ collectionId: "discoveryState", allDescendants: true }],
      limit: 1000,
    });

    const profiles = new Set<string>();
    const countsBySection: Record<string, number> = {};
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let recentUpdates = 0;
    const recent: Array<{ sectionKey: string; seenByUid: string; updatedAt: string }> = [];

    for (const doc of docs) {
      const sectionKey =
        readString(doc.fields, "sectionKey") || documentIdFromName(doc.name).replace(/__/g, ":");
      const seenByUid = readString(doc.fields, "seenByUid");
      const updatedAt = readTimestamp(doc.fields, "updatedAt");
      if (seenByUid) {
        profiles.add(seenByUid);
      }
      countsBySection[sectionKey] = (countsBySection[sectionKey] ?? 0) + 1;
      const updatedMs = Date.parse(updatedAt);
      if (Number.isFinite(updatedMs) && updatedMs >= sevenDaysAgo) {
        recentUpdates += 1;
      }
      recent.push({ sectionKey, seenByUid, updatedAt });
    }

    recent.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));

    return NextResponse.json({
      healthy: true,
      registeredSections: DISCOVERY_SECTIONS.map((section) => section.key),
      totalStateRecords: docs.length,
      profilesWithDiscoveryState: profiles.size,
      recentUpdatesLast7Days: recentUpdates,
      countsBySection,
      recentUpdatesPreview: recent.slice(0, 20),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_DISCOVERY_ERROR]", reason.slice(0, 180));
    return NextResponse.json({ healthy: false, unavailable: true, error: "discovery_diagnostics_unavailable" });
  }
}
