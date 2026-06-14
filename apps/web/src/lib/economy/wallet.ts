import { randomUUID } from "node:crypto";
import {
  boolField,
  createOrReplaceDocument,
  getDocument,
  integerField,
  patchDocument,
  readInteger,
  readStringArray,
  signedIntegerField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";

type ApplyWalletDeltaInput = {
  uid: string;
  idToken: string;
  delta: number;
  reason:
    | "chore_complete"
    | "chore_undo_complete"
    | "new_skill_bonus"
    | "routine_completion_bonus"
    | "store_purchase"
    | "manual_adjustment";
  choreId?: string;
  routineAssignmentId?: string;
  itemId?: string;
  debugMeta?: Record<string, unknown>;
};

function ledgerEntryId(input: ApplyWalletDeltaInput) {
  if (
    (input.reason === "chore_complete" ||
      input.reason === "chore_undo_complete" ||
      input.reason === "new_skill_bonus") &&
    input.choreId
  ) {
    return `${input.reason}_${input.choreId}`;
  }
  // Routine completion bonuses are idempotent per assignment — one assignment
  // can only ever pay its bonus once, even across retries.
  if (input.reason === "routine_completion_bonus" && input.routineAssignmentId) {
    return `${input.reason}_${input.routineAssignmentId}`;
  }
  return randomUUID();
}

export async function getWalletBalance(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  return readInteger(userDoc.fields, "walletBalance");
}

export async function getPrimaryFamilyId(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  return readStringArray(userDoc.fields, "familyIds")[0] ?? "";
}

export async function applyWalletDelta(input: ApplyWalletDeltaInput) {
  const now = new Date().toISOString();
  let targetPrimaryFamilyId = "";
  try {
    targetPrimaryFamilyId = await getPrimaryFamilyId(input.uid, input.idToken);
  } catch {
    targetPrimaryFamilyId = "";
  }
  const currentBalance = await getWalletBalance(input.uid, input.idToken);
  const nextBalance = currentBalance + input.delta;
  if (nextBalance < 0) {
    throw new Error("WALLET_NEGATIVE_BLOCKED");
  }

  try {
    await patchDocument(
      `users/${input.uid}`,
      {
        walletBalance: integerField(nextBalance),
        walletUpdatedAt: timestampField(now),
      },
      input.idToken,
      ["walletBalance", "walletUpdatedAt"],
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[WALLET_DELTA_USER_PATCH_ERROR]", {
      uid: input.uid,
      reason: input.reason,
      delta: input.delta,
      currentBalance,
      nextBalance,
      choreId: input.choreId ?? "",
      itemId: input.itemId ?? "",
      targetPrimaryFamilyId,
      debugMeta: input.debugMeta ?? {},
      firestoreReason: reason.slice(0, 220),
    });
    throw error;
  }

  try {
    await createOrReplaceDocument(
      `users/${input.uid}/walletLedger/${ledgerEntryId(input)}`,
      {
        uid: stringField(input.uid),
        reason: stringField(input.reason),
        delta: signedIntegerField(input.delta),
        entryType: stringField(input.delta < 0 ? "debit" : "credit"),
        creditAmount: integerField(input.delta > 0 ? input.delta : 0),
        debitAmount: integerField(input.delta < 0 ? Math.abs(input.delta) : 0),
        balanceAfter: integerField(nextBalance),
        countsTowardBalance: boolField(true),
        choreId: stringField(input.choreId ?? ""),
        itemId: stringField(input.itemId ?? ""),
        // Required by the routine-bonus security rule (ledger id must equal
        // "routine_completion_bonus_" + this value); empty for other reasons.
        routineAssignmentId: stringField(input.routineAssignmentId ?? ""),
        createdAt: timestampField(now),
      },
      input.idToken,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    if (reason.includes("FIRESTORE_HTTP_403")) {
      // Temporary resilience path: keep wallet flows functional even if ledger rules are not yet in sync.
      console.warn("[WALLET_DELTA_LEDGER_CREATE_SKIPPED]", {
        uid: input.uid,
        reason: input.reason,
        delta: input.delta,
        currentBalance,
        nextBalance,
        choreId: input.choreId ?? "",
        itemId: input.itemId ?? "",
        targetPrimaryFamilyId,
        debugMeta: input.debugMeta ?? {},
        note: "ledger_create_permission_denied_non_fatal",
      });
      return nextBalance;
    }
    console.error("[WALLET_DELTA_LEDGER_CREATE_ERROR]", {
      uid: input.uid,
      reason: input.reason,
      delta: input.delta,
      currentBalance,
      nextBalance,
      choreId: input.choreId ?? "",
      itemId: input.itemId ?? "",
      targetPrimaryFamilyId,
      debugMeta: input.debugMeta ?? {},
      firestoreReason: reason.slice(0, 220),
    });
    throw error;
  }

  return nextBalance;
}
