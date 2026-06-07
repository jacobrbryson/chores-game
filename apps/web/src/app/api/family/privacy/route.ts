import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  getPrimaryFamilyId,
  getViewerRole,
  jsonReauthRequired,
  jsonUnauthorized,
  mapCommonFirestoreErrors,
} from "@/lib/family/access";
import {
  getDocument,
  listAllDocuments,
  listDocuments,
  readBoolean,
  readString,
} from "@/lib/firestore/rest";
import { listConsentEvents } from "@/lib/privacy/consent-events";
import { buildDataSummary, buildPrivacyOverview } from "@/lib/privacy/service";
import type { PrivacyResponse } from "@/lib/privacy/types";

export const dynamic = "force-dynamic";

async function countCollection(path: string, idToken: string): Promise<number | null> {
  try {
    const docs = await listAllDocuments(path, idToken, { cap: 5000 });
    return docs.filter((doc) => !readBoolean(doc.fields, "deleted")).length;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return 0;
    }
    return null;
  }
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
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "no_family" as const };
        }

        const viewerRole = await getViewerRole(familyId, session.uid, idToken);
        if (viewerRole !== "admin") {
          // Child / player accounts can never access privacy controls.
          return { kind: "forbidden" as const };
        }

        const [familyDoc, memberDocs, consentHistory] = await Promise.all([
          getDocument(`families/${familyId}`, idToken),
          listDocuments(`families/${familyId}/members`, idToken, 100),
          listConsentEvents(familyId, idToken, 20).catch(() => []),
        ]);

        const activeMembers = memberDocs.filter(
          (doc) => !readBoolean(doc.fields, "deleted"),
        );

        const parentCount = activeMembers.filter(
          (doc) => readString(doc.fields, "role") === "admin",
        ).length;
        const childCount = activeMembers.filter(
          (doc) => readString(doc.fields, "role") !== "admin",
        ).length;

        const [choreCount, rewardCount, feedCount] = await Promise.all([
          countCollection(`families/${familyId}/chores`, idToken),
          countCollection(`families/${familyId}/rewards`, idToken),
          countCollection(`families/${familyId}/notifications`, idToken),
        ]);

        const overview = buildPrivacyOverview(familyDoc.fields);
        const dataSummary = buildDataSummary({
          familyProfile: 1,
          parentAccounts: parentCount,
          childAccounts: childCount,
          chores: choreCount,
          rewards: rewardCount,
          feed: feedCount,
          // Per-child achievements/quests/inventory and server-only API tokens
          // are shown as safe static categories (null) rather than fanned-out or
          // privileged reads.
          achievements: null,
          questProgress: null,
          inventory: null,
          apiTokens: null,
        });

        return {
          kind: "ok" as const,
          response: {
            noFamily: false,
            viewerRole,
            overview,
            dataSummary,
            consentHistory,
          } satisfies PrivacyResponse,
        };
      });

    if (data.kind === "no_family") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }

    const response = NextResponse.json(data.response);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_PRIVACY_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "family_privacy_unavailable");
  }
}
