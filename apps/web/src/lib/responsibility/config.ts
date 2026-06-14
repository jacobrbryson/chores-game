import { adminGetDocument } from "@/lib/firestore/admin";
import { readInteger, readString, type FirestoreValue } from "@/lib/firestore/rest";
import { DEFAULT_LEVEL_THRESHOLDS } from "@/lib/responsibility/levels";

// XP values and level thresholds are deliberately configurable rather than
// balanced in code. Support admins tune them via the support console, which
// writes the `appConfig/responsibility` document; everything falls back to
// these defaults when the document is missing or malformed.
export const DEFAULT_RESPONSIBILITY_XP_VALUES = {
  choreCompletionXp: 5,
  routineStepXp: 5,
  routineCompletionBonusXp: 15,
  newSkillBonusXp: 10,
} as const;

export type ResponsibilityXpValues = {
  choreCompletionXp: number;
  routineStepXp: number;
  routineCompletionBonusXp: number;
  newSkillBonusXp: number;
};

export type ResponsibilityConfig = {
  xpValues: ResponsibilityXpValues;
  levelThresholds: number[];
};

export const RESPONSIBILITY_CONFIG_DOC_PATH = "appConfig/responsibility";

export function defaultResponsibilityConfig(): ResponsibilityConfig {
  return {
    xpValues: { ...DEFAULT_RESPONSIBILITY_XP_VALUES },
    levelThresholds: [...DEFAULT_LEVEL_THRESHOLDS],
  };
}

function readXpValue(
  fields: Record<string, FirestoreValue> | undefined,
  key: keyof ResponsibilityXpValues,
): number {
  // readInteger returns 0 for missing fields, so check presence explicitly —
  // an absent field means "use the default", not "zero XP".
  if (!fields || !(key in fields)) {
    return DEFAULT_RESPONSIBILITY_XP_VALUES[key];
  }
  const value = readInteger(fields, key);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_RESPONSIBILITY_XP_VALUES[key];
}

export function parseResponsibilityConfigFields(
  fields: Record<string, FirestoreValue> | undefined,
): ResponsibilityConfig {
  const config = defaultResponsibilityConfig();
  if (!fields) {
    return config;
  }
  config.xpValues = {
    choreCompletionXp: readXpValue(fields, "choreCompletionXp"),
    routineStepXp: readXpValue(fields, "routineStepXp"),
    routineCompletionBonusXp: readXpValue(fields, "routineCompletionBonusXp"),
    newSkillBonusXp: readXpValue(fields, "newSkillBonusXp"),
  };
  // Thresholds are stored as a JSON string (ascending integers starting at 0)
  // to keep the REST field handling simple. Invalid input keeps the defaults.
  const thresholdsJson = readString(fields, "levelThresholdsJson");
  if (thresholdsJson) {
    try {
      const parsed = JSON.parse(thresholdsJson) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.length >= 2 &&
        parsed.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0) &&
        parsed[0] === 0 &&
        parsed.every((value, index) => index === 0 || value > (parsed[index - 1] as number))
      ) {
        config.levelThresholds = parsed.map((value) => Math.trunc(value as number));
      }
    } catch {
      // keep defaults
    }
  }
  return config;
}

// Config is read with admin credentials (the document is platform-wide, not
// family-scoped) and cached in-memory so the chore completion hot path never
// adds more than one extra read per minute per server instance.
const CONFIG_CACHE_TTL_MS = 60_000;
let cachedConfig: ResponsibilityConfig | null = null;
let cachedAt = 0;

export async function loadResponsibilityConfig(): Promise<ResponsibilityConfig> {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CONFIG_CACHE_TTL_MS) {
    return cachedConfig;
  }
  try {
    const doc = await adminGetDocument(RESPONSIBILITY_CONFIG_DOC_PATH);
    cachedConfig = parseResponsibilityConfigFields(doc.fields);
  } catch {
    // Missing document or unavailable admin credentials → defaults. We still
    // cache to avoid hammering Firestore with failing reads.
    cachedConfig = defaultResponsibilityConfig();
  }
  cachedAt = now;
  return cachedConfig;
}

export function invalidateResponsibilityConfigCache() {
  cachedConfig = null;
  cachedAt = 0;
}
