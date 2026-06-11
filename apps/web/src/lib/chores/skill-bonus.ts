import {
  commitWrites,
  type FirestoreValue,
  getDocument,
  listAllDocuments,
  readBoolean,
  readString,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";

// New Skill Bonus: a child earns a one-time bonus the first time they ever
// complete a given chore (by canonical/root identity). The award is idempotent
// per child per chore — a durable claim record in
// `families/{familyId}/skillBonuses/{playerUid__rootChoreId}` is created with a
// document-does-not-exist precondition so concurrent completions, websocket
// replays, and double-approvals cannot double-award.
export const NEW_SKILL_BONUS_AMOUNT = 5;

// Classification: FAMILY_PRIVATE / CHILD_SENSITIVE (per-child completion history).
const SKILL_BONUS_COLLECTION = "skillBonuses";
const MAX_SKILL_BONUS_SCAN = 20000;

function sanitizeIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_.@-]/g, "_");
}

// The bonus is granted once per *recurring chore series*, not per spawned
// occurrence. Recurring completions spawn a fresh chore doc whose
// `recurrenceRootChoreId` points back at the very first chore in the series
// (with `recurrenceParentChoreId` as a one-level fallback for chores created
// before root propagation existed). Non-recurring chores are their own root.
export function canonicalRecurringChoreId(
  fields: Record<string, FirestoreValue> | undefined,
  choreId: string,
) {
  return (
    readString(fields, "recurrenceRootChoreId") ||
    readString(fields, "recurrenceParentChoreId") ||
    choreId
  );
}

export function skillBonusDocId(playerUid: string, rootChoreId: string) {
  return `${sanitizeIdPart(playerUid)}__${sanitizeIdPart(rootChoreId)}`;
}

export function skillBonusEligibilityKey(playerUid: string, rootChoreId: string) {
  return skillBonusDocId(playerUid, rootChoreId);
}

export type ClaimSkillBonusResult = {
  // True only when this call created the claim record (i.e. genuinely the first
  // time this child completed this chore). False when the claim already existed
  // or could not be safely created.
  firstTime: boolean;
};

function isAlreadyExists(reason: string) {
  return (
    reason.includes("ALREADY_EXISTS") ||
    reason.includes("already exists") ||
    reason.includes("FAILED_PRECONDITION")
  );
}

// Attempts to claim the one-time New Skill Bonus for a child completing a chore.
// Returns `firstTime: true` only when the claim record was newly created. Any
// pre-existing record (or a precondition failure from a concurrent writer)
// resolves to `firstTime: false` so the bonus is never paid twice. Unexpected
// errors also resolve to `false` — we would rather skip a bonus than double-pay.
export async function claimNewSkillBonus(input: {
  familyId: string;
  playerUid: string;
  rootChoreId: string;
  sourceCompletionId: string;
  idToken: string;
}): Promise<ClaimSkillBonusResult> {
  const { familyId, playerUid, rootChoreId, sourceCompletionId, idToken } = input;
  if (!familyId || !playerUid || !rootChoreId) {
    return { firstTime: false };
  }
  const docId = skillBonusDocId(playerUid, rootChoreId);
  const now = new Date().toISOString();
  try {
    await commitWrites(
      [
        {
          update: {
            path: `families/${familyId}/${SKILL_BONUS_COLLECTION}/${docId}`,
            fields: {
              playerId: stringField(playerUid),
              rootChoreId: stringField(rootChoreId),
              sourceCompletionId: stringField(sourceCompletionId),
              firstCompletedAt: timestampField(now),
            },
            currentDocument: { exists: false },
          },
        },
      ],
      idToken,
    );
    return { firstTime: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (isAlreadyExists(reason)) {
      return { firstTime: false };
    }
    console.error("[NEW_SKILL_BONUS_CLAIM_ERROR]", {
      familyId,
      playerUid,
      rootChoreId,
      reason: reason.slice(0, 200),
    });
    return { firstTime: false };
  }
}

// Returns whether a child has already earned the New Skill Bonus for a chore
// identity. Used as a non-mutating read (e.g. dashboard eligibility) — falls
// back to "already claimed" on read errors so the UI never over-promises.
export async function hasClaimedSkillBonus(input: {
  familyId: string;
  playerUid: string;
  rootChoreId: string;
  idToken: string;
}): Promise<boolean> {
  const { familyId, playerUid, rootChoreId, idToken } = input;
  if (!familyId || !playerUid || !rootChoreId) {
    return true;
  }
  const docId = skillBonusDocId(playerUid, rootChoreId);
  try {
    await getDocument(`families/${familyId}/${SKILL_BONUS_COLLECTION}/${docId}`, idToken);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return false;
    }
    return true;
  }
}

// Loads every claimed `{playerUid}__{rootChoreId}` key for the family so a list
// view can compute per-child eligibility without an extra read per row.
export async function loadClaimedSkillBonusKeys(
  familyId: string,
  idToken: string,
): Promise<Set<string>> {
  const keys = new Set<string>();
  if (!familyId) {
    return keys;
  }
  try {
    const docs = await listAllDocuments(
      `families/${familyId}/${SKILL_BONUS_COLLECTION}`,
      idToken,
      { cap: MAX_SKILL_BONUS_SCAN },
    );
    for (const doc of docs) {
      if (readBoolean(doc.fields, "deleted")) {
        continue;
      }
      const playerId = readString(doc.fields, "playerId");
      const rootChoreId = readString(doc.fields, "rootChoreId");
      if (playerId && rootChoreId) {
        keys.add(skillBonusEligibilityKey(playerId, rootChoreId));
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      console.error("[NEW_SKILL_BONUS_LOAD_ERROR]", reason.slice(0, 200));
    }
  }
  return keys;
}
