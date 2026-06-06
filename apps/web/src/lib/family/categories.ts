import {
  documentIdFromName,
  listDocuments,
  readBoolean,
  readString,
  readStringArray,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import type { FamilyCategory } from "@/lib/family/types";

export const CATEGORY_COLOR_FALLBACK = "#64748b";
export const MAX_CATEGORY_NAME_LENGTH = 40;
export const MAX_CATEGORIES_PER_CHORE = 20;

export function normalizeCategoryName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeCategoryColor(value: string) {
  return value.trim().toLowerCase();
}

export function isValidCategoryColor(value: string) {
  return /^#[0-9a-f]{6}$/.test(value);
}

export function normalizeCategoryIds(value: unknown, maxCount = MAX_CATEGORIES_PER_CHORE) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const id = entry.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push(id);
    if (normalized.length >= maxCount) {
      break;
    }
  }
  return normalized;
}

export function readChoreCategoryIds(fields: Record<string, FirestoreValue> | undefined) {
  return normalizeCategoryIds(readStringArray(fields, "categoryIds"));
}

export function parseFamilyCategories(
  docs: Array<{ name: string; fields?: Record<string, FirestoreValue> }>,
) {
  return docs
    .map((doc) => {
      const id = documentIdFromName(doc.name);
      const deleted = readBoolean(doc.fields, "deleted");
      const name = normalizeCategoryName(readString(doc.fields, "name")).slice(
        0,
        MAX_CATEGORY_NAME_LENGTH,
      );
      const rawColor = normalizeCategoryColor(readString(doc.fields, "color"));
      const color = isValidCategoryColor(rawColor) ? rawColor : CATEGORY_COLOR_FALLBACK;
      const memberId = readString(doc.fields, "memberId").trim();
      return { id, deleted, name, color, memberId };
    })
    .filter((category) => !category.deleted && Boolean(category.id) && Boolean(category.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
      memberId: category.memberId,
    }));
}

export async function listFamilyCategories(familyId: string, idToken: string, pageSize = 300) {
  const docs = await listDocuments(`families/${familyId}/categories`, idToken, pageSize);
  return parseFamilyCategories(docs);
}

export function buildCategoryMap(categories: FamilyCategory[]) {
  return new Map(categories.map((category) => [category.id, category] as const));
}

export function resolveChoreCategories(
  categoryIds: string[],
  categoryMap: Map<string, FamilyCategory>,
) {
  const seen = new Set<string>();
  const resolved: FamilyCategory[] = [];
  for (const categoryId of categoryIds) {
    if (seen.has(categoryId)) {
      continue;
    }
    seen.add(categoryId);
    const category = categoryMap.get(categoryId);
    if (category) {
      resolved.push(category);
    }
  }
  return resolved;
}

export function hasAllCategoryIds(
  categoryIds: string[],
  categoryMap: Map<string, FamilyCategory>,
) {
  return categoryIds.every((categoryId) => categoryMap.has(categoryId));
}
