import type { AppLocale } from "@packages/locales";

export const PUBLIC_CONTENT_TYPES = [
  "chore",
  "reward",
  "quest",
  "achievement",
  "guide",
  "community_award",
  "changelog",
  "requested_change",
] as const;

export type PublicContentType = (typeof PUBLIC_CONTENT_TYPES)[number];

export const EDITABLE_PUBLIC_CONTENT_TYPES = ["chore", "reward", "guide"] as const;

export const PUBLIC_CONTENT_STATUSES = [
  "draft",
  "review",
  "approved",
  "published",
  "archived",
] as const;

export type PublicContentStatus = (typeof PUBLIC_CONTENT_STATUSES)[number];

export type PublicContentRecord = {
  id: string;
  type: PublicContentType;
  status: PublicContentStatus;
  slug: string;
  title: string;
  shortDescription: string;
  body: string;
  category: string;
  tags: string[];
  ageRange: string;
  difficulty: string;
  estimatedMinutes: number;
  image: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string[];
  ogImage: string;
  canonicalPath: string;
  locale: AppLocale;
  sourceType: string;
  sourceId: string;
  createdByUid: string;
  createdAt: string;
  updatedByUid: string;
  updatedAt: string;
  approvedByUid: string;
  approvedAt: string;
  publishedByUid: string;
  publishedAt: string;
  archivedByUid: string;
  archivedAt: string;
  lastReviewedAt: string;
  voteCount: number;
  helpfulCount: number;
  reportCount: number;
  copyCount: number;
  metadata: Record<string, unknown>;
};

export type PublicContentInput = Partial<
  Pick<
    PublicContentRecord,
    | "type"
    | "slug"
    | "title"
    | "shortDescription"
    | "body"
    | "category"
    | "tags"
    | "ageRange"
    | "difficulty"
    | "estimatedMinutes"
    | "image"
    | "seoTitle"
    | "seoDescription"
    | "seoKeywords"
    | "ogImage"
    | "locale"
    | "sourceType"
    | "sourceId"
    | "metadata"
  >
>;

export type PublicContentPublicRecord = Pick<
  PublicContentRecord,
  | "type"
  | "slug"
  | "title"
  | "shortDescription"
  | "body"
  | "category"
  | "tags"
  | "ageRange"
  | "difficulty"
  | "estimatedMinutes"
  | "image"
  | "seoTitle"
  | "seoDescription"
  | "ogImage"
  | "canonicalPath"
  | "publishedAt"
  | "lastReviewedAt"
  | "locale"
>;

export type PublicContentSeoIssue =
  | "missing_title"
  | "missing_description"
  | "missing_seo_title"
  | "missing_seo_description"
  | "missing_image"
  | "slug_invalid"
  | "not_reviewed_recently"
  | "not_published";

export type PublicContentListQuery = {
  type?: string;
  status?: string;
  q?: string;
  tag?: string;
  category?: string;
  locale?: string;
  missingSeo?: boolean;
  page?: number;
  limit?: number;
  sort?: string;
};
