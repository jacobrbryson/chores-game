import { randomUUID } from "node:crypto";
import { DEFAULT_LOCALE, normalizeLocale } from "@packages/locales";
import {
  adminCreateOrReplaceDocument,
  adminGetDocument,
  adminListDocuments,
  adminPatchDocument,
} from "@/lib/firestore/admin";
import {
  documentIdFromName,
  fieldsToPlainObject,
  integerField,
  mapField,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  stringArrayField,
  stringField,
  timestampField,
  type FirestoreDocument,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import {
  EDITABLE_PUBLIC_CONTENT_TYPES,
  PUBLIC_CONTENT_STATUSES,
  PUBLIC_CONTENT_TYPES,
  type PublicContentInput,
  type PublicContentListQuery,
  type PublicContentPublicRecord,
  type PublicContentRecord,
  type PublicContentSeoIssue,
  type PublicContentStatus,
  type PublicContentType,
} from "./types";

const COLLECTION = "publicContent";
const MAX_LIST_LIMIT = 100;
const REVIEW_STALE_DAYS = 180;

type Actor = { uid: string; email?: string; name?: string };

export function isPublicContentType(value: unknown): value is PublicContentType {
  return PUBLIC_CONTENT_TYPES.includes(value as PublicContentType);
}

export function isEditablePublicContentType(value: unknown) {
  return EDITABLE_PUBLIC_CONTENT_TYPES.includes(value as (typeof EDITABLE_PUBLIC_CONTENT_TYPES)[number]);
}

export function isPublicContentStatus(value: unknown): value is PublicContentStatus {
  return PUBLIC_CONTENT_STATUSES.includes(value as PublicContentStatus);
}

export function slugifyPublicContentTitle(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function isValidPublicContentSlug(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 96;
}

export function canonicalPathForContent(type: PublicContentType, slug: string) {
  if (type === "chore") return `/chores/${slug}`;
  if (type === "reward") return `/rewards/${slug}`;
  return `/resources/${slug}`;
}

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function list(value: unknown, maxItems = 20) {
  if (Array.isArray(value)) {
    return value.map((entry) => text(entry, 64)).filter(Boolean).slice(0, maxItems);
  }
  return text(value, 500)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_]{1,48}$/.test(key)) continue;
    if (typeof entry === "string") allowed[key] = text(entry, 500);
    if (typeof entry === "number" && Number.isFinite(entry)) allowed[key] = entry;
    if (typeof entry === "boolean") allowed[key] = entry;
  }
  return allowed;
}

function primitiveToField(value: unknown): FirestoreValue {
  if (typeof value === "number") return integerField(value);
  if (typeof value === "boolean") return { booleanValue: value };
  return stringField(typeof value === "string" ? value : "");
}

function metadataField(value: Record<string, unknown>) {
  return mapField(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, primitiveToField(entry)])));
}

function normalizeInput(input: PublicContentInput, existing?: PublicContentRecord) {
  const type = input.type ?? existing?.type ?? "guide";
  if (!isPublicContentType(type)) return { ok: false as const, error: "invalid_type" };
  if (!existing && !isEditablePublicContentType(type)) return { ok: false as const, error: "type_not_creatable" };
  if (existing && input.type && input.type !== existing.type) return { ok: false as const, error: "type_immutable" };

  const title = text(input.title ?? existing?.title ?? "", 160);
  const slug = text(input.slug ?? existing?.slug ?? slugifyPublicContentTitle(title), 96);
  if (!title) return { ok: false as const, error: "title_required" };
  if (!isValidPublicContentSlug(slug)) return { ok: false as const, error: "slug_invalid" };

  return {
    ok: true as const,
    value: {
      type,
      slug,
      title,
      shortDescription: text(input.shortDescription ?? existing?.shortDescription ?? "", 500),
      body: text(input.body ?? existing?.body ?? "", 20_000),
      category: text(input.category ?? existing?.category ?? "", 80),
      tags: list(input.tags ?? existing?.tags ?? []),
      ageRange: text(input.ageRange ?? existing?.ageRange ?? "", 40),
      difficulty: text(input.difficulty ?? existing?.difficulty ?? "", 40),
      estimatedMinutes: Math.max(0, Math.floor(Number(input.estimatedMinutes ?? existing?.estimatedMinutes ?? 0) || 0)),
      image: text(input.image ?? existing?.image ?? "", 300),
      seoTitle: text(input.seoTitle ?? existing?.seoTitle ?? "", 160),
      seoDescription: text(input.seoDescription ?? existing?.seoDescription ?? "", 320),
      seoKeywords: list(input.seoKeywords ?? existing?.seoKeywords ?? []),
      ogImage: text(input.ogImage ?? existing?.ogImage ?? "", 300),
      canonicalPath: canonicalPathForContent(type, slug),
      locale: normalizeLocale(input.locale ?? existing?.locale ?? DEFAULT_LOCALE) ?? DEFAULT_LOCALE,
      sourceType: text(input.sourceType ?? existing?.sourceType ?? "", 80),
      sourceId: text(input.sourceId ?? existing?.sourceId ?? "", 160),
      metadata: safeMetadata(input.metadata ?? existing?.metadata ?? {}),
    },
  };
}

function recordToFields(record: PublicContentRecord): Record<string, FirestoreValue> {
  return {
    id: stringField(record.id),
    type: stringField(record.type),
    status: stringField(record.status),
    slug: stringField(record.slug),
    title: stringField(record.title),
    shortDescription: stringField(record.shortDescription),
    body: stringField(record.body),
    category: stringField(record.category),
    tags: stringArrayField(record.tags),
    ageRange: stringField(record.ageRange),
    difficulty: stringField(record.difficulty),
    estimatedMinutes: integerField(record.estimatedMinutes),
    image: stringField(record.image),
    seoTitle: stringField(record.seoTitle),
    seoDescription: stringField(record.seoDescription),
    seoKeywords: stringArrayField(record.seoKeywords),
    ogImage: stringField(record.ogImage),
    canonicalPath: stringField(record.canonicalPath),
    locale: stringField(record.locale),
    sourceType: stringField(record.sourceType),
    sourceId: stringField(record.sourceId),
    createdByUid: stringField(record.createdByUid),
    createdAt: timestampField(record.createdAt),
    updatedByUid: stringField(record.updatedByUid),
    updatedAt: timestampField(record.updatedAt),
    approvedByUid: stringField(record.approvedByUid),
    approvedAt: record.approvedAt ? timestampField(record.approvedAt) : stringField(""),
    publishedByUid: stringField(record.publishedByUid),
    publishedAt: record.publishedAt ? timestampField(record.publishedAt) : stringField(""),
    archivedByUid: stringField(record.archivedByUid),
    archivedAt: record.archivedAt ? timestampField(record.archivedAt) : stringField(""),
    lastReviewedAt: record.lastReviewedAt ? timestampField(record.lastReviewedAt) : stringField(""),
    voteCount: integerField(record.voteCount),
    helpfulCount: integerField(record.helpfulCount),
    reportCount: integerField(record.reportCount),
    copyCount: integerField(record.copyCount),
    metadata: metadataField(record.metadata),
  };
}

export function normalizePublicContentDocument(doc: FirestoreDocument): PublicContentRecord {
  const type = readString(doc.fields, "type");
  const status = readString(doc.fields, "status");
  const locale = normalizeLocale(readString(doc.fields, "locale")) ?? DEFAULT_LOCALE;
  const metadata = doc.fields?.metadata ? fieldsToPlainObject({ metadata: doc.fields.metadata }).metadata : {};
  return {
    id: readString(doc.fields, "id") || documentIdFromName(doc.name),
    type: isPublicContentType(type) ? type : "guide",
    status: isPublicContentStatus(status) ? status : "draft",
    slug: readString(doc.fields, "slug"),
    title: readString(doc.fields, "title"),
    shortDescription: readString(doc.fields, "shortDescription"),
    body: readString(doc.fields, "body"),
    category: readString(doc.fields, "category"),
    tags: readStringArray(doc.fields, "tags"),
    ageRange: readString(doc.fields, "ageRange"),
    difficulty: readString(doc.fields, "difficulty"),
    estimatedMinutes: readInteger(doc.fields, "estimatedMinutes"),
    image: readString(doc.fields, "image"),
    seoTitle: readString(doc.fields, "seoTitle"),
    seoDescription: readString(doc.fields, "seoDescription"),
    seoKeywords: readStringArray(doc.fields, "seoKeywords"),
    ogImage: readString(doc.fields, "ogImage"),
    canonicalPath: readString(doc.fields, "canonicalPath"),
    locale,
    sourceType: readString(doc.fields, "sourceType"),
    sourceId: readString(doc.fields, "sourceId"),
    createdByUid: readString(doc.fields, "createdByUid"),
    createdAt: readTimestamp(doc.fields, "createdAt"),
    updatedByUid: readString(doc.fields, "updatedByUid"),
    updatedAt: readTimestamp(doc.fields, "updatedAt"),
    approvedByUid: readString(doc.fields, "approvedByUid"),
    approvedAt: readTimestamp(doc.fields, "approvedAt"),
    publishedByUid: readString(doc.fields, "publishedByUid"),
    publishedAt: readTimestamp(doc.fields, "publishedAt"),
    archivedByUid: readString(doc.fields, "archivedByUid"),
    archivedAt: readTimestamp(doc.fields, "archivedAt"),
    lastReviewedAt: readTimestamp(doc.fields, "lastReviewedAt"),
    voteCount: readInteger(doc.fields, "voteCount"),
    helpfulCount: readInteger(doc.fields, "helpfulCount"),
    reportCount: readInteger(doc.fields, "reportCount"),
    copyCount: readInteger(doc.fields, "copyCount"),
    metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {},
  };
}

export function toPublicContent(record: PublicContentRecord): PublicContentPublicRecord {
  return {
    type: record.type,
    slug: record.slug,
    title: record.title,
    shortDescription: record.shortDescription,
    body: record.body,
    category: record.category,
    tags: record.tags,
    ageRange: record.ageRange,
    difficulty: record.difficulty,
    estimatedMinutes: record.estimatedMinutes,
    image: record.image,
    seoTitle: record.seoTitle,
    seoDescription: record.seoDescription,
    ogImage: record.ogImage,
    canonicalPath: record.canonicalPath,
    publishedAt: record.publishedAt,
    lastReviewedAt: record.lastReviewedAt,
    locale: record.locale,
  };
}

export function getSeoIssues(record: PublicContentRecord): PublicContentSeoIssue[] {
  const issues: PublicContentSeoIssue[] = [];
  if (!record.title) issues.push("missing_title");
  if (!record.shortDescription) issues.push("missing_description");
  if (!record.seoTitle) issues.push("missing_seo_title");
  if (!record.seoDescription) issues.push("missing_seo_description");
  if (!record.image && !record.ogImage) issues.push("missing_image");
  if (!isValidPublicContentSlug(record.slug)) issues.push("slug_invalid");
  const reviewed = Date.parse(record.lastReviewedAt || "");
  if (!Number.isFinite(reviewed) || Date.now() - reviewed > REVIEW_STALE_DAYS * 24 * 60 * 60 * 1000) {
    issues.push("not_reviewed_recently");
  }
  if (record.status !== "published") issues.push("not_published");
  return issues;
}

function assertCanPublish(record: PublicContentRecord) {
  const issues = getSeoIssues(record).filter((issue) =>
    ["missing_title", "missing_description", "missing_seo_title", "missing_seo_description", "slug_invalid"].includes(issue),
  );
  if (issues.length) return { ok: false as const, error: `publish_missing_fields:${issues.join(",")}` };
  return { ok: true as const };
}

async function writeContentAudit(record: PublicContentRecord, actor: Actor, eventType: string, previousStatus = "") {
  const now = new Date().toISOString();
  const auditId = `${now.replace(/[^0-9]/g, "")}_${randomUUID()}`;
  await adminCreateOrReplaceDocument(`${COLLECTION}/${record.id}/auditLogs/${auditId}`, {
    eventType: stringField(eventType),
    actorUid: stringField(actor.uid),
    actorEmail: stringField(actor.email ?? ""),
    actorName: stringField(actor.name ?? ""),
    contentId: stringField(record.id),
    type: stringField(record.type),
    previousStatus: stringField(previousStatus),
    nextStatus: stringField(record.status),
    title: stringField(record.title),
    slug: stringField(record.slug),
    createdAt: timestampField(now),
  });
}

export async function listPublicContentRecords(query: PublicContentListQuery = {}) {
  const all = (await adminListDocuments(COLLECTION, 1000)).map(normalizePublicContentDocument);
  const q = (query.q ?? "").trim().toLowerCase();
  const type = query.type && isPublicContentType(query.type) ? query.type : "";
  const status = query.status && isPublicContentStatus(query.status) ? query.status : "";
  const locale = normalizeLocale(query.locale ?? "") ?? "";
  const filtered = all
    .filter((record) => !type || record.type === type)
    .filter((record) => !status || record.status === status)
    .filter((record) => !locale || record.locale === locale)
    .filter((record) => !query.tag || record.tags.includes(query.tag))
    .filter((record) => !query.category || record.category === query.category)
    .filter((record) => !query.missingSeo || getSeoIssues(record).some((issue) => issue !== "not_published"))
    .filter((record) =>
      !q ? true : [record.title, record.slug, record.shortDescription, record.category, record.tags.join(" ")].join(" ").toLowerCase().includes(q),
    );
  const sorted = [...filtered].sort((a, b) => {
    if (query.sort === "title") return a.title.localeCompare(b.title);
    if (query.sort === "publishedAt") return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0);
    return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
  });
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(MAX_LIST_LIMIT, Math.max(1, Number(query.limit) || 25));
  const total = sorted.length;
  return {
    records: sorted.slice((page - 1) * pageSize, page * pageSize),
    allRecords: all,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasMore: page * pageSize < total,
    },
  };
}

async function assertUniqueSlug(type: PublicContentType, slug: string, id: string) {
  const { allRecords } = await listPublicContentRecords();
  return !allRecords.some((record) => record.id !== id && record.status !== "archived" && record.type === type && record.slug === slug);
}

export async function createPublicContent(input: PublicContentInput, actor: Actor) {
  const normalized = normalizeInput(input);
  if (!normalized.ok) return normalized;
  const id = randomUUID();
  if (!(await assertUniqueSlug(normalized.value.type, normalized.value.slug, id))) {
    return { ok: false as const, error: "slug_not_unique" };
  }
  const now = new Date().toISOString();
  const record: PublicContentRecord = {
    id,
    status: "draft",
    createdByUid: actor.uid,
    createdAt: now,
    updatedByUid: actor.uid,
    updatedAt: now,
    approvedByUid: "",
    approvedAt: "",
    publishedByUid: "",
    publishedAt: "",
    archivedByUid: "",
    archivedAt: "",
    lastReviewedAt: "",
    voteCount: 0,
    helpfulCount: 0,
    reportCount: 0,
    copyCount: 0,
    ...normalized.value,
  };
  await adminCreateOrReplaceDocument(`${COLLECTION}/${id}`, recordToFields(record));
  await writeContentAudit(record, actor, "content_created");
  return { ok: true as const, record };
}

export async function getPublicContentRecord(id: string) {
  return normalizePublicContentDocument(await adminGetDocument(`${COLLECTION}/${id}`));
}

export async function updatePublicContent(id: string, input: PublicContentInput, actor: Actor) {
  const existing = await getPublicContentRecord(id);
  if (existing.status === "archived") return { ok: false as const, error: "archived_content_not_editable" };
  const normalized = normalizeInput(input, existing);
  if (!normalized.ok) return normalized;
  if (!(await assertUniqueSlug(normalized.value.type, normalized.value.slug, id))) {
    return { ok: false as const, error: "slug_not_unique" };
  }
  const record: PublicContentRecord = {
    ...existing,
    ...normalized.value,
    updatedByUid: actor.uid,
    updatedAt: new Date().toISOString(),
  };
  await adminCreateOrReplaceDocument(`${COLLECTION}/${id}`, recordToFields(record));
  await writeContentAudit(record, actor, "content_updated", existing.status);
  return { ok: true as const, record };
}

export async function transitionPublicContent(id: string, action: "submit-review" | "approve" | "publish" | "archive" | "unpublish", actor: Actor) {
  const existing = await getPublicContentRecord(id);
  const now = new Date().toISOString();
  const next: PublicContentRecord = { ...existing, updatedByUid: actor.uid, updatedAt: now };
  if (action === "submit-review") {
    if (existing.status !== "draft") return { ok: false as const, error: "invalid_transition" };
    next.status = "review";
  }
  if (action === "approve") {
    if (existing.status !== "review") return { ok: false as const, error: "invalid_transition" };
    if (!existing.shortDescription) return { ok: false as const, error: "short_description_required" };
    next.status = "approved";
    next.approvedByUid = actor.uid;
    next.approvedAt = now;
    next.lastReviewedAt = now;
  }
  if (action === "publish") {
    if (existing.status !== "approved" && existing.status !== "published") return { ok: false as const, error: "invalid_transition" };
    const publishCheck = assertCanPublish(existing);
    if (!publishCheck.ok) return publishCheck;
    next.status = "published";
    next.publishedByUid = actor.uid;
    next.publishedAt = existing.publishedAt || now;
    next.lastReviewedAt = existing.lastReviewedAt || now;
  }
  if (action === "archive") {
    if (existing.status === "archived") return { ok: false as const, error: "invalid_transition" };
    next.status = "archived";
    next.archivedByUid = actor.uid;
    next.archivedAt = now;
  }
  if (action === "unpublish") {
    if (existing.status !== "published") return { ok: false as const, error: "invalid_transition" };
    next.status = "approved";
  }
  await adminPatchDocument(`${COLLECTION}/${id}`, recordToFields(next));
  await writeContentAudit(next, actor, `content_${action.replace("-", "_")}`, existing.status);
  return { ok: true as const, record: next };
}

export async function listPublishedPublicContent(query: PublicContentListQuery = {}) {
  const { records, pagination } = await listPublicContentRecords({ ...query, status: "published" });
  return { content: records.map(toPublicContent), pagination };
}

export async function getPublishedContentBySlug(slug: string, type?: string) {
  if (!isValidPublicContentSlug(slug)) return null;
  const { records } = await listPublicContentRecords({ status: "published", type, limit: 1000 });
  const record = records.find((entry) => entry.slug === slug);
  return record ? toPublicContent(record) : null;
}

export function summarizeSeo(records: PublicContentRecord[]) {
  const byStatus = Object.fromEntries(PUBLIC_CONTENT_STATUSES.map((status) => [status, 0])) as Record<PublicContentStatus, number>;
  const byType = Object.fromEntries(PUBLIC_CONTENT_TYPES.map((type) => [type, 0])) as Record<PublicContentType, number>;
  let missingSeoTitle = 0;
  let missingSeoDescription = 0;
  let missingImage = 0;
  for (const record of records) {
    byStatus[record.status] += 1;
    byType[record.type] += 1;
    const issues = getSeoIssues(record);
    if (issues.includes("missing_seo_title")) missingSeoTitle += 1;
    if (issues.includes("missing_seo_description")) missingSeoDescription += 1;
    if (issues.includes("missing_image")) missingImage += 1;
  }
  const recentPublished = records
    .filter((record) => record.status === "published")
    .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0))
    .slice(0, 8);
  const needingReview = records.filter((record) => getSeoIssues(record).includes("not_reviewed_recently")).slice(0, 8);
  return {
    total: records.length,
    published: byStatus.published,
    byStatus,
    byType,
    missingSeoTitle,
    missingSeoDescription,
    missingImage,
    publishedPages: records.filter((record) => record.status === "published" && ["chore", "reward", "guide"].includes(record.type)).length,
    sitemapReady: records.every((record) => record.status !== "published" || Boolean(record.canonicalPath)),
    robotsReady: true,
    structuredDataReady: true,
    recentPublished,
    needingReview,
  };
}
