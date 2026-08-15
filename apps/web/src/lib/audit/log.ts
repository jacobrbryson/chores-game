import { randomUUID } from "node:crypto";
import { adminCreateOrReplaceDocument } from "@/lib/firestore/admin";
import {
  createOrReplaceDocument,
  mapField,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";

export type AuditActor = {
  uid?: string;
  email?: string;
  name?: string;
  role?: "admin" | "player" | "system" | string;
};

type AuditLogFields = {
  familyId: string;
  eventType: string;
  actor?: AuditActor;
  userId?: string;
  choreId?: string;
  choreTitle?: string;
  source?: string;
  previous?: Record<string, string | number | boolean | undefined>;
  next?: Record<string, string | number | boolean | undefined>;
  reason?: string;
  requestId?: string;
};

type AuditLogInput = AuditLogFields & { idToken: string };

function primitiveField(value: string | number | boolean | undefined): FirestoreValue {
  if (typeof value === "number") {
    return { integerValue: String(Math.trunc(value)) };
  }
  if (typeof value === "boolean") {
    return { booleanValue: value };
  }
  return stringField(value ?? "");
}

function objectMapField(value: Record<string, string | number | boolean | undefined> = {}) {
  return mapField(
    Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, primitiveField(entry)]),
    ),
  );
}

function auditLogPath(familyId: string, now: string) {
  return `families/${familyId}/auditLogs/${now.replace(/[^0-9]/g, "")}_${randomUUID()}`;
}

function auditLogFields(input: AuditLogFields, now: string) {
  return {
    familyId: stringField(input.familyId),
      eventType: stringField(input.eventType),
      actorUid: stringField(input.actor?.uid ?? ""),
      actorEmail: stringField(input.actor?.email ?? ""),
      actorName: stringField(input.actor?.name ?? ""),
      actorRole: stringField(input.actor?.role ?? ""),
      userId: stringField(input.userId ?? ""),
      choreId: stringField(input.choreId ?? ""),
      choreTitle: stringField(input.choreTitle ?? ""),
      source: stringField(input.source ?? ""),
      reason: stringField(input.reason ?? ""),
      requestId: stringField(input.requestId ?? ""),
    previous: objectMapField(input.previous),
    next: objectMapField(input.next),
    createdAt: timestampField(now),
  };
}

export async function writeAuditLog(input: AuditLogInput) {
  if (!input.familyId || !input.eventType) {
    return;
  }
  const now = new Date().toISOString();
  await createOrReplaceDocument(
    auditLogPath(input.familyId, now),
    auditLogFields(input, now),
    input.idToken,
  );
}

/**
 * Audit writer for actions taken by someone who is not yet a member of the
 * family — notably invite redemption, where the actor has no membership a
 * user-scoped token could be authorized against. Same record shape; only the
 * credential differs.
 */
export async function writeAdminAuditLog(input: AuditLogFields) {
  if (!input.familyId || !input.eventType) {
    return;
  }
  const now = new Date().toISOString();
  await adminCreateOrReplaceDocument(
    auditLogPath(input.familyId, now),
    auditLogFields(input, now),
  );
}

function warnAuditSkipped(input: AuditLogFields, error: unknown) {
  const reason = error instanceof Error ? error.message : "unknown";
  console.warn("[AUDIT_LOG_WRITE_SKIPPED]", {
    familyId: input.familyId,
    eventType: input.eventType,
    choreId: input.choreId ?? "",
    userId: input.userId ?? "",
    reason: reason.slice(0, 180),
  });
}

export async function writeAuditLogBestEffort(input: AuditLogInput) {
  try {
    await writeAuditLog(input);
  } catch (error) {
    warnAuditSkipped(input, error);
  }
}

export async function writeAdminAuditLogBestEffort(input: AuditLogFields) {
  try {
    await writeAdminAuditLog(input);
  } catch (error) {
    warnAuditSkipped(input, error);
  }
}
