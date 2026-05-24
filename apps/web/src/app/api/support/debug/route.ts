import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import {
  adminGetDocument,
  adminListDocuments,
  adminRunQuery,
} from "@/lib/firestore/admin";
import {
  documentIdFromName,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  type FirestoreDocument,
  type FirestoreValue,
} from "@/lib/firestore/rest";

export const runtime = "nodejs";
const MAX_SUPPORT_ROWS = 100;

type PlainValue = string | number | boolean | PlainValue[] | { [key: string]: PlainValue };

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonForbidden() {
  return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
}

function toPlainValue(value: FirestoreValue): PlainValue {
  if ("stringValue" in value) {
    return value.stringValue;
  }
  if ("integerValue" in value) {
    const parsed = Number(value.integerValue);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if ("timestampValue" in value) {
    return value.timestampValue;
  }
  if ("booleanValue" in value) {
    return value.booleanValue;
  }
  if ("arrayValue" in value) {
    return (value.arrayValue.values ?? []).map(toPlainValue);
  }
  return Object.fromEntries(
    Object.entries(value.mapValue.fields ?? {}).map(([key, entry]) => [key, toPlainValue(entry)]),
  );
}

function fieldsToPlain(fields: FirestoreDocument["fields"]) {
  return Object.fromEntries(
    Object.entries(fields ?? {}).map(([key, value]) => [key, toPlainValue(value)]),
  );
}

function familyIdFromDocumentName(name: string) {
  const match = name.match(/\/families\/([^/]+)/);
  return match?.[1] ?? "";
}

function userIdFromLedgerName(name: string) {
  const match = name.match(/\/users\/([^/]+)\/walletLedger\//);
  return match?.[1] ?? "";
}

function normalizeQuery(value: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function containsQuery(values: Array<string | undefined>, query: string) {
  if (!query) {
    return true;
  }
  return values.some((value) => (value ?? "").toLowerCase().includes(query));
}

function sortByUpdatedAtDesc<T extends { updatedAt?: string; createdAt?: string; submittedAt?: string }>(
  rows: T[],
) {
  return [...rows].sort((a, b) => {
    const aMillis = Date.parse(a.updatedAt || a.submittedAt || a.createdAt || "") || 0;
    const bMillis = Date.parse(b.updatedAt || b.submittedAt || b.createdAt || "") || 0;
    return bMillis - aMillis;
  });
}

function normalizeUser(doc: FirestoreDocument) {
  return {
    id: documentIdFromName(doc.name),
    uid: readString(doc.fields, "uid") || documentIdFromName(doc.name),
    email: readString(doc.fields, "email"),
    name: readString(doc.fields, "name") || readString(doc.fields, "displayName"),
    role: readString(doc.fields, "role") || "player",
    familyIds: readStringArray(doc.fields, "familyIds"),
    walletBalance: readInteger(doc.fields, "walletBalance"),
    googleTasksLinked: readBoolean(doc.fields, "googleTasksLinked"),
    googleTasksLastSyncStatus: readString(doc.fields, "googleTasksLastSyncStatus"),
    googleTasksLastSyncedAt: readTimestamp(doc.fields, "googleTasksLastSyncedAt"),
    lastSignInAt: readTimestamp(doc.fields, "lastSignInAt"),
    raw: fieldsToPlain(doc.fields),
  };
}

function normalizeFamily(doc: FirestoreDocument) {
  return {
    id: documentIdFromName(doc.name),
    name: readString(doc.fields, "name") || "Family",
    createdBy: readString(doc.fields, "createdBy"),
    createdAt: readTimestamp(doc.fields, "createdAt"),
    updatedAt: readTimestamp(doc.fields, "updatedAt"),
    raw: fieldsToPlain(doc.fields),
  };
}

function normalizeChore(doc: FirestoreDocument) {
  return {
    id: documentIdFromName(doc.name),
    familyId: familyIdFromDocumentName(doc.name),
    title: readString(doc.fields, "title") || "Untitled chore",
    status: readString(doc.fields, "status") || "Open",
    assigneeId: readString(doc.fields, "assigneeId"),
    assigneeIds: readStringArray(doc.fields, "assigneeIds"),
    assigneeName: readString(doc.fields, "assigneeName"),
    requireApproval: readBoolean(doc.fields, "requireApproval"),
    coinValue: readInteger(doc.fields, "coinValue"),
    source: readString(doc.fields, "source") || "manual",
    googleTaskOwnerUid: readString(doc.fields, "googleTaskOwnerUid"),
    googleTaskListId: readString(doc.fields, "googleTaskListId"),
    googleTaskId: readString(doc.fields, "googleTaskId"),
    deleted: readBoolean(doc.fields, "deleted"),
    submittedAt: readTimestamp(doc.fields, "submittedAt"),
    updatedAt: readTimestamp(doc.fields, "updatedAt"),
    createdAt: readTimestamp(doc.fields, "createdAt"),
    approvalPayoutsJson: readString(doc.fields, "approvalPayoutsJson"),
    raw: fieldsToPlain(doc.fields),
  };
}

function normalizeEvent(doc: FirestoreDocument, kind: "audit" | "notification") {
  return {
    id: documentIdFromName(doc.name),
    familyId: familyIdFromDocumentName(doc.name),
    kind,
    eventType: readString(doc.fields, "eventType") || readString(doc.fields, "kind"),
    title: readString(doc.fields, "title"),
    message: readString(doc.fields, "message"),
    actorUid: readString(doc.fields, "actorUid"),
    actorEmail: readString(doc.fields, "actorEmail"),
    actorName: readString(doc.fields, "actorName"),
    userId: readString(doc.fields, "userId"),
    choreId: readString(doc.fields, "choreId"),
    choreTitle: readString(doc.fields, "choreTitle"),
    source: readString(doc.fields, "source"),
    reason: readString(doc.fields, "reason"),
    createdAt: readTimestamp(doc.fields, "createdAt"),
    raw: fieldsToPlain(doc.fields),
  };
}

function normalizeLedger(doc: FirestoreDocument) {
  return {
    id: documentIdFromName(doc.name),
    uid: readString(doc.fields, "uid") || userIdFromLedgerName(doc.name),
    reason: readString(doc.fields, "reason"),
    delta: readInteger(doc.fields, "delta"),
    entryType: readString(doc.fields, "entryType"),
    creditAmount: readInteger(doc.fields, "creditAmount"),
    debitAmount: readInteger(doc.fields, "debitAmount"),
    balanceAfter: readInteger(doc.fields, "balanceAfter"),
    choreId: readString(doc.fields, "choreId"),
    itemId: readString(doc.fields, "itemId"),
    createdAt: readTimestamp(doc.fields, "createdAt"),
    raw: fieldsToPlain(doc.fields),
  };
}

async function listCollectionGroup(collectionId: string, limit: number) {
  return adminRunQuery({
    from: [{ collectionId, allDescendants: true }],
    limit,
  });
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!isSupportAdmin(session)) {
    return jsonForbidden();
  }

  const url = new URL(request.url);
  const query = normalizeQuery(url.searchParams.get("q"));
  const selectedFamilyId = (url.searchParams.get("familyId") ?? "").trim();
  const selectedUserId = (url.searchParams.get("userId") ?? "").trim();
  const selectedChoreId = (url.searchParams.get("choreId") ?? "").trim();

  try {
    const [userDocs, familyDocs, choreDocs, auditDocs, notificationDocs] = await Promise.all([
      adminListDocuments("users", MAX_SUPPORT_ROWS),
      adminListDocuments("families", MAX_SUPPORT_ROWS),
      listCollectionGroup("chores", MAX_SUPPORT_ROWS),
      listCollectionGroup("auditLogs", 300),
      listCollectionGroup("notifications", 300),
    ]);

    const users = userDocs
      .map(normalizeUser)
      .filter((user) =>
        containsQuery([user.uid, user.email, user.name, user.role, user.familyIds.join(" ")], query),
      );
    const families = familyDocs
      .map(normalizeFamily)
      .filter((family) => containsQuery([family.id, family.name, family.createdBy], query));
    const chores = sortByUpdatedAtDesc(choreDocs.map(normalizeChore))
      .filter((chore) => !selectedFamilyId || chore.familyId === selectedFamilyId)
      .filter((chore) => !selectedUserId || chore.assigneeId === selectedUserId || chore.assigneeIds.includes(selectedUserId) || chore.googleTaskOwnerUid === selectedUserId)
      .filter((chore) => !selectedChoreId || chore.id === selectedChoreId)
      .filter((chore) =>
        containsQuery(
          [
            chore.id,
            chore.familyId,
            chore.title,
            chore.status,
            chore.assigneeId,
            chore.assigneeName,
            chore.source,
            chore.googleTaskOwnerUid,
          ],
          query,
        ),
      )
      .slice(0, MAX_SUPPORT_ROWS);

    const selectedUser =
      selectedUserId && users.every((user) => user.uid !== selectedUserId)
        ? normalizeUser(await adminGetDocument(`users/${selectedUserId}`))
        : null;
    const ledgerDocs =
      selectedUserId || selectedChoreId
        ? await listCollectionGroup("walletLedger", 1000)
        : [];
    const ledgers = sortByUpdatedAtDesc(ledgerDocs.map(normalizeLedger))
      .filter((entry) => !selectedUserId || entry.uid === selectedUserId)
      .filter((entry) => !selectedChoreId || entry.choreId === selectedChoreId)
      .slice(0, 250);

    const events = sortByUpdatedAtDesc([
      ...auditDocs.map((doc) => normalizeEvent(doc, "audit")),
      ...notificationDocs.map((doc) => normalizeEvent(doc, "notification")),
    ])
      .filter((event) => !selectedFamilyId || event.familyId === selectedFamilyId)
      .filter((event) => !selectedUserId || event.actorUid === selectedUserId || event.userId === selectedUserId)
      .filter((event) => !selectedChoreId || event.choreId === selectedChoreId)
      .filter((event) =>
        containsQuery(
          [
            event.eventType,
            event.title,
            event.message,
            event.actorUid,
            event.actorEmail,
            event.actorName,
            event.choreId,
            event.choreTitle,
            event.reason,
          ],
          query,
        ),
      )
      .slice(0, 300);

    const ledgerByChoreId = new Map<string, ReturnType<typeof normalizeLedger>[]>();
    for (const ledger of ledgers) {
      if (!ledger.choreId) {
        continue;
      }
      ledgerByChoreId.set(ledger.choreId, [...(ledgerByChoreId.get(ledger.choreId) ?? []), ledger]);
    }
    const approvedNotificationChoreIds = new Set(
      events
        .filter((event) => event.eventType === "chore_approved" || event.title === "Chore approved")
        .map((event) => event.choreId)
        .filter(Boolean),
    );
    const suspicious = chores
      .filter((chore) => chore.status === "Submitted")
      .filter((chore) => {
        const hasPayoutLedger = (ledgerByChoreId.get(chore.id) ?? []).some(
          (entry) => entry.reason === "chore_complete" && entry.delta > 0,
        );
        return hasPayoutLedger || approvedNotificationChoreIds.has(chore.id);
      })
      .map((chore) => ({
        choreId: chore.id,
        familyId: chore.familyId,
        title: chore.title,
        assigneeId: chore.assigneeId,
        submittedAt: chore.submittedAt,
        updatedAt: chore.updatedAt,
        reason: "Submitted chore has approval or payout evidence.",
      }));

    return NextResponse.json({
      viewer: { uid: session.uid, email: session.email, name: session.name },
      filters: { query, selectedFamilyId, selectedUserId, selectedChoreId },
      users: (selectedUser ? [selectedUser, ...users] : users).slice(0, MAX_SUPPORT_ROWS),
      families: families.slice(0, MAX_SUPPORT_ROWS),
      chores,
      ledgers,
      events,
      suspicious,
      counts: {
        users: userDocs.length,
        families: familyDocs.length,
        chores: choreDocs.length,
        auditEvents: auditDocs.length,
        notifications: notificationDocs.length,
        maxResultRows: MAX_SUPPORT_ROWS,
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_DEBUG_ERROR]", reason.slice(0, 240));
    return NextResponse.json(
      {
        error: "support_debug_unavailable",
        message:
          "Support data could not be loaded. Check service account credentials and Firestore access.",
      },
      { status: 500 },
    );
  }
}
