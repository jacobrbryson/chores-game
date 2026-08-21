import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { createFamilyForUser } from "@/lib/family/bootstrap";
import { getViewerRole } from "@/lib/family/access";
import { linkUserPrimaryFamily } from "@/lib/family/user-link";
import {
  boolField,
  createOrReplaceDocument,
  integerField,
  findFirstFamilyIdByMemberUid,
  getDocument,
  listDocuments,
  readBoolean,
  readString,
  readStringArray,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import {
  DEFAULT_COLOR_THEME_OPTION_ID,
  DEFAULT_CONFETTI_OPTION_ID,
  findColorThemeOptionById,
} from "@/lib/store/catalog";
import { DEFAULT_LOCALE } from "@/lib/locale";
import { trackAchievementEvent } from "@/lib/achievements/service";
import { shouldBlockOnboardingFirstChild } from "@/lib/family/onboarding";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { keyableEmail } from "@/lib/auth/private-relay";
import { createFamilyInvite } from "@/lib/family/invite-repository";
import {
  buildFamilyInviteUrl,
  createFamilyInviteCode,
  createFamilyInviteId,
  formatFamilyInviteCode,
} from "@/lib/family/invite-tokens";

type AddMemberBody = {
  name?: string;
  email?: string;
  role?: string;
  // Where the create request originated. "onboarding" = the first-run wizard;
  // anything else (or omitted) = regular family-management UI.
  source?: string;
  // True when this is the very first child the onboarding wizard is adding in
  // this session. Used with `source` to block duplicate-child creation when a
  // family that already has children was wrongly routed into onboarding.
  onboardingFirstChild?: boolean;
};
const MAX_FAMILY_MEMBERS = 100;

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

function jsonFirestoreNotConfigured() {
  return NextResponse.json(
    {
      error: "firestore_not_configured",
      message:
        "Cloud Firestore default database is not configured for this project.",
    },
    { status: 503 },
  );
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function getUserFamilyIds(uid: string, idToken: string) {
  try {
    const userDoc = await getDocument(`users/${uid}`, idToken);
    return readStringArray(userDoc.fields, "familyIds");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("FIRESTORE_HTTP_404")) {
      return [];
    }
    throw error;
  }
}


export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  let body: AddMemberBody;
  try {
    body = (await request.json()) as AddMemberBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const role = body.role === "admin" ? "admin" : "player";
  const source = typeof body.source === "string" ? body.source : "family_management";
  const onboardingFirstChild = body.onboardingFirstChild === true;

  if (name.length < 2 || name.length > 80) {
    return NextResponse.json(
      { error: "name_must_be_between_2_and_80_chars" },
      { status: 400 },
    );
  }

  if (email && !isLikelyEmail(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (role === "admin" && !email) {
    return NextResponse.json({ error: "email_required_for_admin" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        let familyIds = await getUserFamilyIds(session.uid, idToken);
        let familyId = familyIds[0];
        if (!familyId) {
          const recoveredFamilyId = await findFirstFamilyIdByMemberUid(session.uid, idToken);
          if (recoveredFamilyId) {
            familyId = recoveredFamilyId;
            await linkUserPrimaryFamily({
              uid: session.uid,
              familyId,
              role: await getViewerRole(familyId, session.uid, idToken),
              session,
              idToken,
            });
          } else {
            familyId = await createFamilyForUser({
              uid: session.uid,
              userName: session.name,
              userEmail: session.email,
              idToken,
            });
            // createFamilyForUser does not write the user doc, and sign-in no
            // longer does either for a family-less account, so this may be the
            // first `users/{uid}` write. createFamilyForUser has already created
            // the admin member document, which the create rule requires to
            // exist and to match the role written here.
            await linkUserPrimaryFamily({
              uid: session.uid,
              familyId,
              role: "admin",
              session,
              idToken,
            });
          }
          familyIds = [familyId];
        }

        const defaultTheme = findColorThemeOptionById(DEFAULT_COLOR_THEME_OPTION_ID)?.theme ?? {
          primary: "#0072b2",
          secondary: "#56b4e9",
          tertiary: "#1b2a41",
        };
        const isManagedLocalPlayer = role === "player" && !email;
        // An Apple private-relay address is a contact detail, never an identity
        // key: keying on it manufactures an invite document the inviting parent
        // can never match and the Stale Invites panel later has to clean up.
        const keyEmail = keyableEmail(email);
        const memberId = keyEmail || randomUUID();
        const existingMembers = await listDocuments(`families/${familyId}/members`, idToken, 300);
        const activeMemberCount = existingMembers.filter(
          (doc) => !readBoolean(doc.fields, "deleted"),
        ).length;
        const activeChildCount = existingMembers.filter(
          (doc) =>
            !readBoolean(doc.fields, "deleted") &&
            readString(doc.fields, "role") === "player",
        ).length;

        // Server-side guard against the duplicate-child P0: if the request is the
        // onboarding wizard's "first child" but the family already has children,
        // the caller was wrongly routed into onboarding. Refuse, and tell the
        // client setup is already complete so it can bounce to the dashboard.
        // Regular family-management adds (a different source) are never blocked.
        if (
          shouldBlockOnboardingFirstChild({
            source,
            onboardingFirstChild,
            existingChildCount: activeChildCount,
          })
        ) {
          console.warn(
            "[ONBOARDING_DUPLICATE_CHILD_PREVENTED]",
            JSON.stringify({
              user_id: session.uid,
              family_id: familyId,
              child_count: activeChildCount,
              child_creation_source: source,
              onboarding_first_child: onboardingFirstChild,
            }),
          );
          return { kind: "setup_already_complete" as const };
        }

        const targetExists = existingMembers.some((doc) => doc.name.endsWith(`/${memberId}`));
        if (!targetExists && activeMemberCount >= MAX_FAMILY_MEMBERS) {
          return { kind: "family_member_limit_reached" as const };
        }

        console.info(
          "[FAMILY_MEMBER_CREATE]",
          JSON.stringify({
            user_id: session.uid,
            family_id: familyId,
            child_count: activeChildCount,
            role,
            child_creation_source: source,
            onboarding_first_child: onboardingFirstChild,
          }),
        );

        const now = new Date().toISOString();
        await createOrReplaceDocument(
          `families/${familyId}/members/${memberId}`,
          {
            name: stringField(name),
            email: stringField(email),
            uid: stringField(isManagedLocalPlayer ? memberId : ""),
            role: stringField(role),
            locale: stringField(DEFAULT_LOCALE),
            status: stringField(isManagedLocalPlayer ? "active" : "invited"),
            deleted: boolField(false),
            dashboardPrimaryColor: stringField(defaultTheme.primary),
            selectedConfettiOptionId: stringField(DEFAULT_CONFETTI_OPTION_ID),
            createdBy: stringField(session.uid),
            createdAt: timestampField(now),
          },
          idToken,
        );
        if (isManagedLocalPlayer) {
          await createOrReplaceDocument(
            `users/${memberId}`,
            {
              uid: stringField(memberId),
              role: stringField("player"),
              provider: stringField("local"),
              email: stringField(""),
              displayName: stringField(name),
              locale: stringField(DEFAULT_LOCALE),
              familyIds: stringArrayField([familyId]),
              walletBalance: integerField(0),
              ownedStoreOptionIds: stringArrayField([
                DEFAULT_COLOR_THEME_OPTION_ID,
                DEFAULT_CONFETTI_OPTION_ID,
              ]),
              preferencesThemeOptionId: stringField(DEFAULT_COLOR_THEME_OPTION_ID),
              preferencesThemePrimaryColor: stringField(defaultTheme.primary),
              preferencesThemeSecondaryColor: stringField(defaultTheme.secondary),
              preferencesThemeTertiaryColor: stringField(defaultTheme.tertiary),
              selectedConfettiOptionId: stringField(DEFAULT_CONFETTI_OPTION_ID),
              createdAt: timestampField(now),
              lastFamilyUpdateAt: timestampField(now),
              storeUpdatedAt: timestampField(now),
              preferencesUpdatedAt: timestampField(now),
            },
            idToken,
          );
        }
        // Legacy email-keyed index. Still written so pending invites and older
        // clients keep resolving exactly as they do today; the invite code
        // below is the path that does not depend on email equality.
        if (keyEmail) {
          await createOrReplaceDocument(
            `inviteLookup/${keyEmail}`,
            {
              email: stringField(keyEmail),
              familyId: stringField(familyId),
              role: stringField(role),
              status: stringField("invited"),
              updatedAt: timestampField(now),
            },
            idToken,
          );
        }

        let invite: { code: string; formattedCode: string; url: string; expiresAt: string } | null =
          null;
        if (!isManagedLocalPlayer) {
          let familyName = "";
          try {
            familyName = readString(
              (await getDocument(`families/${familyId}`, idToken)).fields,
              "name",
            );
          } catch {
            // Presentation metadata only; the invite itself does not need it.
          }
          const inviteId = createFamilyInviteId();
          const code = createFamilyInviteCode();
          const created = await createFamilyInvite({
            inviteId,
            code,
            familyId,
            familyName,
            memberId,
            invitedName: name,
            invitedEmail: keyEmail,
            role,
            createdByUid: session.uid,
            now,
          });
          invite = {
            code,
            formattedCode: formatFamilyInviteCode(code),
            url: buildFamilyInviteUrl(code),
            expiresAt: created.expiresAt,
          };
          await writeAuditLogBestEffort({
            familyId,
            idToken,
            eventType: "family_invite_created",
            actor: { uid: session.uid, email: session.email, name: session.name, role: "admin" },
            userId: memberId,
            source: "family_members_api",
            next: {
              inviteId,
              memberId,
              role,
              invitedEmail: keyEmail,
              privateRelayEmail: Boolean(email) && !keyEmail,
              expiresAt: created.expiresAt,
            },
          });
        }
        if (isManagedLocalPlayer && session.role === "admin") {
          await trackAchievementEvent({
            uid: session.uid,
            familyId,
            idToken,
            viewerRole: "admin",
            eventId: `family_member_active_add_${memberId}`,
            metricDeltas: {
              admin_active_family_members_added: 1,
            },
          });
        }
        return {
          kind: "ok" as const,
          familyId,
          member: {
            id: memberId,
            name,
            email,
            role,
            status: isManagedLocalPlayer ? "active" : "invited",
          },
          invite,
        };
      });

    if (data.kind === "setup_already_complete") {
      return NextResponse.json(
        {
          error: "setup_already_complete",
          message: "This family already has children. Onboarding is complete.",
          redirectTarget: "dashboard",
        },
        { status: 409 },
      );
    }

    if (data.kind === "family_member_limit_reached") {
      return NextResponse.json(
        { error: "family_member_limit_reached", maxFamilyMembers: MAX_FAMILY_MEMBERS },
        { status: 409 },
      );
    }

    const response = NextResponse.json(
      { familyId: data.familyId, member: data.member, invite: data.invite },
      { status: 201 },
    );
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 160) : "unknown";
    console.error("[ADD_FAMILY_MEMBER_ERROR]", reason);
    if (
      reason.includes("FIRESTORE_HTTP_404") &&
      reason.toLowerCase().includes("database (default) does not exist")
    ) {
      return jsonFirestoreNotConfigured();
    }
    if (
      reason.includes("FIRESTORE_HTTP_401")
    ) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return jsonFirestoreForbidden();
    }
    return NextResponse.json({ error: "add_member_failed" }, { status: 500 });
  }
}

