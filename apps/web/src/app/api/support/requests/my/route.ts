import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  documentIdFromName,
  findFirstFamilyIdByMemberUid,
  getDocument,
  readBoolean,
  readString,
  readStringArray,
  readTimestamp,
  runQuery,
} from "@/lib/firestore/rest";
import { normalizeSupportRequestStatus, type SupportRequest } from "@/lib/support/requests";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
// Hard cap on documents pulled for in-memory sort/pagination. Per-user volume is
// bounded by the daily rate limit, so this comfortably covers real usage.
const MAX_FETCH = 500;

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

function mapCommonFirestoreErrors(reason: string, fallbackError: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return NextResponse.json(
      {
        error: "firestore_forbidden",
        message:
          "Authenticated user does not have access to Firestore documents under current rules.",
      },
      { status: 403 },
    );
  }
  return NextResponse.json({ error: fallbackError }, { status: 500 });
}

async function getPrimaryFamilyId(uid: string, idToken: string) {
  let familyId = "";
  try {
    const userDoc = await getDocument(`users/${uid}`, idToken);
    familyId = readStringArray(userDoc.fields, "familyIds")[0] ?? "";
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }
  if (familyId) {
    return familyId;
  }
  return findFirstFamilyIdByMemberUid(uid, idToken);
}

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const page = parsePositiveInt(request.nextUrl.searchParams.get("page"), 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    parsePositiveInt(request.nextUrl.searchParams.get("limit"), DEFAULT_PAGE_SIZE),
  );

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { noFamily: true, requests: [] as SupportRequest[], total: 0 };
        }

        // Filter by createdByUid so the list query satisfies the own-read rule;
        // sort/paginate in memory to avoid a composite index requirement.
        const docs = await runQuery(
          {
            from: [{ collectionId: "supportRequests" }],
            where: {
              fieldFilter: {
                field: { fieldPath: "createdByUid" },
                op: "EQUAL",
                value: { stringValue: session.uid },
              },
            },
            limit: MAX_FETCH,
          },
          idToken,
          `families/${familyId}`,
        );

        const requests: SupportRequest[] = docs
          // Hide operator-deleted requests and ones the user cancelled (the
          // request still exists for support, just not in the user's list).
          .filter(
            (doc) =>
              !readBoolean(doc.fields, "deleted") &&
              !readBoolean(doc.fields, "cancelledByUser"),
          )
          .map((doc): SupportRequest => {
            const severity = readString(doc.fields, "severity");
            return {
              id: documentIdFromName(doc.name),
              familyId,
              createdByUid: readString(doc.fields, "createdByUid"),
              createdByMemberId: readString(doc.fields, "createdByMemberId"),
              createdByDisplayName: readString(doc.fields, "createdByDisplayName"),
              createdByEmail: readString(doc.fields, "createdByEmail"),
              type: readString(doc.fields, "type") === "feature" ? "feature" : "bug",
              subject: readString(doc.fields, "subject"),
              description: readString(doc.fields, "description"),
              severity:
                severity === "low" || severity === "medium" || severity === "high"
                  ? severity
                  : null,
              category: readString(doc.fields, "category"),
              status: normalizeSupportRequestStatus(readString(doc.fields, "status")),
              appliedChangeLogDate: readString(doc.fields, "appliedChangeLogDate"),
              pageUrl: readString(doc.fields, "pageUrl"),
              userAgent: readString(doc.fields, "userAgent"),
              createdAt: readTimestamp(doc.fields, "createdAt"),
              updatedAt: readTimestamp(doc.fields, "updatedAt"),
              deleted: false,
              isPublic: readBoolean(doc.fields, "isPublic"),
              publicTitle: readString(doc.fields, "publicTitle"),
              publicDescription: readString(doc.fields, "publicDescription"),
              publicStatus: "under_review",
              publicPublishedAt: readTimestamp(doc.fields, "publicPublishedAt"),
              publicPublishedByUid: readString(doc.fields, "publicPublishedByUid"),
              publicUpdatedAt: readTimestamp(doc.fields, "publicUpdatedAt"),
            };
          })
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

        return { noFamily: false, requests, total: requests.length };
      },
    );

    const total = data.total;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const offset = (safePage - 1) * pageSize;
    const items = data.requests.slice(offset, offset + pageSize);

    const response = NextResponse.json({
      requests: items,
      pagination: {
        page: safePage,
        pageSize,
        total,
        totalPages,
      },
    });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[SUPPORT_REQUESTS_MY_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "support_requests_unavailable");
  }
}
