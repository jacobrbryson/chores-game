import {
  boolField,
  createOrReplaceDocument,
  documentIdFromName,
  getDocument,
  integerField,
  listDocuments,
  readBoolean,
  readInteger,
  readString,
  readTimestamp,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { readGcsJson, uploadGcsJson } from "@/lib/gcs/storage";
import { validateQuestAgainstRules } from "@/lib/quests/quest-validation";
import { getQuestRules } from "@/lib/quests/rules";
import { validateQuestDefinition } from "@/lib/quests/validation";
import type { QuestDefinition } from "@/lib/quests/types";

export type FamilyQuestStatus = "draft" | "published";

export type FamilyQuestSummary = {
  id: string;
  familyId: string;
  title: string;
  subtitle: string;
  author: string;
  coverImage: string;
  summary: string;
  status: FamilyQuestStatus;
  score: number;
  issueCount: number;
  draftObjectPath: string;
  publishedObjectPath: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
};

const FAMILY_QUEST_LIMIT = 3;

function questDocPath(familyId: string, questId: string) {
  return `families/${familyId}/quests/${questId}`;
}

export function familyQuestObjectPrefix(familyId: string, status: FamilyQuestStatus, questId: string) {
  return `families/${familyId}/quests/${status === "published" ? "published" : "drafts"}/${questId}`;
}

export function toFamilyQuestId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function readSummaryFromFields(
  familyId: string,
  fields: Parameters<typeof readString>[0],
  fallbackId: string,
): FamilyQuestSummary {
  const status = readString(fields, "status") === "published" ? "published" : "draft";
  return {
    id: readString(fields, "id") || fallbackId,
    familyId,
    title: readString(fields, "title") || "Untitled Quest",
    subtitle: readString(fields, "subtitle"),
    author: readString(fields, "author"),
    coverImage: readString(fields, "coverImage"),
    summary: readString(fields, "summary"),
    status,
    score: readInteger(fields, "score"),
    issueCount: readInteger(fields, "issueCount"),
    draftObjectPath: readString(fields, "draftObjectPath"),
    publishedObjectPath: readString(fields, "publishedObjectPath"),
    createdAt: readTimestamp(fields, "createdAt"),
    updatedAt: readTimestamp(fields, "updatedAt"),
    publishedAt: readTimestamp(fields, "publishedAt") || undefined,
  };
}

function toFirestoreFields(input: {
  familyId: string;
  quest: QuestDefinition;
  status: FamilyQuestStatus;
  score: number;
  issueCount: number;
  draftObjectPath: string;
  publishedObjectPath: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}) {
  return {
    id: stringField(input.quest.id),
    familyId: stringField(input.familyId),
    title: stringField(input.quest.title),
    subtitle: stringField(input.quest.subtitle),
    author: stringField(input.quest.author),
    coverImage: stringField(input.quest.coverImage ?? ""),
    summary: stringField(input.quest.summary),
    status: stringField(input.status),
    score: integerField(input.score),
    issueCount: integerField(input.issueCount),
    draftObjectPath: stringField(input.draftObjectPath),
    publishedObjectPath: stringField(input.publishedObjectPath),
    createdAt: timestampField(input.createdAt),
    updatedAt: timestampField(input.updatedAt),
    publishedAt: input.publishedAt ? timestampField(input.publishedAt) : timestampField("1970-01-01T00:00:00.000Z"),
    deleted: boolField(false),
  };
}

export async function scoreQuest(quest: QuestDefinition) {
  const rules = await getQuestRules();
  const issues = validateQuestAgainstRules(quest, rules);
  return {
    score: Math.max(0, 100 - issues.length * 12),
    issues,
  };
}

export async function listFamilyQuests(familyId: string, idToken: string) {
  const docs = await listDocuments(`families/${familyId}/quests`, idToken, FAMILY_QUEST_LIMIT);
  return docs
    .filter((doc) => !readBoolean(doc.fields, "deleted"))
    .map((doc) => readSummaryFromFields(familyId, doc.fields, documentIdFromName(doc.name)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listPublishedFamilyQuestDefinitions(familyId: string, idToken: string) {
  const quests = await listFamilyQuests(familyId, idToken);
  const definitions: QuestDefinition[] = [];
  for (const quest of quests.filter((entry) => entry.status === "published")) {
    const loaded = await getFamilyQuestDefinition(familyId, quest.id, idToken, "published");
    if (loaded) {
      definitions.push(loaded);
    }
  }
  return definitions;
}

export async function getFamilyQuestSummary(familyId: string, questId: string, idToken: string) {
  const safeQuestId = toFamilyQuestId(questId);
  if (!safeQuestId) {
    return null;
  }
  try {
    const doc = await getDocument(questDocPath(familyId, safeQuestId), idToken);
    if (readBoolean(doc.fields, "deleted")) {
      return null;
    }
    return readSummaryFromFields(familyId, doc.fields, safeQuestId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return null;
    }
    throw error;
  }
}

export async function getFamilyQuestDefinition(
  familyId: string,
  questId: string,
  idToken: string,
  preferredStatus?: FamilyQuestStatus,
) {
  const summary = await getFamilyQuestSummary(familyId, questId, idToken);
  if (!summary) {
    return null;
  }
  const objectPath =
    preferredStatus === "published" || summary.status === "published"
      ? summary.publishedObjectPath
      : summary.draftObjectPath;
  if (!objectPath) {
    return null;
  }
  return validateQuestDefinition(await readGcsJson(objectPath));
}

export async function saveFamilyQuest(input: {
  familyId: string;
  quest: QuestDefinition;
  idToken: string;
  publish: boolean;
}) {
  const quest = validateQuestDefinition(input.quest);
  const nowIso = new Date().toISOString();
  const existing = await getFamilyQuestSummary(input.familyId, quest.id, input.idToken);
  const createdAt = existing?.createdAt || nowIso;
  const draftObjectPath = `${familyQuestObjectPrefix(input.familyId, "draft", quest.id)}/quest.json`;
  const publishedObjectPath = `${familyQuestObjectPrefix(input.familyId, "published", quest.id)}/quest.json`;
  const validation = await scoreQuest(quest);

  await uploadGcsJson(draftObjectPath, quest);
  if (input.publish) {
    await uploadGcsJson(publishedObjectPath, quest);
  }

  const status: FamilyQuestStatus = input.publish ? "published" : (existing?.status ?? "draft");
  await createOrReplaceDocument(
    questDocPath(input.familyId, quest.id),
    toFirestoreFields({
      familyId: input.familyId,
      quest,
      status,
      score: validation.score,
      issueCount: validation.issues.length,
      draftObjectPath,
      publishedObjectPath: input.publish ? publishedObjectPath : existing?.publishedObjectPath ?? "",
      createdAt,
      updatedAt: nowIso,
      publishedAt: input.publish ? nowIso : existing?.publishedAt,
    }),
    input.idToken,
  );

  return {
    summary: await getFamilyQuestSummary(input.familyId, quest.id, input.idToken),
    validation,
  };
}

export { FAMILY_QUEST_LIMIT };
