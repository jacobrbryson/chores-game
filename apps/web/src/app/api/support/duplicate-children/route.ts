import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import {
  adminGetDocument,
  adminListAllDocuments,
  adminListDocuments,
  adminPatchDocument,
  adminRunQuery,
} from "@/lib/firestore/admin";
import {
  boolField,
  documentIdFromName,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import {
  DEFAULT_COLOR_THEME_OPTION_ID,
  DEFAULT_CONFETTI_OPTION_ID,
} from "@/lib/store/catalog";
import {
  findDuplicateChildGroups,
  hasMeaningfulActivity,
  type ChildActivity,
  type ChildRecord,
} from "@/lib/support/duplicate-children";

export const runtime = "nodejs";

const DEFAULT_OWNED_ITEM_IDS = new Set([
  DEFAULT_COLOR_THEME_OPTION_ID,
  DEFAULT_CONFETTI_OPTION_ID,
]);

function familyIdFromMemberName(name: string) {
  const match = name.match(/\/families\/([^/]+)\/members\//);
  return match?.[1] ?? "";
}

function isCompletedChoreStatus(status: string) {
  return status === "Submitted" || status === "Approved";
}

// Compute the linked activity for one child. Used both by the report and by the
// soft-delete handler (which re-verifies before deleting). Cheap caches are
// passed in so we only fetch each family's chores once.
async function computeChildActivity(
  child: { familyId: string; memberId: string },
  familyChoresCache: Map<string, Awaited<ReturnType<typeof adminListDocuments>>>,
): Promise<ChildActivity> {
  let chores = familyChoresCache.get(child.familyId);
  if (!chores) {
    chores = await adminListAllDocuments(`families/${child.familyId}/chores`, { cap: 1000 }).catch(() => []);
    familyChoresCache.set(child.familyId, chores);
  }

  let choreCount = 0;
  let completedChoreCount = 0;
  for (const chore of chores) {
    const assigneeId = readString(chore.fields, "assigneeId");
    const assigneeIds = readStringArray(chore.fields, "assigneeIds");
    const assigned = assigneeId === child.memberId || assigneeIds.includes(child.memberId);
    if (!assigned) {
      continue;
    }
    choreCount += 1;
    if (isCompletedChoreStatus(readString(chore.fields, "status"))) {
      completedChoreCount += 1;
    }
  }

  // Managed local players use the member id as their user doc id.
  const userDoc = await adminGetDocument(`users/${child.memberId}`).catch(() => null);
  const coinBalance = userDoc ? readInteger(userDoc.fields, "walletBalance") : 0;
  const ownedItems = userDoc ? readStringArray(userDoc.fields, "ownedStoreOptionIds") : [];
  const inventoryCount = ownedItems.filter((id) => !DEFAULT_OWNED_ITEM_IDS.has(id)).length;

  const walletLedger = await adminListDocuments(
    `users/${child.memberId}/walletLedger`,
    50,
  ).catch(() => []);
  const achievements = await adminListDocuments(
    `users/${child.memberId}/achievements`,
    50,
  ).catch(() => []);

  return {
    choreCount,
    completedChoreCount,
    coinBalance: coinBalance > 0 ? coinBalance : 0,
    walletEntryCount: walletLedger.length,
    inventoryCount,
    achievementCount: achievements.length,
  };
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  try {
    const memberDocs = await adminRunQuery({
      from: [{ collectionId: "members", allDescendants: true }],
      limit: 4000,
    });

    // First pass: build records without activity to discover the duplicate groups.
    const baseRecords: ChildRecord[] = memberDocs.map((doc) => ({
      familyId: familyIdFromMemberName(doc.name),
      memberId: documentIdFromName(doc.name),
      name: readString(doc.fields, "name"),
      role: readString(doc.fields, "role"),
      deleted: readBoolean(doc.fields, "deleted"),
      createdAt: readTimestamp(doc.fields, "createdAt"),
    }));

    const candidateGroups = findDuplicateChildGroups(baseRecords);

    // Collect just the members inside duplicate groups so we only pay for activity
    // lookups where they matter.
    const candidateKeys = new Set<string>();
    for (const group of candidateGroups) {
      for (const candidate of group.candidates) {
        candidateKeys.add(`${candidate.familyId}::${candidate.memberId}`);
      }
    }

    const familyChoresCache = new Map<string, Awaited<ReturnType<typeof adminListDocuments>>>();
    const familyConsentCache = new Map<string, string | null>();

    async function getFamilyConsentAt(familyId: string): Promise<string | null> {
      if (familyConsentCache.has(familyId)) {
        return familyConsentCache.get(familyId) ?? null;
      }
      const familyDoc = await adminGetDocument(`families/${familyId}`).catch(() => null);
      const consentAt = familyDoc ? readTimestamp(familyDoc.fields, "parentalConsentAt") || null : null;
      familyConsentCache.set(familyId, consentAt);
      return consentAt;
    }

    // Second pass: enrich only the candidate records with activity + family consent.
    const enriched: ChildRecord[] = [];
    for (const record of baseRecords) {
      if (!candidateKeys.has(`${record.familyId}::${record.memberId}`)) {
        enriched.push(record);
        continue;
      }
      const [activity, familyConsentAt] = await Promise.all([
        computeChildActivity(record, familyChoresCache),
        getFamilyConsentAt(record.familyId),
      ]);
      enriched.push({ ...record, activity, familyConsentAt });
    }

    const groups = findDuplicateChildGroups(enriched);

    return NextResponse.json({
      groups,
      groupCount: groups.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_DUPLICATE_CHILDREN_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "duplicate_children_unavailable" }, { status: 500 });
  }
}

// Soft-delete a single duplicate child. Re-verifies on the server that the child
// has no meaningful linked activity, then sets deleted=true (never a hard delete).
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    familyId?: string;
    memberId?: string;
  };
  const familyId = (body.familyId ?? "").trim();
  const memberId = (body.memberId ?? "").trim();
  if (!familyId || !memberId) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  try {
    const memberDoc = await adminGetDocument(`families/${familyId}/members/${memberId}`).catch(
      () => null,
    );
    if (!memberDoc) {
      return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    }
    if (readString(memberDoc.fields, "role") !== "player") {
      return NextResponse.json({ error: "not_a_child" }, { status: 400 });
    }
    if (readBoolean(memberDoc.fields, "deleted")) {
      return NextResponse.json({ ok: true, alreadyDeleted: true });
    }

    // Re-verify activity server-side — never trust the client's "safe" flag.
    const activity = await computeChildActivity({ familyId, memberId }, new Map());
    if (hasMeaningfulActivity(activity)) {
      return NextResponse.json(
        { error: "child_has_activity", activity },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    await adminPatchDocument(
      `families/${familyId}/members/${memberId}`,
      {
        deleted: boolField(true),
        deletedAt: timestampField(now),
        deletedReason: stringField("support_duplicate_cleanup"),
      },
      ["deleted", "deletedAt", "deletedReason"],
    );

    console.info(
      "[SUPPORT_DUPLICATE_CHILD_SOFT_DELETED]",
      JSON.stringify({
        support_uid: session.uid,
        family_id: familyId,
        member_id: memberId,
        activity,
      }),
    );

    return NextResponse.json({ ok: true, softDeleted: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_DUPLICATE_CHILD_DELETE_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "soft_delete_failed", message: reason }, { status: 500 });
  }
}
