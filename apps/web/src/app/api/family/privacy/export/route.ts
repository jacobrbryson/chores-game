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
import {
  documentIdFromName,
  fieldsToPlainObject,
  getDocument,
  listAllDocuments,
  listDocuments,
  readBoolean,
  readString,
  type FirestoreDocument,
} from "@/lib/firestore/rest";
import {
  EXPORT_MANIFEST_NOTES,
  sanitizeAchievementForExport,
  sanitizeChoreForExport,
  sanitizeFamilyForExport,
  sanitizeFeedItemForExport,
  sanitizeInventoryForExport,
  sanitizeInviteForExport,
  sanitizeMemberForExport,
  sanitizeQuestProgressForExport,
  sanitizeRewardForExport,
} from "@/lib/privacy/export-sanitizers";
import { PRIVACY_AUDIT_EVENTS } from "@/lib/privacy/types";

export const dynamic = "force-dynamic";

// Converts a raw Firestore doc into a plain object with its document ID, then
// passes it through the caller-supplied sanitizer.
function toSanitizedRecord(
  doc: FirestoreDocument,
  sanitize: (r: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  return sanitize({
    id: documentIdFromName(doc.name),
    ...fieldsToPlainObject(doc.fields),
  });
}

async function listSanitizedRecords(
  path: string,
  idToken: string,
  sanitize: (r: Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  try {
    const docs = await listAllDocuments(path, idToken, { cap: 5000 });
    return docs.map((doc) => toSanitizedRecord(doc, sanitize));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return [];
    }
    // Best-effort: a single inaccessible subcollection should not fail the
    // whole export.
    return [];
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
          return { kind: "forbidden" as const };
        }

        const familyDoc = await getDocument(`families/${familyId}`, idToken);
        const allMemberDocs = await listDocuments(
          `families/${familyId}/members`,
          idToken,
          100,
        );

        // Separate non-deleted docs into active members vs pending invites.
        const nonDeleted = allMemberDocs.filter(
          (doc) => !readBoolean(doc.fields, "deleted"),
        );
        const activeMemberDocs = nonDeleted.filter(
          (doc) => readString(doc.fields, "status") !== "invited",
        );
        const inviteDocs = nonDeleted.filter(
          (doc) => readString(doc.fields, "status") === "invited",
        );

        // Detect stale invite orphans — invite docs left behind after the person
        // accepted. Identity is uid-keyed since the email-keying migration: this
        // used to match on the `email` field, which exported the wrong records
        // for anyone whose address was an Apple private relay, and could merge
        // two people who happened to share an address.
        const activeMemberIds = new Set<string>();
        for (const doc of activeMemberDocs) {
          const memberId = documentIdFromName(doc.name);
          if (memberId) activeMemberIds.add(memberId);
          const uid = readString(doc.fields, "uid");
          if (uid) activeMemberIds.add(uid);
        }
        const activeInviteDocs = inviteDocs.filter((doc) => {
          const uid = readString(doc.fields, "uid");
          const memberId = documentIdFromName(doc.name);
          return !(uid && activeMemberIds.has(uid)) && !activeMemberIds.has(memberId);
        });

        const memberUids = activeMemberDocs
          .map((doc) => readString(doc.fields, "uid"))
          .filter((uid) => uid.length > 0);

        const [chores, rewards, feed] = await Promise.all([
          listSanitizedRecords(`families/${familyId}/chores`, idToken, sanitizeChoreForExport),
          listSanitizedRecords(`families/${familyId}/rewards`, idToken, sanitizeRewardForExport),
          listSanitizedRecords(
            `families/${familyId}/notifications`,
            idToken,
            sanitizeFeedItemForExport,
          ),
        ]);

        // Per-member personal sub-records (best-effort, family members only).
        const achievements: Record<string, unknown>[] = [];
        const quests: Record<string, unknown>[] = [];
        const inventory: Record<string, unknown>[] = [];
        await Promise.all(
          memberUids.map(async (uid) => {
            const [memberAchievements, memberQuests, memberInventory] = await Promise.all([
              listSanitizedRecords(
                `users/${uid}/achievements`,
                idToken,
                sanitizeAchievementForExport,
              ),
              listSanitizedRecords(
                `users/${uid}/questProgress`,
                idToken,
                sanitizeQuestProgressForExport,
              ),
              listSanitizedRecords(
                `users/${uid}/inventory`,
                idToken,
                sanitizeInventoryForExport,
              ),
            ]);
            for (const record of memberAchievements) {
              achievements.push({ uid, ...record });
            }
            for (const record of memberQuests) {
              quests.push({ uid, ...record });
            }
            for (const record of memberInventory) {
              inventory.push({ uid, ...record });
            }
          }),
        );

        const exportPayload = {
          manifest: {
            exportedAt: new Date().toISOString(),
            exportVersion: "1",
            notes: EXPORT_MANIFEST_NOTES,
          },
          "family.json": sanitizeFamilyForExport({
            id: familyId,
            ...fieldsToPlainObject(familyDoc.fields),
          }),
          "members.json": activeMemberDocs.map((doc) =>
            toSanitizedRecord(doc, sanitizeMemberForExport),
          ),
          "invites.json": activeInviteDocs.map((doc) =>
            toSanitizedRecord(doc, sanitizeInviteForExport),
          ),
          "chores.json": chores,
          "rewards.json": rewards,
          "achievements.json": achievements,
          "quests.json": quests,
          "inventory.json": inventory,
          "feed.json": feed,
          // API tokens are stored server-side keyed by hash and are never
          // readable here; raw secret values are never exported.
          "api-tokens.json": [],
        };

        await writeAuditLogBestEffort({
          familyId,
          idToken,
          eventType: PRIVACY_AUDIT_EVENTS.dataExportRequested,
          source: "privacy",
          actor: {
            uid: session.uid,
            email: session.email,
            name: session.name,
            role: viewerRole,
          },
          next: {
            members: activeMemberDocs.length,
            pendingInvites: activeInviteDocs.length,
            chores: chores.length,
            rewards: rewards.length,
            feed: feed.length,
          },
        });

        return { kind: "ok" as const, familyId, exportPayload };
      });

    if (data.kind === "no_family") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }

    const filename = `family-data-${data.familyId}-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    const response = new NextResponse(JSON.stringify(data.exportPayload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_PRIVACY_EXPORT_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "export_family_data_failed");
  }
}
