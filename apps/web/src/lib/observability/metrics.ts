import { randomUUID } from "node:crypto";
import { adminCreateDocument } from "@/lib/firestore/admin";
import {
  boolField,
  mapField,
  nullField,
  signedIntegerField,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";

// Operation metrics live in a single top-level collection. Writes go through the
// admin/service-account credentials (Firestore rules deny all client access — see
// firestore.rules) so any user-scoped API route can record a metric without
// granting end users read/write on the collection.
export const OPERATION_METRICS_COLLECTION = "operationMetrics";

// A database read/route slower than this is flagged as a "slow" operation in the
// Operations dashboard and counts toward the latency health signal.
export const SLOW_OPERATION_THRESHOLD_MS = 1000;

// Retention window. Stays inside the 14–30 day requirement; the matching
// Firestore TTL policy (configured on `expiresAt` in the console) purges expired
// docs. `expiresAt` is written on every record so the policy has a field to use.
export const METRIC_RETENTION_DAYS = 21;

// Sentinel for "the caller did not supply this count". Stored instead of null so
// the field stays a number for ordering/indexing; readers treat < 0 as absent.
export const METRIC_COUNT_ABSENT = -1;

const MAX_METADATA_KEYS = 20;
const MAX_METADATA_STRING_LENGTH = 120;
// Drop any metadata key that could carry child-private data, free text, secrets,
// or contact info. Matched case-insensitively against the key name.
const SENSITIVE_METADATA_KEY_PATTERN =
  /(token|auth|secret|password|cookie|session|email|description|body|content|note|message|title|name|address|phone|ssn|dob|birth|child|payload|header)/i;

export type OperationArea =
  | "chores"
  | "routines"
  | "responsibility"
  | "achievements"
  | "notifications"
  | "store"
  | "feed"
  | "support"
  | "changelog";

export type OperationStatus = "ok" | "error" | "slow";

export type OperationMetricMetadata = Record<string, string | number | boolean | null>;

export type OperationMetricInput = {
  area: OperationArea | string;
  operation: string;
  durationMs: number;
  status?: OperationStatus;
  resultCount?: number;
  requestedLimit?: number;
  hasNextPage?: boolean;
  /**
   * Whether the caller explicitly surfaced/returned the next cursor (or page
   * metadata) to its consumer. When a next page exists but the cursor was not
   * consumed, the read silently truncated results — a pagination risk.
   */
  cursorConsumed?: boolean;
  errorCode?: string;
  familyId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
};

export type PaginationRiskResult = {
  paginationRisk: boolean;
  riskReason: string;
};

/**
 * Pure pagination-risk detection. A metric is a pagination risk when:
 *  - a requested limit is present AND the result count exactly equals it
 *    AND the caller did not surface/consume a cursor (the page filled up and
 *    there are very likely more rows we silently dropped), OR
 *  - a next page exists but the caller did not consume/return the cursor
 *    (results were silently truncated).
 *
 * A full page is only a risk when it was *silently* truncated. Endpoints that
 * properly expose page metadata pass `cursorConsumed: true`, so a result count
 * equal to the page size is expected for them, not a risk.
 */
export function computePaginationRisk(input: {
  requestedLimit?: number;
  resultCount?: number;
  hasNextPage?: boolean;
  cursorConsumed?: boolean;
}): PaginationRiskResult {
  const { requestedLimit, resultCount, hasNextPage, cursorConsumed } = input;

  if (
    cursorConsumed !== true &&
    typeof requestedLimit === "number" &&
    requestedLimit > 0 &&
    typeof resultCount === "number" &&
    resultCount === requestedLimit
  ) {
    return {
      paginationRisk: true,
      riskReason: "result_count_equals_requested_limit",
    };
  }

  if (hasNextPage === true && cursorConsumed !== true) {
    return {
      paginationRisk: true,
      riskReason: "next_page_exists_cursor_not_consumed",
    };
  }

  return { paginationRisk: false, riskReason: "" };
}

/**
 * Strip anything that could expose sensitive personal data, free text, or
 * secrets from operation metadata. Only short primitive values survive, and keys
 * are capped so a buggy caller cannot bloat a metric document.
 */
export function sanitizeMetadata(metadata?: Record<string, unknown>): OperationMetricMetadata {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  const safe: OperationMetricMetadata = {};
  let count = 0;
  for (const [key, value] of Object.entries(metadata)) {
    if (count >= MAX_METADATA_KEYS) {
      break;
    }
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) {
      continue;
    }
    if (SENSITIVE_METADATA_KEY_PATTERN.test(key)) {
      continue;
    }
    if (value === null) {
      safe[key] = null;
      count += 1;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      safe[key] = value;
      count += 1;
      continue;
    }
    if (typeof value === "boolean") {
      safe[key] = value;
      count += 1;
      continue;
    }
    if (typeof value === "string") {
      safe[key] = value.slice(0, MAX_METADATA_STRING_LENGTH);
      count += 1;
      continue;
    }
    // Objects, arrays, functions, symbols, undefined are intentionally dropped.
  }
  return safe;
}

export function resolveOperationStatus(input: OperationMetricInput): OperationStatus {
  if (input.status) {
    return input.status;
  }
  if (input.errorCode) {
    return "error";
  }
  const durationMs = Number.isFinite(input.durationMs) ? input.durationMs : 0;
  return durationMs >= SLOW_OPERATION_THRESHOLD_MS ? "slow" : "ok";
}

function metadataToField(metadata: OperationMetricMetadata): FirestoreValue {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null) {
      fields[key] = nullField();
    } else if (typeof value === "number") {
      fields[key] = signedIntegerField(Math.round(value));
    } else if (typeof value === "boolean") {
      fields[key] = boolField(value);
    } else {
      fields[key] = stringField(value);
    }
  }
  return mapField(fields);
}

/**
 * Build the Firestore field map for an operation metric. Exposed for unit tests
 * that assert nothing sensitive is ever written to a metric document.
 */
export function buildOperationMetricFields(
  input: OperationMetricInput,
  now: Date = new Date(),
): Record<string, FirestoreValue> {
  const nowIso = now.toISOString();
  const expiresAtIso = new Date(now.getTime() + METRIC_RETENTION_DAYS * 86_400_000).toISOString();
  const durationMs = Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs)) : 0;
  const status = resolveOperationStatus(input);
  const { paginationRisk, riskReason } = computePaginationRisk(input);
  const safeMetadata = sanitizeMetadata(input.metadata);

  return {
    area: stringField(String(input.area).slice(0, 60)),
    operation: stringField(String(input.operation).slice(0, 80)),
    durationMs: signedIntegerField(durationMs),
    status: stringField(status),
    slow: boolField(durationMs >= SLOW_OPERATION_THRESHOLD_MS),
    resultCount: signedIntegerField(
      typeof input.resultCount === "number" ? Math.round(input.resultCount) : METRIC_COUNT_ABSENT,
    ),
    requestedLimit: signedIntegerField(
      typeof input.requestedLimit === "number" ? Math.round(input.requestedLimit) : METRIC_COUNT_ABSENT,
    ),
    hasNextPage: boolField(input.hasNextPage === true),
    paginationRisk: boolField(paginationRisk),
    riskReason: stringField(riskReason),
    errorCode: stringField((input.errorCode ?? "").slice(0, 120)),
    familyId: stringField((input.familyId ?? "").slice(0, 120)),
    userId: stringField((input.userId ?? "").slice(0, 120)),
    metadata: metadataToField(safeMetadata),
    createdAt: timestampField(nowIso),
    expiresAt: timestampField(expiresAtIso),
  };
}

/**
 * Record a single operation metric. Best-effort and non-blocking: failures are
 * swallowed (logged) so instrumentation never breaks the request path. Callers
 * typically `void recordOperationMetric(...)` without awaiting.
 */
export async function recordOperationMetric(input: OperationMetricInput): Promise<void> {
  try {
    const now = new Date();
    const docId = `${now.toISOString().replace(/[^0-9]/g, "")}_${randomUUID()}`;
    const fields = buildOperationMetricFields(input, now);
    await adminCreateDocument(OPERATION_METRICS_COLLECTION, docId, fields);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.warn("[OPERATION_METRIC_WRITE_SKIPPED]", {
      area: input.area,
      operation: input.operation,
      reason: reason.slice(0, 180),
    });
  }
}

type MeasuredResult<T> = {
  value: T;
  resultCount?: number;
  requestedLimit?: number;
  hasNextPage?: boolean;
  cursorConsumed?: boolean;
  metadata?: Record<string, unknown>;
};

type MeasureContext = {
  area: OperationArea | string;
  operation: string;
  familyId?: string;
  userId?: string;
  requestedLimit?: number;
  metadata?: Record<string, unknown>;
};

/**
 * Time an async data-access function and record an operation metric for it.
 * On success the inner function returns the value plus the pagination signals
 * needed for risk detection; on error an `error` metric is recorded and the
 * error is rethrown so the route's own error handling is unchanged.
 */
export async function measureOperation<T>(
  context: MeasureContext,
  fn: () => Promise<MeasuredResult<T>>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    void recordOperationMetric({
      area: context.area,
      operation: context.operation,
      durationMs: Date.now() - startedAt,
      resultCount: result.resultCount,
      requestedLimit: result.requestedLimit ?? context.requestedLimit,
      hasNextPage: result.hasNextPage,
      cursorConsumed: result.cursorConsumed,
      familyId: context.familyId,
      userId: context.userId,
      metadata: { ...context.metadata, ...result.metadata },
    });
    return result.value;
  } catch (error) {
    const errorCode = error instanceof Error && error.message ? error.message.slice(0, 80) : "unknown";
    void recordOperationMetric({
      area: context.area,
      operation: context.operation,
      durationMs: Date.now() - startedAt,
      status: "error",
      errorCode,
      requestedLimit: context.requestedLimit,
      familyId: context.familyId,
      userId: context.userId,
      metadata: context.metadata,
    });
    throw error;
  }
}
