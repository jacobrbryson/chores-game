import { randomUUID } from "node:crypto";
import {
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
    `users/${input.uid}/walletLedger/${randomUUID()}`,
    {
      uid: stringField(input.uid),
      reason: stringField(input.reason),
      delta: signedIntegerField(input.delta),
      balanceAfter: integerField(nextBalance),
      choreId: stringField(input.choreId ?? ""),
      itemId: stringField(input.itemId ?? ""),
      createdAt: timestampField(now),
    },
    input.idToken,
  );

  return nextBalance;
}
