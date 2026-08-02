import { randomUUID } from "node:crypto";
import { adminCreateOrReplaceDocument } from "@/lib/firestore/admin";
import { mapField, stringField, timestampField, type FirestoreValue } from "@/lib/firestore/rest";

type CrossFamilyAuditInput = {
  familyId: string;
  eventType: string;
  actor: { uid: string; email: string; name: string };
  requestId?: string;
  friendFamilyId: string;
};

function auditValue(value: string): FirestoreValue {
  return stringField(value);
}

export async function writeCrossFamilyAuditBestEffort(input: CrossFamilyAuditInput) {
  try {
    const now = new Date().toISOString();
    await adminCreateOrReplaceDocument(
      `families/${input.familyId}/auditLogs/${now.replace(/[^0-9]/g, "")}_${randomUUID()}`,
      {
        familyId: stringField(input.familyId),
        eventType: stringField(input.eventType),
        actorUid: stringField(input.actor.uid),
        actorEmail: stringField(input.actor.email),
        actorName: stringField(input.actor.name),
        actorRole: stringField("admin"),
        userId: stringField(""),
        choreId: stringField(""),
        choreTitle: stringField(""),
        source: stringField("family_friends"),
        reason: stringField(""),
        requestId: stringField(input.requestId ?? ""),
        previous: mapField({}),
        next: mapField({ friendFamilyId: auditValue(input.friendFamilyId) }),
        createdAt: timestampField(now),
      },
    );
  } catch (error) {
    console.warn("[CROSS_FAMILY_AUDIT_WRITE_SKIPPED]", {
      familyId: input.familyId,
      eventType: input.eventType,
      reason: error instanceof Error ? error.message.slice(0, 180) : "unknown",
    });
  }
}
