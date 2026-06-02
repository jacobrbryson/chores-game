import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  boolField,
  createOrReplaceDocument,
  findFirstFamilyIdByMemberUid,
  getDocument,
  readStringArray,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import { checkRateLimit, consumeRateLimit } from "@/lib/rate-limit/limiter";
import {
  filterSupportRequests,
  loadAllSupportRequests,
  paginateSupportRequests,
  sortSupportRequests,
  summarizeSupportRequests,
} from "@/lib/support/management";
import { isSupportAdmin } from "@/lib/support/access";
import {
  DEFAULT_SUPPORT_REQUEST_STATUS,
  MAX_SUPPORT_USER_AGENT_LENGTH,
  validateSupportRequest,
  type SupportRequestInput,
} from "@/lib/support/requests";

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

function mapCommonFirestoreErrors(reason: string, fallbackError: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return jsonFirestoreForbidden();
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

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  try {
    const allRequests = await loadAllSupportRequests();
    const filtered = filterSupportRequests(allRequests, {
      type: searchParams.get("type") ?? "",
      status: searchParams.get("status") ?? "",
      severity: searchParams.get("severity") ?? "",
      q: searchParams.get("q") ?? "",
      familyId: searchParams.get("familyId") ?? "",
      reporter: searchParams.get("reporter") ?? "",
      createdFrom: searchParams.get("createdFrom") ?? "",
      createdTo: searchParams.get("createdTo") ?? "",
      sortBy: searchParams.get("sortBy") ?? "updatedAt",
      sortDir: searchParams.get("sortDir") ?? "desc",
      page: Number(searchParams.get("page") ?? "1"),
      limit: Number(searchParams.get("limit") ?? "25"),
    });
    const sorted = sortSupportRequests(filtered, {
      sortBy: searchParams.get("sortBy") ?? "updatedAt",
      sortDir: searchParams.get("sortDir") ?? "desc",
    });
    const { records, pagination } = paginateSupportRequests(sorted, {
      page: Number(searchParams.get("page") ?? "1"),
      limit: Number(searchParams.get("limit") ?? "25"),
    });

    return NextResponse.json({
      requests: records,
      pagination,
      summary: summarizeSupportRequests(allRequests),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_REQUESTS_LIST_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "support_requests_unavailable" }, { status: 500 });
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

  let body: SupportRequestInput;
  try {
    body = (await request.json()) as SupportRequestInput;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const validation = validateSupportRequest(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const input = validation.value;

  // Prefer a server-observed user agent; fall back to one intentionally passed
  // by the client. Never store anything beyond the UA string.
  const headerUserAgent = request.headers.get("user-agent") ?? "";
  const userAgent = (headerUserAgent || input.userAgent).slice(0, MAX_SUPPORT_USER_AGENT_LENGTH);

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }

        const limit = await checkRateLimit({
          action: "support_request",
          familyId,
          uid: session.uid,
          idToken,
        });
        if (!limit.allowed) {
          return { kind: "rate_limited" as const, scope: limit.scope, limit: limit.limit };
        }

        const supportRequestId = randomUUID();
        const now = new Date().toISOString();
        const fields: Record<string, FirestoreValue> = {
          id: stringField(supportRequestId),
          familyId: stringField(familyId),
          createdByUid: stringField(session.uid),
          createdByMemberId: stringField(session.memberId || session.uid),
          createdByDisplayName: stringField(session.name ?? ""),
          createdByEmail: stringField(session.email ?? ""),
          type: stringField(input.type),
          subject: stringField(input.subject),
          description: stringField(input.description),
          // Bug reports carry a severity; feature requests omit it (an absent
          // field reads as null in Firestore rules, satisfying severity == null).
          ...(input.severity ? { severity: stringField(input.severity) } : {}),
          status: stringField(DEFAULT_SUPPORT_REQUEST_STATUS),
          appliedChangeLogDate: stringField(""),
          pageUrl: stringField(input.pageUrl),
          userAgent: stringField(userAgent),
          createdAt: timestampField(now),
          updatedAt: timestampField(now),
          deleted: boolField(false),
        };

        await createOrReplaceDocument(
          `families/${familyId}/supportRequests/${supportRequestId}`,
          fields,
          idToken,
        );

        // Best-effort: consume rate-limit quota after the request is persisted.
        try {
          await consumeRateLimit({
            action: "support_request",
            familyId,
            uid: session.uid,
            idToken,
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : "unknown";
          console.warn("[SUPPORT_RATE_LIMIT_CONSUME_SKIPPED]", reason.slice(0, 180));
        }

        // Immutable family audit entry. We intentionally do NOT include the
        // description per existing audit policy.
        await writeAuditLogBestEffort({
          familyId,
          idToken,
          eventType: "support_request_created",
          source: "support",
          requestId: supportRequestId,
          actor: {
            uid: session.uid,
            email: session.email,
            name: session.name,
            role: session.role,
          },
          next: {
            supportRequestId,
            type: input.type,
          },
        });

        return {
          kind: "ok" as const,
          supportRequest: {
            id: supportRequestId,
            familyId,
            type: input.type,
            subject: input.subject,
            severity: input.severity,
            status: DEFAULT_SUPPORT_REQUEST_STATUS,
            createdAt: now,
          },
        };
      },
    );

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "rate_limited") {
      return NextResponse.json(
        { error: "rate_limited", scope: data.scope, limit: data.limit },
        { status: 429 },
      );
    }

    const response = NextResponse.json({ supportRequest: data.supportRequest }, { status: 201 });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[SUPPORT_REQUEST_CREATE_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "create_support_request_failed");
  }
}
