import { randomUUID } from "node:crypto";
import {
  createOrReplaceDocument,
  documentIdFromName,
  readString,
  readTimestamp,
  runQuery,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import type { ConsentEvent } from "@/lib/privacy/types";

type AppendConsentEventInput = {
  familyId: string;
  userId: string;
  eventType: string;
  documentType: string;
  documentVersion: string;
  ipAddress?: string;
  userAgent?: string;
};

export async function appendConsentEvent(
  input: AppendConsentEventInput,
  idToken: string,
): Promise<void> {
  const now = new Date().toISOString();
  const id = `${now.replace(/[^0-9]/g, "")}_${randomUUID()}`;
  await createOrReplaceDocument(
    `families/${input.familyId}/consentEvents/${id}`,
    {
      familyId: stringField(input.familyId),
      userId: stringField(input.userId),
      eventType: stringField(input.eventType),
      documentType: stringField(input.documentType),
      documentVersion: stringField(input.documentVersion),
      acceptedAt: timestampField(now),
      ipAddress: stringField(input.ipAddress ?? ""),
      userAgent: stringField(input.userAgent ?? ""),
      createdAt: timestampField(now),
    },
    idToken,
  );
}

// Best-effort append that logs a warning on failure instead of throwing.
// Consent event writes must never abort the parent consent transaction.
export async function appendConsentEventBestEffort(
  input: AppendConsentEventInput,
  idToken: string,
): Promise<void> {
  try {
    await appendConsentEvent(input, idToken);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.warn("[CONSENT_EVENT_WRITE_SKIPPED]", {
      familyId: input.familyId,
      eventType: input.eventType,
      documentType: input.documentType,
      reason: reason.slice(0, 180),
    });
  }
}

export async function listConsentEvents(
  familyId: string,
  idToken: string,
  limit = 20,
): Promise<ConsentEvent[]> {
  const docs = await runQuery(
    {
      from: [{ collectionId: "consentEvents" }],
      orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
      limit,
    },
    idToken,
    `families/${familyId}`,
  );
  return docs.map((doc) => ({
    id: documentIdFromName(doc.name),
    familyId: readString(doc.fields, "familyId"),
    userId: readString(doc.fields, "userId"),
    eventType: readString(doc.fields, "eventType"),
    documentType: readString(doc.fields, "documentType"),
    documentVersion: readString(doc.fields, "documentVersion"),
    acceptedAt: readTimestamp(doc.fields, "acceptedAt"),
    ipAddress: readString(doc.fields, "ipAddress"),
    userAgent: readString(doc.fields, "userAgent"),
    createdAt: readTimestamp(doc.fields, "createdAt"),
  }));
}
