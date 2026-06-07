import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import {
  getPrimaryFamilyId,
  getViewerRole,
  jsonReauthRequired,
  jsonUnauthorized,
  mapCommonFirestoreErrors,
} from "@/lib/family/access";
import { patchDocument, stringField, timestampField } from "@/lib/firestore/rest";

type CompleteBody = {
  familyName?: unknown;
};

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  let body: CompleteBody = {};
  try {
    body = (await request.json()) as CompleteBody;
  } catch {
    body = {};
  }

  const rawName = typeof body.familyName === "string" ? body.familyName.trim() : "";
  const familyName = rawName.length >= 2 && rawName.length <= 80 ? rawName : "";

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "no_family" as const };
        }

        const viewerRole = await getViewerRole(familyId, session.uid, idToken);
        if (viewerRole !== "admin") {
          return { kind: "forbidden" as const };
        }

        const now = new Date().toISOString();
        const maskFields = ["onboardingCompletedAt", "updatedAt"];
        const patchFields: Record<string, ReturnType<typeof stringField | typeof timestampField>> =
          {
            onboardingCompletedAt: timestampField(now),
            updatedAt: timestampField(now),
          };

        if (familyName) {
          patchFields.name = stringField(familyName);
          maskFields.push("name");
        }

        await patchDocument(`families/${familyId}`, patchFields, idToken, maskFields);

        await writeAuditLogBestEffort({
          familyId,
          idToken,
          eventType: "onboarding_completed",
          source: "onboarding",
          actor: {
            uid: session.uid,
            email: session.email,
            name: session.name,
            role: viewerRole,
          },
          next: { familyName: familyName || undefined },
        });

        return { kind: "ok" as const };
      });

    if (data.kind === "no_family") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }

    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ONBOARDING_COMPLETE_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "onboarding_complete_failed");
  }
}
