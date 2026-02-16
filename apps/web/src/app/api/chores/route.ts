import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  boolField,
  createOrReplaceDocument,
  documentIdFromName,
  type FirestoreValue,
  getDocument,
  integerField,
  listDocuments,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";

type CreateChoresBody = {
  description?: unknown;
  assigneeId?: unknown;
  details?: unknown;
  titles?: unknown;
  dueDate?: unknown;
};

type ChoreRow = {
  id: string;
  title: string;
  status: string;
  assigneeId?: string;
  assigneeName: string;
  details?: string;
  dueDate: string;
  coinValue: number;
  deleted: boolean;
  createdAt?: string;
};

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json(
    {
      error: "reauth_required",
      message: "Please sign out and sign in again to refresh your session.",
    },
    { status: 401 },
  );
}

function jsonFirestoreForbidden() {
  return NextResponse.json(
    {
      error: "firestore_forbidden",
      message:
        "Authenticated user does not have access to Firestore documents under current rules.",
    },
    { status: 403 },
  );
}

function toUnixMillis(value?: string) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function asDateOrToday(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return new Date().toISOString().slice(0, 10);
}

function normalizeDescription(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function usageKey(value: string) {
  const normalized = normalizeDescription(value).toLowerCase();
  const key = normalized
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return key || "misc";
}

async function getPrimaryFamilyId(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  return readStringArray(userDoc.fields, "familyIds")[0] ?? "";
}

async function getFamilyMemberName(
  familyId: string,
  memberId: string,
  idToken: string,
) {
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${memberId}`, idToken);
    return readString(memberDoc.fields, "name") || "Unassigned";
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return "Unassigned";
    }
    throw error;
  }
}

async function incrementUsageCount(
  path: string,
  description: string,
  idToken: string,
  usageField: "familyCount" | "globalCount",
) {
  let currentCount = 0;
  try {
    const doc = await getDocument(path, idToken);
    currentCount = readInteger(doc.fields, usageField);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const now = new Date().toISOString();
  await createOrReplaceDocument(
    path,
    {
      description: stringField(description),
      normalized: stringField(description.toLowerCase()),
      [usageField]: integerField(currentCount + 1),
      updatedAt: timestampField(now),
    },
    idToken,
  );
}

function normalizeChoreDoc(doc: {
  name: string;
  fields?: Record<string, FirestoreValue>;
}): ChoreRow {
  return {
    id: documentIdFromName(doc.name),
    title: readString(doc.fields, "title") || "Untitled chore",
    status: readString(doc.fields, "status") || "Open",
    assigneeId: readString(doc.fields, "assigneeId") || undefined,
    assigneeName: readString(doc.fields, "assigneeName") || "Unassigned",
    details: readString(doc.fields, "details") || undefined,
    dueDate: readString(doc.fields, "dueDate"),
    coinValue: readInteger(doc.fields, "coinValue") || 10,
    deleted: readBoolean(doc.fields, "deleted"),
    createdAt: readTimestamp(doc.fields, "createdAt") || undefined,
  };
}

function mapCommonFirestoreErrors(reason: string) {
  if (reason.includes("FIRESTORE_HTTP_401")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return jsonFirestoreForbidden();
  }
  return null;
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        let familyId = "";
        try {
          familyId = await getPrimaryFamilyId(session.uid, idToken);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (
            reason.includes("FIRESTORE_HTTP_404") &&
            reason.toLowerCase().includes("document") &&
            reason.toLowerCase().includes("not found")
          ) {
            return { chores: [] as ChoreRow[] };
          }
          throw error;
        }

        if (!familyId) {
          return { chores: [] as ChoreRow[] };
        }

        const docs = await listDocuments(`families/${familyId}/chores`, idToken, 500);
        const chores = docs
          .map((doc) => normalizeChoreDoc(doc))
          .filter((doc) => !doc.deleted)
          .sort((a, b) => {
            const dueSort = (a.dueDate || "").localeCompare(b.dueDate || "");
            if (dueSort !== 0) {
              return dueSort;
            }
            return toUnixMillis(b.createdAt) - toUnixMillis(a.createdAt);
          })
          .map((doc) => ({
            id: doc.id,
            title: doc.title,
            status: doc.status,
            assigneeId: doc.assigneeId,
            assigneeName: doc.assigneeName,
            details: doc.details,
            dueDate: doc.dueDate,
            coinValue: doc.coinValue,
            createdAt: doc.createdAt,
          }));

        return { chores };
      });

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORES_LIST_ERROR]", reason);
    const mapped = mapCommonFirestoreErrors(reason);
    if (mapped) {
      return mapped;
    }
    return NextResponse.json({ error: "chores_unavailable" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  let body: CreateChoresBody;
  try {
    body = (await request.json()) as CreateChoresBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const dueDate = asDateOrToday(body.dueDate);
  const details =
    typeof body.details === "string" && body.details.trim().length > 0
      ? body.details.trim().slice(0, 2000)
      : "";
  const assigneeId =
    typeof body.assigneeId === "string" && body.assigneeId.trim().length > 0
      ? body.assigneeId.trim()
      : "";
  const descriptionFromSingle =
    typeof body.description === "string" ? normalizeDescription(body.description) : "";
  const titlesInput = Array.isArray(body.titles) ? body.titles : [];
  const titlesFromList = titlesInput
    .filter((entry): entry is string => typeof entry === "string")
    .map((title) => normalizeDescription(title))
    .filter((title) => title.length > 0)
    .slice(0, 100);
  const titles = descriptionFromSingle ? [descriptionFromSingle] : titlesFromList;

  if (titles.length === 0) {
    return NextResponse.json({ error: "description_required" }, { status: 400 });
  }

  if (titles.some((title) => title.length > 160)) {
    return NextResponse.json({ error: "description_too_long" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }

        const resolvedAssigneeName = assigneeId
          ? await getFamilyMemberName(familyId, assigneeId, idToken)
          : "Unassigned";

        const now = new Date().toISOString();
        await Promise.all(
          titles.map((title) =>
            createOrReplaceDocument(
              `families/${familyId}/chores/${randomUUID()}`,
              {
                title: stringField(title),
                status: stringField("Open"),
                assigneeId: stringField(assigneeId),
                assigneeName: stringField(resolvedAssigneeName),
                details: stringField(details),
                dueDate: stringField(dueDate),
                coinValue: integerField(10),
                deleted: boolField(false),
                createdBy: stringField(session.uid),
                createdAt: timestampField(now),
              },
              idToken,
            ),
          ),
        );

        await Promise.all(
          titles.map(async (title) => {
            const key = usageKey(title);
            await incrementUsageCount(
              `families/${familyId}/choreUsage/${key}`,
              title,
              idToken,
              "familyCount",
            );
            await incrementUsageCount(
              `choreUsageGlobal/${key}`,
              title,
              idToken,
              "globalCount",
            );
          }),
        );

        return { kind: "ok" as const, created: titles.length };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }

    const response = NextResponse.json({ success: true, created: data.created }, { status: 201 });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORES_CREATE_ERROR]", reason);
    const mapped = mapCommonFirestoreErrors(reason);
    if (mapped) {
      return mapped;
    }
    return NextResponse.json({ error: "create_chores_failed" }, { status: 500 });
  }
}
