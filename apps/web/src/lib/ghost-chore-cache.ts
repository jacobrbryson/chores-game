/**
 * Short-lived cache of the most recent Athena ghost-chore batch per subject.
 *
 * Serves three jobs at once:
 *  1. **Rate limiting / cost control** — within the TTL we serve the cached batch
 *     instead of calling Athena (Gemini) again on every dashboard load.
 *  2. **Resolvability** — Athena suggestions are not in the deterministic local
 *     pool, so the request/dismiss/add lifecycle resolves a suggestion's full
 *     content by id from this cache.
 *  3. **Audit of what was shown** — `generatedAt`/`modelVersion` capture which
 *     model produced the batch the family saw.
 *
 * Stored at `families/{familyId}/ghostChoreCache/{subjectMemberId}`. The batch is
 * a JSON string (`payload`) to avoid deep Firestore field builders for nested
 * suggestion objects; it is bounded (<= a dozen small suggestions).
 */
import { adminCreateOrReplaceDocument, adminGetDocument } from "@/lib/firestore/admin";
import { readString, readTimestamp, stringField, timestampField } from "@/lib/firestore/rest";
import type { GhostChoreSuggestion } from "@/lib/ghost-chores";

/** How long an Athena batch is considered fresh before we ask again. */
export const GHOST_CACHE_TTL_MS = 10 * 60 * 1000;

const MAX_CACHED_SUGGESTIONS = 20;

export type GhostChoreCacheEntry = {
  suggestions: GhostChoreSuggestion[];
  generatedAt: string;
  modelVersion: string;
};

function cachePath(familyId: string, subjectMemberId: string) {
  return `families/${familyId}/ghostChoreCache/${subjectMemberId}`;
}

function isNotFound(error: unknown) {
  const reason = error instanceof Error ? error.message : "";
  return reason.includes("FIRESTORE_ADMIN_HTTP_404") || reason.includes("FIRESTORE_HTTP_404");
}

export function isCacheFresh(entry: GhostChoreCacheEntry | null, now: Date = new Date()): boolean {
  if (!entry?.generatedAt) return false;
  const ts = Date.parse(entry.generatedAt);
  if (!Number.isFinite(ts)) return false;
  return now.getTime() - ts < GHOST_CACHE_TTL_MS;
}

export async function getGhostChoreCache(
  familyId: string,
  subjectMemberId: string,
): Promise<GhostChoreCacheEntry | null> {
  try {
    const doc = await adminGetDocument(cachePath(familyId, subjectMemberId));
    const payload = readString(doc.fields, "payload");
    let suggestions: GhostChoreSuggestion[] = [];
    try {
      const parsed = JSON.parse(payload);
      if (Array.isArray(parsed)) suggestions = parsed as GhostChoreSuggestion[];
    } catch {
      suggestions = [];
    }
    return {
      suggestions,
      generatedAt: readTimestamp(doc.fields, "generatedAt"),
      modelVersion: readString(doc.fields, "modelVersion"),
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function saveGhostChoreCache(
  familyId: string,
  subjectMemberId: string,
  suggestions: GhostChoreSuggestion[],
  modelVersion: string,
): Promise<void> {
  const now = new Date().toISOString();
  await adminCreateOrReplaceDocument(cachePath(familyId, subjectMemberId), {
    subjectMemberId: stringField(subjectMemberId),
    source: stringField("athena"),
    modelVersion: stringField(modelVersion.slice(0, 120)),
    payload: stringField(JSON.stringify(suggestions.slice(0, MAX_CACHED_SUGGESTIONS))),
    generatedAt: timestampField(now),
    createdAt: timestampField(now),
  });
}

/**
 * Resolve a single cached Athena suggestion by id, searching the subject's cache
 * first and then (as a fallback for admins acting across members) any cache the
 * caller hands in. Returns null when not found/expired.
 */
export function findCachedSuggestion(
  entry: GhostChoreCacheEntry | null,
  suggestionId: string,
): GhostChoreSuggestion | null {
  if (!entry) return null;
  return entry.suggestions.find((s) => s.id === suggestionId) ?? null;
}
