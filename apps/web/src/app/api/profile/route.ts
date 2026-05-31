import { NextRequest, NextResponse } from "next/server";
import { normalizeLocale } from "@packages/locales";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { getPrimaryFamilyIdWithFallback } from "@/lib/family/member-access";
import {
  patchDocument,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";

type UpdateProfileBody = {
  name?: unknown;
  locale?: unknown;
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

function mapCommonFirestoreErrors(reason: string, fallbackError: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return jsonFirestoreForbidden();
  }
  return NextResponse.json({ error: fallbackError }, { status: 500 });
}

export async function PATCH(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  let body: UpdateProfileBody;
  try {
    body = (await request.json()) as UpdateProfileBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const nextName = typeof body.name === "string" ? body.name.trim() : "";
  const nextLocale = normalizeLocale(typeof body.locale === "string" ? body.locale : "");
  const wantsNameUpdate = nextName.length > 0;
  const wantsLocaleUpdate = Boolean(nextLocale);

  if (!wantsNameUpdate && !wantsLocaleUpdate) {
    return NextResponse.json({ error: "profile_update_required" }, { status: 400 });
  }
  if (wantsNameUpdate) {
    if (session.role !== "admin") {
      return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    }
    if (nextName.length < 2 || nextName.length > 80) {
      return NextResponse.json({ error: "name_must_be_between_2_and_80_chars" }, { status: 400 });
    }
  }
  if (wantsLocaleUpdate && nextLocale === session.locale && (!wantsNameUpdate || nextName === session.name.trim())) {
    return NextResponse.json({ success: true, name: session.name, locale: session.locale });
  }
  if (wantsNameUpdate && !wantsLocaleUpdate && nextName === session.name.trim()) {
    return NextResponse.json({ success: true, name: nextName, locale: session.locale });
  }

  try {
    const { session: refreshedSession } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const now = new Date().toISOString();
        const familyId = await getPrimaryFamilyIdWithFallback(session.uid, session.email, idToken);
        const fields: Record<string, ReturnType<typeof stringField> | ReturnType<typeof timestampField>> = {
          updatedAt: timestampField(now),
        };
        const updateMask = ["updatedAt"];
        if (wantsNameUpdate) {
          fields.name = stringField(nextName);
          fields.displayName = stringField(nextName);
          updateMask.push("name", "displayName");
        }
        if (wantsLocaleUpdate && nextLocale) {
          fields.locale = stringField(nextLocale);
          updateMask.push("locale");
        }

        await patchDocument(`users/${session.uid}`, fields, idToken, updateMask);
        if (familyId) {
          const memberFields: Record<string, ReturnType<typeof stringField> | ReturnType<typeof timestampField>> = {
            updatedAt: timestampField(now),
          };
          const memberUpdateMask = ["updatedAt"];
          if (wantsNameUpdate) {
            memberFields.name = stringField(nextName);
            memberUpdateMask.push("name");
          }
          if (wantsLocaleUpdate && nextLocale) {
            memberFields.locale = stringField(nextLocale);
            memberUpdateMask.push("locale");
          }
          await patchDocument(
            `families/${familyId}/members/${session.uid}`,
            memberFields,
            idToken,
            memberUpdateMask,
          );
        }

        return null;
      },
    );

    const updatedSession = {
      ...refreshedSession,
      name: wantsNameUpdate ? nextName : refreshedSession.name,
      locale: wantsLocaleUpdate && nextLocale ? nextLocale : refreshedSession.locale,
      authName:
        wantsNameUpdate && refreshedSession.authUid === session.uid ? nextName : refreshedSession.authName,
      authLocale:
        wantsLocaleUpdate && refreshedSession.authUid === session.uid && nextLocale
          ? nextLocale
          : refreshedSession.authLocale,
    };
    const response = NextResponse.json({
      success: true,
      name: updatedSession.name,
      locale: updatedSession.locale,
    });
    setSessionUserCookie(response, updatedSession);
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[PROFILE_PATCH_ERROR]", reason);
    if (
      reason.includes("FIRESTORE_HTTP_404") &&
      reason.toLowerCase().includes("document") &&
      reason.toLowerCase().includes("not found")
    ) {
      return NextResponse.json({ error: "profile_not_found" }, { status: 404 });
    }
    return mapCommonFirestoreErrors(reason, "profile_update_failed");
  }
}
