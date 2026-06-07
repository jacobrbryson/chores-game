import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FirestoreDocument, FirestoreValue } from "@/lib/firestore/rest";

const mocks = vi.hoisted(() => ({
  adminListDocuments: vi.fn(),
  adminGetDocument: vi.fn(),
  adminCreateOrReplaceDocument: vi.fn(),
  adminPatchDocument: vi.fn(),
}));

vi.mock("@/lib/firestore/admin", () => ({
  adminListDocuments: mocks.adminListDocuments,
  adminGetDocument: mocks.adminGetDocument,
  adminCreateOrReplaceDocument: mocks.adminCreateOrReplaceDocument,
  adminPatchDocument: mocks.adminPatchDocument,
}));

import {
  createPublicContent,
  getPublishedContentBySlug,
  getSeoIssues,
  isValidPublicContentSlug,
  listPublishedPublicContent,
  normalizePublicContentDocument,
  toPublicContent,
  transitionPublicContent,
} from "./service";

function stringField(value: string): FirestoreValue {
  return { stringValue: value };
}

function timestampField(value: string): FirestoreValue {
  return { timestampValue: value };
}

function integerField(value: number): FirestoreValue {
  return { integerValue: String(value) };
}

function arrayField(values: string[]): FirestoreValue {
  return { arrayValue: { values: values.map((value) => stringField(value)) } };
}

function doc(input: { docId?: string; fields?: Partial<Record<string, FirestoreValue>> } = {}): FirestoreDocument {
  const id = input.docId ?? "content-1";
  return {
    name: `projects/p/databases/(default)/documents/publicContent/${id}`,
    fields: {
      id: stringField(id),
      type: stringField("guide"),
      status: stringField("published"),
      slug: stringField("age-appropriate-chores"),
      title: stringField("Age-appropriate chores"),
      shortDescription: stringField("Safe chore ideas."),
      body: stringField("Choose chores carefully."),
      category: stringField("Guides"),
      tags: arrayField(["chores"]),
      ageRange: stringField("All ages"),
      difficulty: stringField("Easy"),
      estimatedMinutes: integerField(5),
      image: stringField("/workflow.png"),
      seoTitle: stringField("Age-appropriate chores for kids"),
      seoDescription: stringField("Safe chores by age."),
      seoKeywords: arrayField(["chores"]),
      ogImage: stringField("/workflow.png"),
      canonicalPath: stringField("/resources/age-appropriate-chores"),
      locale: stringField("en-US"),
      sourceType: stringField(""),
      sourceId: stringField("private-source"),
      createdByUid: stringField("support-1"),
      createdAt: timestampField("2026-06-01T00:00:00.000Z"),
      updatedByUid: stringField("support-1"),
      updatedAt: timestampField("2026-06-01T00:00:00.000Z"),
      approvedByUid: stringField("support-1"),
      approvedAt: timestampField("2026-06-01T00:00:00.000Z"),
      publishedByUid: stringField("support-1"),
      publishedAt: timestampField("2026-06-02T00:00:00.000Z"),
      archivedByUid: stringField(""),
      archivedAt: stringField(""),
      lastReviewedAt: timestampField("2026-06-02T00:00:00.000Z"),
      voteCount: integerField(3),
      helpfulCount: integerField(2),
      reportCount: integerField(0),
      copyCount: integerField(1),
      metadata: { mapValue: { fields: { safe: stringField("yes") } } },
      ...input.fields,
    },
  };
}

const actor = { uid: "support-1", email: "support@example.com", name: "Support" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminListDocuments.mockResolvedValue([]);
  mocks.adminCreateOrReplaceDocument.mockResolvedValue({});
  mocks.adminPatchDocument.mockResolvedValue({});
});

describe("public content service", () => {
  it("validates URL-safe slugs", () => {
    expect(isValidPublicContentSlug("make-your-bed")).toBe(true);
    expect(isValidPublicContentSlug("Make Your Bed")).toBe(false);
    expect(isValidPublicContentSlug("../private")).toBe(false);
  });

  it("lets support create editable content with generated canonical path", async () => {
    const result = await createPublicContent({ type: "chore", title: "Make your bed", slug: "make-your-bed" }, actor);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.status).toBe("draft");
      expect(result.record.canonicalPath).toBe("/chores/make-your-bed");
    }
    expect(mocks.adminCreateOrReplaceDocument).toHaveBeenCalled();
  });

  it("rejects unsupported creatable types and duplicate active slugs", async () => {
    await expect(createPublicContent({ type: "quest", title: "Quest", slug: "quest" }, actor)).resolves.toEqual({
      ok: false,
      error: "type_not_creatable",
    });
    mocks.adminListDocuments.mockResolvedValue([doc({ fields: { type: stringField("guide"), slug: stringField("same"), status: stringField("published") } })]);
    await expect(createPublicContent({ type: "guide", title: "Same", slug: "same" }, actor)).resolves.toEqual({
      ok: false,
      error: "slug_not_unique",
    });
  });

  it("does not return draft content from public lists", async () => {
    mocks.adminListDocuments.mockResolvedValue([
      doc({ docId: "published", fields: { status: stringField("published") } }),
      doc({ docId: "draft", fields: { status: stringField("draft"), slug: stringField("draft") } }),
    ]);
    const result = await listPublishedPublicContent();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].slug).toBe("age-appropriate-chores");
  });

  it("sanitizes public response fields", () => {
    const publicRecord = toPublicContent(normalizePublicContentDocument(doc()));
    expect(publicRecord).not.toHaveProperty("createdByUid");
    expect(publicRecord).not.toHaveProperty("approvedByUid");
    expect(publicRecord).not.toHaveProperty("sourceId");
    expect(publicRecord).not.toHaveProperty("metadata");
  });

  it("requires SEO fields before publishing and archives out of public responses", async () => {
    mocks.adminGetDocument.mockResolvedValue(doc({ fields: { status: stringField("approved"), seoTitle: stringField("") } }));
    await expect(transitionPublicContent("content-1", "publish", actor)).resolves.toEqual({
      ok: false,
      error: "publish_missing_fields:missing_seo_title",
    });

    mocks.adminGetDocument.mockResolvedValue(doc({ fields: { status: stringField("published") } }));
    const archived = await transitionPublicContent("content-1", "archive", actor);
    expect(archived.ok).toBe(true);
    expect(mocks.adminPatchDocument).toHaveBeenCalled();
  });

  it("finds published content by slug only", async () => {
    mocks.adminListDocuments.mockResolvedValue([
      doc({ docId: "published", fields: { status: stringField("published") } }),
      doc({ docId: "approved", fields: { status: stringField("approved"), slug: stringField("approved-only") } }),
    ]);
    await expect(getPublishedContentBySlug("age-appropriate-chores", "guide")).resolves.toMatchObject({
      slug: "age-appropriate-chores",
    });
    await expect(getPublishedContentBySlug("approved-only", "guide")).resolves.toBeNull();
  });

  it("reports SEO health issues", () => {
    const record = normalizePublicContentDocument(doc({ fields: { seoDescription: stringField(""), image: stringField(""), ogImage: stringField("") } }));
    expect(getSeoIssues(record)).toEqual(expect.arrayContaining(["missing_seo_description", "missing_image"]));
  });
});
