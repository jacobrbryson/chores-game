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
    | "store_purchase"
    | "manual_adjustment";
  choreId?: string;
  itemId?: string;
};

function ledgerEntryId(input: ApplyWalletDeltaInput) {
  if ((input.reason === "chore_complete" || input.reason === "chore_undo_complete") && input.choreId) {
    return `${input.reason}_${input.choreId}`;
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
  const currentBalance = await getWalletBalance(input.uid, input.idToken);
  const nextBalance = currentBalance + input.delta;
  if (nextBalance < 0) {
    throw new Error("WALLET_NEGATIVE_BLOCKED");
  }

  await patchDocument(
    `users/${input.uid}`,
    {
      walletBalance: integerField(nextBalance),
      walletUpdatedAt: timestampField(now),
    },
    input.idToken,
    ["walletBalance", "walletUpdatedAt"],
  );

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
      createdAt: timestampField(now),
    },
    input.idToken,
  );

  return nextBalance;
}
