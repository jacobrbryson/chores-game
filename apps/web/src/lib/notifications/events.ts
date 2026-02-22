import { randomUUID } from "node:crypto";
import {
  createOrReplaceDocument,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";

type ActivityKind =
  | "chore_created"
  | "chore_edited"
  | "chore_deleted"
  | "chore_completed"
  | "chore_undo_completed";

type EmitFamilyActivityInput = {
  familyId: string;
  idToken: string;
  kind: ActivityKind;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  title: string;
  message: string;
  choreId?: string;
  choreTitle?: string;
  relatedIds?: string[];
};

function normalizeId(value: string) {
  return value.trim().toLowerCase();
}

function uniqueRelatedIds(values: string[]) {
  const normalized = values
    .map((entry) => normalizeId(entry))
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(normalized));
}

export async function emitFamilyActivity(input: EmitFamilyActivityInput) {
  const now = new Date().toISOString();
  const relatedIds = uniqueRelatedIds([
    input.actorUid,
    input.actorEmail,
    ...(input.relatedIds ?? []),
  ]);

  await createOrReplaceDocument(
    `families/${input.familyId}/notifications/${randomUUID()}`,
    {
      familyId: stringField(input.familyId),
      kind: stringField(input.kind),
      actorUid: stringField(input.actorUid),
      actorEmail: stringField(input.actorEmail),
      actorName: stringField(input.actorName),
      title: stringField(input.title.slice(0, 180)),
      message: stringField(input.message.slice(0, 600)),
      choreId: stringField(input.choreId ?? ""),
      choreTitle: stringField(input.choreTitle ?? ""),
      relatedIds: stringArrayField(relatedIds),
      createdAt: timestampField(now),
    },
    input.idToken,
  );
}
