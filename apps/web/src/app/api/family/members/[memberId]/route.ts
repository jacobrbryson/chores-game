import { NextRequest, NextResponse } from "next/server";
import { normalizeLocale } from "@packages/locales";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import {
  boolField,
  createOrReplaceDocument,
  getDocument,
  patchDocument,
  stringField,
  readString,
  readStringArray,
  timestampField,
} from "@/lib/firestore/rest";

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

async function getPrimaryFamilyId(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  return readStringArray(userDoc.fields, "familyIds")[0] ?? "";
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ memberId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { memberId } = await context.params;
  if (!memberId) {
    return NextResponse.json({ error: "member_id_required" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { locale?: unknown };
  const nextLocale = normalizeLocale(typeof body.locale === "string" ? body.locale : "");
  if (!nextLocale) {
    return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }

        const requesterMemberDoc = await getDocument(
          `families/${familyId}/members/${session.memberId || session.uid}`,
          idToken,
        ).catch(async () => getDocument(`families/${familyId}/members/${session.uid}`, idToken));
        const requesterRole = readString(requesterMemberDoc.fields, "role");
        const targetDoc = await getDocument(`families/${familyId}/members/${memberId}`, idToken);
        const targetUid = readString(targetDoc.fields, "uid").trim();
        const currentLocale = readString(targetDoc.fields, "locale").trim();
        const isSelf = memberId === session.memberId || memberId === session.uid || targetUid === session.uid;

        if (!isSelf && requesterRole !== "admin") {
          return { kind: "not_allowed" as const };
        }
        if (currentLocale === nextLocale) {
          return { kind: "ok" as const, locale: nextLocale, targetUid };
        }

        const now = new Date().toISOString();
        await patchDocument(
          `families/${familyId}/members/${memberId}`,
          {
            locale: stringField(nextLocale),
            updatedAt: timestampField(now),
          },
          idToken,
          ["locale", "updatedAt"],
        );
        if (targetUid) {
          await patchDocument(
            `users/${targetUid}`,
            {
              locale: stringField(nextLocale),
              updatedAt: timestampField(now),
            },
            idToken,
            ["locale", "updatedAt"],
          );
        }
        if (!isSelf) {
          await writeAuditLogBestEffort({
            familyId,
            idToken,
            eventType: "member_locale_changed",
            actor: {
              uid: session.uid,
              email: session.email,
              name: session.name,
              role: session.role,
            },
            userId: targetUid || memberId,
            source: "family_member_locale",
            previous: { locale: currentLocale || "" },
            next: { locale: nextLocale },
            reason: "parent_changed_member_locale",
          });
        }
        return { kind: "ok" as const, locale: nextLocale, targetUid };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "not_allowed") {
      return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    }

    const nextSession =
      data.targetUid && data.targetUid === session.uid
        ? { ...refreshedSession, locale: data.locale }
        : refreshedSession;
    const response = NextResponse.json({ success: true, locale: data.locale });
    if (refreshed || nextSession.locale !== refreshedSession.locale) {
      setSessionUserCookie(response, nextSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[UPDATE_FAMILY_MEMBER_LOCALE_ERROR]", reason);
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return jsonFirestoreForbidden();
    }
    if (
      reason.includes("FIRESTORE_HTTP_404") &&
      reason.toLowerCase().includes("document") &&
      reason.toLowerCase().includes("not found")
    ) {
      return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "member_locale_update_failed" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ memberId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { memberId } = await context.params;
  if (!memberId) {
    return NextResponse.json({ error: "member_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }

        const requesterMemberDoc = await getDocument(
          `families/${familyId}/members/${session.uid}`,
          idToken,
        );
        const requesterRole = readString(requesterMemberDoc.fields, "role");
        if (requesterRole !== "admin") {
          return { kind: "not_allowed" as const };
        }

        const memberDoc = await getDocument(`families/${familyId}/members/${memberId}`, idToken);
        const memberUid = readString(memberDoc.fields, "uid");
        const memberEmail = readString(memberDoc.fields, "email").trim().toLowerCase();
        if (memberId === session.uid || memberUid === session.uid) {
          return { kind: "cannot_remove_self" as const };
        }

        const now = new Date().toISOString();
        await patchDocument(
          `families/${familyId}/members/${memberId}`,
          {
            deleted: boolField(true),
            deletedAt: timestampField(now),
          },
          idToken,
          ["deleted", "deletedAt"],
        );
        if (memberEmail) {
          await createOrReplaceDocument(
            `inviteLookup/${memberEmail}`,
            {
              email: stringField(memberEmail),
              familyId: stringField(familyId),
              status: stringField("revoked"),
              updatedAt: timestampField(now),
            },
            idToken,
          );
        }
        return { kind: "ok" as const };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "cannot_remove_self") {
      return NextResponse.json({ error: "cannot_remove_self" }, { status: 400 });
    }
    if (data.kind === "not_allowed") {
      return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    }

    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[REMOVE_FAMILY_MEMBER_ERROR]", reason);
    if (reason.includes("FIRESTORE_HTTP_401")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return jsonFirestoreForbidden();
    }
    if (
      reason.includes("FIRESTORE_HTTP_404") &&
      reason.toLowerCase().includes("document") &&
      reason.toLowerCase().includes("not found")
    ) {
      return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "remove_member_failed" }, { status: 500 });
  }
}
