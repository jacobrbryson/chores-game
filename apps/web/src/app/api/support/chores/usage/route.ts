import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { adminListAllDocuments, adminRunQueryAllInCollectionGroup } from "@/lib/firestore/admin";
import { documentIdFromName, readBoolean, readString } from "@/lib/firestore/rest";
import { parseRoutineStepsJson } from "@/lib/responsibility/routines";
import {
  aggregateChoreUsage,
  buildRoutineCountByKey,
  type ChoreUsageInput,
  type RoutineStepsInput,
} from "@/lib/support/chore-usage";

export const runtime = "nodejs";

// Cap the number of usage rows returned to the client. The aggregate totals
// (totalChores, uniqueChores, ...) always reflect the full scan.
const USAGE_TOP_N = 200;

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  try {
    const [{ documents, truncated }, familyDocs, { documents: routineDocs }] = await Promise.all([
      adminRunQueryAllInCollectionGroup("chores"),
      adminListAllDocuments("families"),
      adminRunQueryAllInCollectionGroup("routines"),
    ]);

    // Deleting a family only removes the family document — its `chores`
    // subcollection is orphaned, not purged — so the collection-group scan still
    // sees those chores. Cross-reference against live family docs to drop them.
    const liveFamilyIds = new Set(familyDocs.map((doc) => documentIdFromName(doc.name)));

    // Routine templates live at families/{id}/routines/{routineId}. Each holds an
    // ordered list of step titles (stepsJson) that map to chores by title. Count,
    // per normalized chore title, how many live routines reference it. Skip
    // deactivated routines and those under deleted families.
    const routines: RoutineStepsInput[] = routineDocs
      .filter((doc) => {
        const familyId = doc.name.match(/\/families\/([^/]+)/)?.[1] ?? "";
        if (!familyId || !liveFamilyIds.has(familyId)) return false;
        // `active` defaults to true when the field is absent.
        return !doc.fields || !("active" in doc.fields) || readBoolean(doc.fields, "active");
      })
      .map((doc) => ({
        routineId: doc.name,
        stepTitles: parseRoutineStepsJson(readString(doc.fields, "stepsJson")).map(
          (step) => step.title,
        ),
      }));
    const routineCountByKey = buildRoutineCountByKey(routines);

    const inputs: ChoreUsageInput[] = [];
    const excluded = { orphaned: 0, deleted: 0, starter: 0 };

    for (const doc of documents) {
      const familyId = doc.name.match(/\/families\/([^/]+)/)?.[1] ?? "";

      // Orphaned chore under a deleted family.
      if (!familyId || !liveFamilyIds.has(familyId)) {
        excluded.orphaned += 1;
        continue;
      }
      // Soft-deleted chore.
      if (readBoolean(doc.fields, "deleted")) {
        excluded.deleted += 1;
        continue;
      }
      // Onboarding "starter" chores are seeded into every new family and carry an
      // actionHref/actionLabel that organic chores never have. They're scaffolding,
      // not real usage.
      if (readString(doc.fields, "actionHref") || readString(doc.fields, "actionLabel")) {
        excluded.starter += 1;
        continue;
      }

      inputs.push({
        title: readString(doc.fields, "title") || "Untitled chore",
        familyId,
        recurrenceType: readString(doc.fields, "recurrenceType") || "none",
      });
    }

    const summary = aggregateChoreUsage(inputs, { topN: USAGE_TOP_N, routineCountByKey });

    return NextResponse.json({
      ...summary,
      truncated,
      scannedChores: documents.length,
      excluded,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_CHORE_USAGE_ERROR]", reason.slice(0, 240));
    return NextResponse.json(
      {
        error: "support_chore_usage_unavailable",
        message:
          "Chore usage could not be aggregated. Check service account credentials and Firestore access.",
      },
      { status: 500 },
    );
  }
}
