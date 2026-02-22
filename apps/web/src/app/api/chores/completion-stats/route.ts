import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  documentIdFromName,
  getDocument,
  listDocuments,
  readBoolean,
  readString,
  readStringArray,
  readTimestamp,
} from "@/lib/firestore/rest";

type CompletionWindow = "today" | "week" | "year";
type CompletionCount = {
  memberId: string;
  name: string;
  count: number;
};

type MemberRow = {
  id: string;
  uid: string | undefined;
  email: string;
  name: string;
  deleted: boolean;
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

function parseWindow(value: string | null): CompletionWindow {
  if (value === "week" || value === "year") {
    return value;
  }
  return "today";
}

function windowStartIso(window: CompletionWindow) {
  const now = new Date();
  if (window === "today") {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    return start.toISOString();
  }
  const days = window === "week" ? 7 : 365;
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return start.toISOString();
}

function dueDateToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "";
  }
  return `${value}T00:00:00.000Z`;
}

function toUnixMillis(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

async function getPrimaryFamilyId(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  return readStringArray(userDoc.fields, "familyIds")[0] ?? "";
}

function mapCommonFirestoreErrors(reason: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
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

  const window = parseWindow(request.nextUrl.searchParams.get("window"));

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
            return { window, counts: [] as CompletionCount[] };
          }
          throw error;
        }
        if (!familyId) {
          return { window, counts: [] as CompletionCount[] };
        }

        const [memberDocs, choreDocs] = await Promise.all([
          listDocuments(`families/${familyId}/members`, idToken, 100),
          listDocuments(`families/${familyId}/chores`, idToken, 500),
        ]);

        const rawMembers = memberDocs
          .map((doc) => ({
            id: documentIdFromName(doc.name),
            uid: readString(doc.fields, "uid") || undefined,
            email: readString(doc.fields, "email"),
            name: readString(doc.fields, "name") || "Unnamed member",
            deleted: readBoolean(doc.fields, "deleted"),
          }))
          .filter((member) => !member.deleted);

        const normalizedEmailWithUid = new Set(
          rawMembers
            .filter((member) => Boolean(member.uid))
            .map((member) => normalizeEmail(member.email))
            .filter(Boolean),
        );

        const members = rawMembers.filter((member) => {
          if (member.uid) {
            return true;
          }
          const normalizedEmail = normalizeEmail(member.email);
          if (!normalizedEmail) {
            return true;
          }
          return !normalizedEmailWithUid.has(normalizedEmail);
        });

        const countsMap = new Map(members.map((member) => [member.id, 0]));
        const canonicalByEmail = new Map(
          members
            .map((member) => [normalizeEmail(member.email), member.id] as const)
            .filter(([email]) => Boolean(email)),
        );
        const assigneeAliasToMemberId = new Map<string, string>();
        for (const member of members) {
          assigneeAliasToMemberId.set(member.id, member.id);
          if (member.uid) {
            assigneeAliasToMemberId.set(member.uid, member.id);
          }
        }
        for (const member of rawMembers) {
          const normalizedEmail = normalizeEmail(member.email);
          if (!normalizedEmail || assigneeAliasToMemberId.has(member.id)) {
            continue;
          }
          const canonicalId = canonicalByEmail.get(normalizedEmail);
          if (canonicalId) {
            assigneeAliasToMemberId.set(member.id, canonicalId);
          }
        }

        const startMillis = toUnixMillis(windowStartIso(window));

        for (const doc of choreDocs) {
          if (readBoolean(doc.fields, "deleted")) {
            continue;
          }
          const status = readString(doc.fields, "status");
          if (status !== "Submitted" && status !== "Approved") {
            continue;
          }
          const assigneeId = readString(doc.fields, "assigneeId");
          const countedMemberId = assigneeId
            ? assigneeAliasToMemberId.get(assigneeId) ?? assigneeId
            : "";
          if (!countedMemberId || !countsMap.has(countedMemberId)) {
            continue;
          }

          const submittedAt = readTimestamp(doc.fields, "submittedAt");
          const updatedAt = readTimestamp(doc.fields, "updatedAt");
          const dueDate = readString(doc.fields, "dueDate");
          const completedAt = submittedAt || updatedAt || dueDateToIso(dueDate);
          if (!completedAt || toUnixMillis(completedAt) < startMillis) {
            continue;
          }

          countsMap.set(countedMemberId, (countsMap.get(countedMemberId) ?? 0) + 1);
        }

        const counts = members
          .map((member) => ({
            memberId: member.id,
            name: member.name,
            count: countsMap.get(member.id) ?? 0,
          }))
          .sort((a, b) => {
            if (b.count !== a.count) {
              return b.count - a.count;
            }
            return a.name.localeCompare(b.name);
          });

        return { window, counts };
      });

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORES_COMPLETION_STATS_ERROR]", reason);
    const mapped = mapCommonFirestoreErrors(reason);
    if (mapped) {
      return mapped;
    }
    return NextResponse.json({ error: "completion_stats_unavailable" }, { status: 500 });
  }
}
