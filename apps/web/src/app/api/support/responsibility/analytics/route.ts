import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { adminListAllDocuments, adminRunQuery } from "@/lib/firestore/admin";
import { readBoolean, readInteger, readString, readTimestamp } from "@/lib/firestore/rest";
import {
  COMMUNITY_ROUTINES_COLLECTION,
  communityRoutineFromDoc,
} from "@/lib/responsibility/catalog";
import {
  RESPONSIBILITY_PILLARS,
  normalizeResponsibilityPillar,
} from "@/lib/responsibility/types";

export const runtime = "nodejs";

const MAX_EVENT_SCAN = 5000;

// Platform-level Responsibility analytics: XP and completion distribution by
// pillar and event type across all families (capped recent-event scan), plus
// community library composition. This is the foundation — per-age XP
// distribution lands once player birth-year data exists to join against.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  try {
    const [eventDocs, communityDocs, routineDocs, assignmentDocs] = await Promise.all([
      adminRunQuery({
        from: [{ collectionId: "responsibilityXpEvents", allDescendants: true }],
        limit: MAX_EVENT_SCAN,
      }),
      adminListAllDocuments(COMMUNITY_ROUTINES_COLLECTION, { cap: 500 }),
      adminRunQuery({
        from: [{ collectionId: "routines", allDescendants: true }],
        limit: MAX_EVENT_SCAN,
      }),
      adminRunQuery({
        from: [{ collectionId: "routineAssignments", allDescendants: true }],
        limit: MAX_EVENT_SCAN,
      }),
    ]);

    const xpByPillar: Record<string, number> = {};
    const eventsByType: Record<string, number> = {};
    const completionsByPillar: Record<string, number> = {};
    const routineCompletionsByRoutineId: Record<string, number> = {};
    for (const pillar of RESPONSIBILITY_PILLARS) {
      xpByPillar[pillar] = 0;
      completionsByPillar[pillar] = 0;
    }
    for (const doc of eventDocs) {
      const pillar = normalizeResponsibilityPillar(readString(doc.fields, "pillar"));
      const eventType = readString(doc.fields, "eventType") || "unknown";
      const xp = Math.max(0, readInteger(doc.fields, "xpAwarded"));
      eventsByType[eventType] = (eventsByType[eventType] ?? 0) + 1;
      if (pillar) {
        xpByPillar[pillar] += xp;
        if (eventType === "chore_completed") {
          completionsByPillar[pillar] += 1;
        }
      }
      if (eventType === "routine_completed") {
        const routineId = readString(doc.fields, "routineId");
        if (routineId) {
          routineCompletionsByRoutineId[routineId] =
            (routineCompletionsByRoutineId[routineId] ?? 0) + 1;
        }
      }
    }

    const mostCompletedRoutines = Object.entries(routineCompletionsByRoutineId)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([routineId, completions]) => ({ routineId, completions }));

    // Family routine templates across the platform: usage, completion, and
    // pillar distribution. "Abandoned" = assignments still active two weeks
    // after they were created.
    const familyRoutines = routineDocs
      .filter((doc) => !readBoolean(doc.fields, "deleted"))
      .map((doc) => ({
        name: readString(doc.fields, "name") || "Untitled routine",
        pillar: normalizeResponsibilityPillar(readString(doc.fields, "pillar")) || "unassigned",
        active: readBoolean(doc.fields, "active"),
        timesUsed: Math.max(0, readInteger(doc.fields, "timesUsed")),
        timesCompleted: Math.max(0, readInteger(doc.fields, "timesCompleted")),
      }));
    const familyRoutinesByPillar: Record<string, number> = {};
    for (const routine of familyRoutines) {
      familyRoutinesByPillar[routine.pillar] = (familyRoutinesByPillar[routine.pillar] ?? 0) + 1;
    }
    const mostUsedRoutines = [...familyRoutines]
      .filter((routine) => routine.timesUsed > 0)
      .sort((a, b) => b.timesUsed - a.timesUsed)
      .slice(0, 10)
      .map((routine) => ({
        name: routine.name,
        timesUsed: routine.timesUsed,
        timesCompleted: routine.timesCompleted,
        completionRate:
          routine.timesUsed > 0
            ? Math.round((routine.timesCompleted / routine.timesUsed) * 100) / 100
            : 0,
      }));

    const abandonedCutoffMillis = Date.now() - 14 * 24 * 60 * 60 * 1000;
    let assignmentsCompleted = 0;
    let assignmentsActive = 0;
    let assignmentsAbandoned = 0;
    for (const doc of assignmentDocs) {
      if (readString(doc.fields, "status") === "completed") {
        assignmentsCompleted += 1;
        continue;
      }
      assignmentsActive += 1;
      const createdAt = Date.parse(readTimestamp(doc.fields, "createdAt") || "");
      if (Number.isFinite(createdAt) && createdAt < abandonedCutoffMillis) {
        assignmentsAbandoned += 1;
      }
    }

    const communityRoutines = communityDocs.map((doc) => communityRoutineFromDoc(doc));
    const communityByStatus: Record<string, number> = {};
    const communityByPillar: Record<string, number> = {};
    for (const routine of communityRoutines) {
      communityByStatus[routine.status] = (communityByStatus[routine.status] ?? 0) + 1;
      const key = routine.pillar || "unassigned";
      communityByPillar[key] = (communityByPillar[key] ?? 0) + 1;
    }

    return NextResponse.json({
      analytics: {
        scannedEvents: eventDocs.length,
        scanCap: MAX_EVENT_SCAN,
        xpByPillar,
        eventsByType,
        choreCompletionsByPillar: completionsByPillar,
        mostCompletedRoutines,
        familyRoutines: {
          total: familyRoutines.length,
          active: familyRoutines.filter((routine) => routine.active).length,
          byPillar: familyRoutinesByPillar,
          mostUsed: mostUsedRoutines,
          assignments: {
            total: assignmentDocs.length,
            completed: assignmentsCompleted,
            active: assignmentsActive,
            abandoned: assignmentsAbandoned,
            completionRate:
              assignmentDocs.length > 0
                ? Math.round((assignmentsCompleted / assignmentDocs.length) * 100) / 100
                : 0,
          },
        },
        communityLibrary: {
          total: communityRoutines.length,
          byStatus: communityByStatus,
          byPillar: communityByPillar,
          featured: communityRoutines.filter((routine) => routine.featured).length,
        },
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[RESPONSIBILITY_ANALYTICS_ERROR]", reason);
    return NextResponse.json({ error: "analytics_unavailable" }, { status: 500 });
  }
}
