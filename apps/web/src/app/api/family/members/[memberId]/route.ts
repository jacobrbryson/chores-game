import { NextRequest, NextResponse } from "next/server";
import { normalizeLocale } from "@packages/locales";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { keyableEmail } from "@/lib/auth/private-relay";
import {
  boolField,
  createOrReplaceDocument,
  getDocument,
  integerField,
  patchDocument,
  stringField,
  readInteger,
  readString,
  readStringArray,
  timestampField,
  type FirestoreValue,
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

  const body = (await request.json().catch(() => ({}))) as { locale?: unknown; birthYear?: unknown };

  // Locale update (optional). When `locale` is present it must be valid.
  const localeRequested = typeof body.locale === "string" && body.locale.length > 0;
  const nextLocale = localeRequested ? normalizeLocale(body.locale as string) : null;
  if (localeRequested && !nextLocale) {
    return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
  }

  // Birth-year update (optional). `null` clears it; a number must be a plausible
  // year. We deliberately store only the YEAR, never a full date of birth.
  const birthYearRequested = Object.prototype.hasOwnProperty.call(body, "birthYear");
  let nextBirthYear: number | null = null; // null => clear
  if (birthYearRequested && body.birthYear !== null) {
    const year = Number(body.birthYear);
    const currentYear = new Date().getUTCFullYear();
    if (!Number.isInteger(year) || year < 1900 || year > currentYear) {
      return NextResponse.json({ error: "invalid_birth_year" }, { status: 400 });
    }
    nextBirthYear = year;
  }

  if (!localeRequested && !birthYearRequested) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
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
        const isAdmin = requesterRole === "admin";
        const targetDoc = await getDocument(`families/${familyId}/members/${memberId}`, idToken);
        const targetUid = readString(targetDoc.fields, "uid").trim();
        const currentLocale = readString(targetDoc.fields, "locale").trim();
        const currentBirthYear = readInteger(targetDoc.fields, "birthYear");
        const isSelf = memberId === session.memberId || memberId === session.uid || targetUid === session.uid;

        // Locale: self or admin. Birth year: admin only (parents manage children).
        if (localeRequested && !isSelf && !isAdmin) {
          return { kind: "not_allowed" as const };
        }
        if (birthYearRequested && !isAdmin) {
          return { kind: "not_allowed" as const };
        }

        const now = new Date().toISOString();
        const memberPatch: Record<string, FirestoreValue> = {};
        const memberMask: string[] = [];
        let localeChanged = false;

        if (nextLocale && currentLocale !== nextLocale) {
          memberPatch.locale = stringField(nextLocale);
          memberMask.push("locale");
          localeChanged = true;
        }
        if (birthYearRequested) {
          const desired = nextBirthYear ?? 0;
          if (desired !== currentBirthYear) {
            memberPatch.birthYear = integerField(desired);
            memberMask.push("birthYear");
          }
        }

        if (memberMask.length > 0) {
          memberPatch.updatedAt = timestampField(now);
          memberMask.push("updatedAt");
          await patchDocument(`families/${familyId}/members/${memberId}`, memberPatch, idToken, memberMask);
        }

        if (localeChanged && targetUid) {
          await patchDocument(
            `users/${targetUid}`,
            { locale: stringField(nextLocale!), updatedAt: timestampField(now) },
            idToken,
            ["locale", "updatedAt"],
          );
        }

        if (localeChanged && !isSelf) {
          await writeAuditLogBestEffort({
            familyId,
            idToken,
            eventType: "member_locale_changed",
            actor: { uid: session.uid, email: session.email, name: session.name, role: session.role },
            userId: targetUid || memberId,
            source: "family_member_locale",
            previous: { locale: currentLocale || "" },
            next: { locale: nextLocale! },
            reason: "parent_changed_member_locale",
          });
        }
        if (memberMask.includes("birthYear")) {
          await writeAuditLogBestEffort({
            familyId,
            idToken,
            eventType: "member_birth_year_changed",
            actor: { uid: session.uid, email: session.email, name: session.name, role: session.role },
            userId: targetUid || memberId,
            source: "family_member_birth_year",
            previous: { birthYear: currentBirthYear || "" },
            next: { birthYear: nextBirthYear ?? "" },
            reason: "parent_changed_member_birth_year",
          });
        }

        return {
          kind: "ok" as const,
          locale: localeChanged ? nextLocale ?? undefined : undefined,
          localeChanged,
          birthYear: birthYearRequested ? nextBirthYear : currentBirthYear || undefined,
          targetUid,
        };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "not_allowed") {
      return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    }

    const nextSession =
      data.localeChanged && data.locale && data.targetUid && data.targetUid === session.uid
        ? { ...refreshedSession, locale: data.locale }
        : refreshedSession;
    const response = NextResponse.json({ success: true, locale: data.locale, birthYear: data.birthYear });
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
        // A private-relay address is never a document key, so there is no
        // inviteLookup record keyed on it to revoke.
        const revokeLookupEmail = keyableEmail(memberEmail);
        if (revokeLookupEmail) {
          await createOrReplaceDocument(
            `inviteLookup/${revokeLookupEmail}`,
            {
              email: stringField(revokeLookupEmail),
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
