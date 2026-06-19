/**
 * Pure assembly of the sanitized context payload Family Chores sends to Athena
 * for ghost-chore suggestions. Kept free of I/O so it can be unit-tested; the
 * ghost-chore service fetches Firestore data and feeds normalized primitives in.
 *
 * Privacy: we deliberately send the MINIMUM Athena needs. No emails, no UIDs of
 * other members, no free-form notes, no exact birthdate — only a birth *year*
 * (and the derived age). Titles are sent because Athena needs them to avoid
 * duplicates and build next-step progressions.
 */

import { ghostSuggestionKey } from "@/lib/ghost-chores";
import type {
  GhostChoreSubjectRole,
  GhostChoreSuggestRequest,
  GhostContextChore,
} from "@/lib/integrations/ghost-chore-schema";

const MAX_TITLE_LEN = 120;
const MAX_ACTIVE = 40;
const MAX_RECENT = 30;
const MAX_PAST = 40;
const MAX_ACTIVITY = 20;
const MAX_CATEGORIES = 40;

/** Derive an approximate age from a birth year. Returns undefined when unknown. */
export function deriveAge(birthYear: number | undefined, now: Date = new Date()): number | undefined {
  if (!birthYear || !Number.isFinite(birthYear)) return undefined;
  const age = now.getUTCFullYear() - Math.trunc(birthYear);
  if (age < 0 || age > 120) return undefined;
  return age;
}

function toContextChore(input: { title: string; coinValue?: number; category?: string }): GhostContextChore | null {
  const title = (input.title ?? "").trim().slice(0, MAX_TITLE_LEN);
  if (!title) return null;
  const chore: GhostContextChore = { title };
  if (typeof input.coinValue === "number" && Number.isFinite(input.coinValue) && input.coinValue > 0) {
    chore.coinValue = Math.round(input.coinValue);
  }
  const category = (input.category ?? "").trim().slice(0, 60);
  if (category) chore.category = category;
  return chore;
}

/** Dedupe by title key, drop empties, cap length. */
function compact(list: Array<{ title: string; coinValue?: number; category?: string }>, cap: number): GhostContextChore[] {
  const seen = new Set<string>();
  const out: GhostContextChore[] = [];
  for (const raw of list) {
    const chore = toContextChore(raw);
    if (!chore) continue;
    const key = ghostSuggestionKey(chore.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(chore);
    if (out.length >= cap) break;
  }
  return out;
}

export type BuildGhostContextInput = {
  subject: {
    id: string;
    role: GhostChoreSubjectRole;
    displayName?: string;
    birthYear?: number;
  };
  /** When the subject (or family) first started using Family Chores. */
  startedAt?: string;
  totalChoresCompleted?: number;
  coinBalance?: number;
  activeChores: Array<{ title: string; coinValue?: number; category?: string }>;
  recentlyCompleted: Array<{ title: string; coinValue?: number; category?: string }>;
  pastChores: Array<{ title: string; coinValue?: number; category?: string }>;
  suggestionActivity: {
    suggested: Array<{ title: string }>;
    dismissed: Array<{ title: string }>;
    accepted: Array<{ title: string }>;
  };
  categories: string[];
  familySettings: { minCoin?: number; maxCoin?: number; requireApproval?: boolean };
  count?: number;
  now?: Date;
};

/** Compute whole days between `startedAt` and now (clamped to >= 0). */
function tenureDays(startedAt: string | undefined, now: Date): number | undefined {
  if (!startedAt) return undefined;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return undefined;
  const days = Math.floor((now.getTime() - start) / 86_400_000);
  return days >= 0 ? days : 0;
}

export function buildGhostChoreRequest(input: BuildGhostContextInput): GhostChoreSuggestRequest {
  const now = input.now ?? new Date();
  const age = deriveAge(input.subject.birthYear, now);
  const displayName = (input.subject.displayName ?? "").trim().slice(0, 80);

  return {
    user: {
      id: input.subject.id,
      role: input.subject.role,
      ...(displayName ? { displayName } : {}),
      ...(input.subject.birthYear ? { birthYear: Math.trunc(input.subject.birthYear) } : {}),
      ...(age !== undefined ? { age } : {}),
    },
    ...(tenureDays(input.startedAt, now) !== undefined ? { tenureDays: tenureDays(input.startedAt, now) } : {}),
    ...(typeof input.totalChoresCompleted === "number"
      ? { totalChoresCompleted: Math.max(0, Math.round(input.totalChoresCompleted)) }
      : {}),
    ...(typeof input.coinBalance === "number" ? { coinBalance: Math.max(0, Math.round(input.coinBalance)) } : {}),
    activeChores: compact(input.activeChores, MAX_ACTIVE),
    recentlyCompleted: compact(input.recentlyCompleted, MAX_RECENT),
    pastChores: compact(input.pastChores, MAX_PAST),
    recentSuggestionActivity: {
      suggested: compact(input.suggestionActivity.suggested, MAX_ACTIVITY),
      dismissed: compact(input.suggestionActivity.dismissed, MAX_ACTIVITY),
      accepted: compact(input.suggestionActivity.accepted, MAX_ACTIVITY),
    },
    categories: Array.from(
      new Set(
        input.categories
          .map((c) => (c ?? "").trim().slice(0, 60))
          .filter(Boolean),
      ),
    ).slice(0, MAX_CATEGORIES),
    familySettings: {
      ...(typeof input.familySettings.minCoin === "number" ? { minCoin: Math.max(0, Math.round(input.familySettings.minCoin)) } : {}),
      ...(typeof input.familySettings.maxCoin === "number" ? { maxCoin: Math.max(0, Math.round(input.familySettings.maxCoin)) } : {}),
      requireApproval: input.familySettings.requireApproval !== false,
    },
    ...(typeof input.count === "number" ? { count: Math.min(12, Math.max(1, Math.round(input.count))) } : {}),
  };
}
