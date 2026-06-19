import {
  boolField,
  documentIdFromName,
  integerField,
  nullField,
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

/**
 * Smart Ghost Chores domain logic.
 *
 * Ghost chores are deterministic, *suggested* chores shown to a player when they
 * have no active chores left. They are NOT real chores: they never affect chore
 * counts, stats, wallet, achievements, streaks, or the approval queue until an
 * admin explicitly approves a request and converts it into a real chore.
 *
 * This module is intentionally free of network/AI dependencies so the generation
 * and safety rules can be unit-tested in isolation.
 */

export const GHOST_CHORE_SOURCES = ["builtin_template", "family_history", "recent_chore", "athena"] as const;
export type GhostChoreSource = (typeof GHOST_CHORE_SOURCES)[number];

/**
 * Extra metadata present only on Athena-generated suggestions. Kept optional so
 * the deterministic/local suggestions and the persisted record shape are
 * unchanged; this rides along on the in-memory suggestion for richer UI.
 */
export type GhostChoreAthenaMeta = {
  difficulty: "easy" | "medium" | "hard";
  estimatedMinutes: number | null;
  suggestionType: "repeat" | "next_step" | "skill_building" | "novelty";
  reason: string;
  confidence: number;
  requiresParentReview: boolean;
  safetyNotes: string | null;
  categoryLabel: string | null;
  pillar: string | null;
};

export const GHOST_CHORE_STATUSES = [
  "suggested",
  "requested",
  "dismissed",
  "approved",
  "rejected",
  "converted",
] as const;
export type GhostChoreStatus = (typeof GHOST_CHORE_STATUSES)[number];

export const DEFAULT_GHOST_SUGGESTION_LIMIT = 6;
export const MAX_GHOST_SUGGESTION_COIN_VALUE = 100;

/** A suggestion as surfaced to a ghost-chore card (generated on read). */
export type GhostChoreSuggestion = {
  id: string;
  suggestedTitle: string;
  suggestedDescription: string;
  suggestedCoinValue: number;
  suggestedCategoryIds: string[];
  source: GhostChoreSource;
  /** Present only when `source === "athena"`. */
  athena?: GhostChoreAthenaMeta;
};

/** A persisted request/dismissal record at families/{familyId}/ghostChoreSuggestions/{id}. */
export type GhostChoreSuggestionRecord = {
  id: string;
  familyId: string;
  playerUid: string;
  playerMemberId: string;
  suggestedTitle: string;
  suggestedDescription: string;
  suggestedCoinValue: number;
  suggestedCategoryIds: string[];
  source: GhostChoreSource;
  status: GhostChoreStatus;
  /**
   * Athena signal fields, persisted only for Athena-sourced suggestions so the
   * approve path can pass a rich preference signal back to Athena's memory.
   * Empty string when absent/local.
   */
  athenaSuggestionType: string;
  athenaPillar: string;
  athenaDifficulty: string;
  athenaCategoryLabel: string;
  requestedAt: string;
  requestedByUid: string;
  reviewedAt: string;
  reviewedByUid: string;
  convertedChoreId: string;
  dismissedAt: string;
  /** Backend popularity signal: +1 when a suggestion is added, -1 (down) when dismissed. */
  upvotes: number;
  downvotes: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Built-in age-appropriate chore templates. Every entry is deliberately a low-risk
 * indoor/tidy-up style task. See isSafeChoreTitle for the safety guardrails that any
 * family-sourced suggestion must also pass.
 */
export const BUILTIN_GHOST_TEMPLATES: ReadonlyArray<{
  templateId: string;
  title: string;
  description: string;
  coinValue: number;
}> = [
  { templateId: "make_bed", title: "Make your bed", description: "Pull up the sheets and tidy your pillows.", coinValue: 5 },
  { templateId: "tidy_room", title: "Tidy your room", description: "Put toys, books, and clothes back where they belong.", coinValue: 10 },
  { templateId: "put_away_laundry", title: "Put away your clean laundry", description: "Fold and put your clean clothes in the drawers.", coinValue: 10 },
  { templateId: "set_table", title: "Set the table", description: "Lay out plates, cups, and napkins for a meal.", coinValue: 5 },
  { templateId: "clear_table", title: "Clear the table", description: "Bring dishes to the sink after a meal.", coinValue: 5 },
  { templateId: "water_plants", title: "Water the indoor plants", description: "Give the houseplants a small drink of water.", coinValue: 5 },
  { templateId: "tidy_shoes", title: "Line up the shoes", description: "Put everyone's shoes neatly by the door.", coinValue: 5 },
  { templateId: "dust_shelf", title: "Dust a shelf", description: "Wipe a low shelf with a dry cloth.", coinValue: 5 },
  { templateId: "sort_recycling", title: "Sort the recycling", description: "Put paper, cans, and bottles in the right bins.", coinValue: 10 },
  { templateId: "tidy_books", title: "Organize the bookshelf", description: "Line the books up neatly on the shelf.", coinValue: 5 },
  { templateId: "wipe_counter", title: "Wipe the counter", description: "Wipe a clean counter with a damp cloth.", coinValue: 5 },
  { templateId: "feed_pet_food", title: "Refill the pet's water bowl", description: "Pour fresh water into the pet's bowl.", coinValue: 5 },
];

/**
 * Keywords for chores we must never suggest. Covers chemicals, heat/cooking,
 * sharp tools, heights/ladders, outdoor hazards, power tools, and medically
 * sensitive pet care. Matched case-insensitively against the title + description.
 */
export const UNSAFE_GHOST_KEYWORDS: readonly string[] = [
  // chemicals / cleaning agents
  "bleach", "ammonia", "chemical", "pesticide", "fertilizer", "solvent", "drain cleaner",
  "toilet bowl cleaner", "oven cleaner", "disinfectant",
  // cooking with heat
  "stove", "oven", "boil", "boiling", "fry", "frying", "deep fry", "grill", "grilling",
  "barbecue", "bbq", "hot oil", "kettle", "microwave", "toaster", "iron the", "ironing",
  // knives / sharp tools
  "knife", "knives", "blade", "scissors", "saw", "axe", "chop", "slice", "shred", "grater",
  // heights / ladders
  "ladder", "roof", "gutter", "climb", "balcony", "rooftop", "ceiling",
  // outdoor hazards / power tools
  "mow", "mower", "lawnmower", "chainsaw", "drill", "power tool", "trimmer", "hedge",
  "pool", "pond", "trampoline", "fire", "fireplace", "bonfire", "matches", "lighter",
  "snow blower", "pressure washer", "weed", "spray",
  // electrical
  "electrical", "wiring", "socket", "outlet", "fuse",
  // medically sensitive pet care
  "medicine", "medication", "injection", "vaccine", "groom the dog", "bathe the dog",
  "walk the dog", "clean the litter", "litter box", "scoop",
];

const UNSAFE_PATTERN = new RegExp(
  `\\b(${UNSAFE_GHOST_KEYWORDS.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "i",
);

export function isSafeChoreTitle(title: string, description = ""): boolean {
  const haystack = `${title} ${description}`.trim();
  if (!haystack) {
    return false;
  }
  return !UNSAFE_PATTERN.test(haystack);
}

export function normalizeGhostText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

/** Stable de-duplication key for a chore title (case/punctuation insensitive). */
export function ghostSuggestionKey(title: string): string {
  return normalizeGhostText(title, 200)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function normalizeGhostCoinValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const normalized = Math.trunc(parsed);
  if (normalized < 0) {
    return 0;
  }
  return Math.min(normalized, MAX_GHOST_SUGGESTION_COIN_VALUE);
}

/** Deterministic suggestion id so requests/dismissals are idempotent per source+title. */
export function ghostSuggestionId(source: GhostChoreSource, title: string): string {
  return `${source}__${ghostSuggestionKey(title)}`;
}

export type FamilyChoreSeed = {
  title: string;
  coinValue?: number;
  categoryIds?: string[];
  source?: GhostChoreSource;
};

/**
 * Build the full ordered candidate pool (before exclusion filtering). Family-sourced
 * chores come first (more relevant), then built-in templates fill the rest. Unsafe
 * candidates are dropped and duplicates are collapsed by title key.
 */
export function buildGhostCandidatePool(familyChores: FamilyChoreSeed[] = []): GhostChoreSuggestion[] {
  const familyCandidates: GhostChoreSuggestion[] = familyChores
    .map((chore) => {
      const title = normalizeGhostText(chore.title, 160);
      const source: GhostChoreSource = chore.source === "family_history" ? "family_history" : "recent_chore";
      return {
        id: ghostSuggestionId(source, title),
        suggestedTitle: title,
        suggestedDescription: "",
        suggestedCoinValue: normalizeGhostCoinValue(chore.coinValue),
        suggestedCategoryIds: Array.isArray(chore.categoryIds) ? chore.categoryIds.slice(0, 5) : [],
        source,
      } satisfies GhostChoreSuggestion;
    })
    .filter((candidate) => candidate.suggestedTitle.length > 0);

  const builtinCandidates: GhostChoreSuggestion[] = BUILTIN_GHOST_TEMPLATES.map((template) => ({
    id: ghostSuggestionId("builtin_template", template.title),
    suggestedTitle: template.title,
    suggestedDescription: template.description,
    suggestedCoinValue: normalizeGhostCoinValue(template.coinValue),
    suggestedCategoryIds: [],
    source: "builtin_template" as const,
  }));

  const seen = new Set<string>();
  const pool: GhostChoreSuggestion[] = [];
  for (const candidate of [...familyCandidates, ...builtinCandidates]) {
    const key = ghostSuggestionKey(candidate.suggestedTitle);
    if (!key || seen.has(key)) {
      continue;
    }
    if (!isSafeChoreTitle(candidate.suggestedTitle, candidate.suggestedDescription)) {
      continue;
    }
    seen.add(key);
    pool.push(candidate);
  }
  return pool;
}

export type GenerateGhostSuggestionsInput = {
  familyChores?: FamilyChoreSeed[];
  /** Title keys to exclude (dismissed, already requested, or currently open for the player). */
  excludeKeys?: Iterable<string>;
  limit?: number;
};

export function generateGhostSuggestions(input: GenerateGhostSuggestionsInput): GhostChoreSuggestion[] {
  const excluded = new Set(input.excludeKeys ?? []);
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_GHOST_SUGGESTION_LIMIT, 20));
  return buildGhostCandidatePool(input.familyChores)
    .filter((candidate) => !excluded.has(ghostSuggestionKey(candidate.suggestedTitle)))
    .slice(0, limit);
}

/** Resolve a single suggestion by its deterministic id, ignoring exclusion filters. */
export function resolveGhostSuggestion(
  suggestionId: string,
  familyChores: FamilyChoreSeed[] = [],
): GhostChoreSuggestion | null {
  return buildGhostCandidatePool(familyChores).find((candidate) => candidate.id === suggestionId) ?? null;
}

export function isGhostChoreStatus(value: unknown): value is GhostChoreStatus {
  return typeof value === "string" && GHOST_CHORE_STATUSES.includes(value as GhostChoreStatus);
}

export function isGhostChoreSource(value: unknown): value is GhostChoreSource {
  return typeof value === "string" && GHOST_CHORE_SOURCES.includes(value as GhostChoreSource);
}

export function parseGhostSuggestionRecord(doc: FirestoreDocument): GhostChoreSuggestionRecord {
  const fields = doc.fields;
  const source = readString(fields, "source");
  const status = readString(fields, "status");
  return {
    id: documentIdFromName(doc.name),
    familyId: readString(fields, "familyId"),
    playerUid: readString(fields, "playerUid"),
    playerMemberId: readString(fields, "playerMemberId"),
    suggestedTitle: readString(fields, "suggestedTitle"),
    suggestedDescription: readString(fields, "suggestedDescription"),
    suggestedCoinValue: readInteger(fields, "suggestedCoinValue"),
    suggestedCategoryIds: readStringArray(fields, "suggestedCategoryIds"),
    source: isGhostChoreSource(source) ? source : "builtin_template",
    status: isGhostChoreStatus(status) ? status : "suggested",
    athenaSuggestionType: readString(fields, "athenaSuggestionType"),
    athenaPillar: readString(fields, "athenaPillar"),
    athenaDifficulty: readString(fields, "athenaDifficulty"),
    athenaCategoryLabel: readString(fields, "athenaCategoryLabel"),
    requestedAt: readTimestamp(fields, "requestedAt"),
    requestedByUid: readString(fields, "requestedByUid"),
    reviewedAt: readTimestamp(fields, "reviewedAt"),
    reviewedByUid: readString(fields, "reviewedByUid"),
    convertedChoreId: readString(fields, "convertedChoreId"),
    dismissedAt: readTimestamp(fields, "dismissedAt"),
    upvotes: readInteger(fields, "upvotes"),
    downvotes: readInteger(fields, "downvotes"),
    createdAt: readTimestamp(fields, "createdAt"),
    updatedAt: readTimestamp(fields, "updatedAt"),
  };
}

export function buildGhostSuggestionFields(input: {
  familyId: string;
  suggestion: GhostChoreSuggestion;
  playerUid: string;
  playerMemberId: string;
  status: GhostChoreStatus;
  now: string;
  requestedByUid?: string;
  upvotes?: number;
  downvotes?: number;
  convertedChoreId?: string;
}): Record<string, FirestoreValue> {
  const isRequest = input.status === "requested";
  const isDismiss = input.status === "dismissed";
  return {
    id: stringField(input.suggestion.id),
    familyId: stringField(input.familyId),
    playerUid: stringField(input.playerUid),
    playerMemberId: stringField(input.playerMemberId),
    suggestedTitle: stringField(input.suggestion.suggestedTitle),
    suggestedDescription: stringField(input.suggestion.suggestedDescription),
    suggestedCoinValue: integerField(normalizeGhostCoinValue(input.suggestion.suggestedCoinValue)),
    suggestedCategoryIds: stringArrayField(input.suggestion.suggestedCategoryIds),
    source: stringField(input.suggestion.source),
    status: stringField(input.status),
    athenaSuggestionType: stringField(input.suggestion.athena?.suggestionType ?? ""),
    athenaPillar: stringField(input.suggestion.athena?.pillar ?? ""),
    athenaDifficulty: stringField(input.suggestion.athena?.difficulty ?? ""),
    athenaCategoryLabel: stringField(input.suggestion.athena?.categoryLabel ?? ""),
    requestedAt: isRequest ? timestampField(input.now) : nullField(),
    requestedByUid: stringField(isRequest ? input.requestedByUid ?? input.playerUid : ""),
    reviewedAt: input.status === "converted" ? timestampField(input.now) : nullField(),
    reviewedByUid: stringField(""),
    convertedChoreId: stringField(input.convertedChoreId ?? ""),
    dismissedAt: isDismiss ? timestampField(input.now) : nullField(),
    upvotes: integerField(input.upvotes ?? 0),
    downvotes: integerField(input.downvotes ?? 0),
    createdAt: timestampField(input.now),
    updatedAt: timestampField(input.now),
  };
}

export type GhostSuggestionSummary = {
  totalRecords: number;
  requested: number;
  dismissed: number;
  approved: number;
  rejected: number;
  converted: number;
  pendingReview: number;
  topTemplates: Array<{ title: string; count: number }>;
};

/**
 * Aggregate persisted ghost suggestion records for support reporting. "shown" is not
 * persisted (suggestions are generated on read), so reporting focuses on the lifecycle
 * states we do persist: requested, dismissed, approved/converted, and rejected.
 */
export function summarizeGhostSuggestions(records: GhostChoreSuggestionRecord[]): GhostSuggestionSummary {
  const summary: GhostSuggestionSummary = {
    totalRecords: records.length,
    requested: 0,
    dismissed: 0,
    approved: 0,
    rejected: 0,
    converted: 0,
    pendingReview: 0,
    topTemplates: [],
  };
  const titleCounts = new Map<string, { title: string; count: number }>();
  for (const record of records) {
    if (record.status === "requested") {
      summary.requested += 1;
      summary.pendingReview += 1;
    } else if (record.status === "dismissed") {
      summary.dismissed += 1;
    } else if (record.status === "approved") {
      summary.approved += 1;
    } else if (record.status === "converted") {
      summary.converted += 1;
      summary.approved += 1;
    } else if (record.status === "rejected") {
      summary.rejected += 1;
    }
    if (record.status === "requested" || record.status === "approved" || record.status === "converted") {
      const key = ghostSuggestionKey(record.suggestedTitle);
      const existing = titleCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        titleCounts.set(key, { title: record.suggestedTitle, count: 1 });
      }
    }
  }
  summary.topTemplates = Array.from(titleCounts.values())
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, 5);
  return summary;
}
