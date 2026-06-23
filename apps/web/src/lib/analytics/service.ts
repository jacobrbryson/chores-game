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
import type { AnalyticsEventName } from "@/lib/analytics/events";

// The single analytics event store. Features never write here directly — they go
// through trackEvent/trackUserEvent/trackFamilyEvent so the schema, sanitization,
// and storage backend stay in one place. Writes use the admin/service-account
// credentials (Firestore rules deny all client access — see firestore.rules) so
// any user-scoped route can record an event regardless of the caller's role, and
// events without a familyId (signup, login) still land.
//
// The shape here is intentionally generic — id, event name, timestamp, a few
// indexable dimensions, and a free-form metadata map — so the collection can be
// mirrored 1:1 into a relational analytics_events table (id, event_name,
// created_at, family_id, user_id, role, platform, metadata_json) for future
// export to PostgreSQL, BigQuery, Athena, PostHog, or Mixpanel without touching
// any feature code.
export const ANALYTICS_EVENTS_COLLECTION = "analyticsEvents";

// Events are retained indefinitely for now (no TTL / expiresAt field). The
// generic, append-only schema means a future archiver can copy/age out rows by
// createdAt without a migration.

const MAX_METADATA_KEYS = 25;
const MAX_METADATA_STRING_LENGTH = 200;
// Drop any metadata key that could carry child-private data, free text, secrets,
// or contact info. Analytics is aggregate/observational — it must never become a
// backdoor store of PII. Matched case-insensitively against the key name.
const SENSITIVE_METADATA_KEY_PATTERN =
  /(token|auth|secret|password|cookie|session|email|description|body|content|note|message|title|name|address|phone|ssn|dob|birth|child|payload|header)/i;

export type AnalyticsMetadata = Record<string, string | number | boolean | null>;

export type AnalyticsEventInput = {
  event: AnalyticsEventName | string;
  familyId?: string;
  userId?: string;
  role?: string;
  platform?: string;
  metadata?: Record<string, unknown>;
};

// The canonical event shape, mirrored from a stored document. `id` and
// `timestamp` are assigned by the pipeline, never by callers.
export type AnalyticsEvent = {
  id: string;
  event: string;
  timestamp: string;
  familyId?: string;
  userId?: string;
  role?: string;
  platform?: string;
  metadata: AnalyticsMetadata;
};

/**
 * Strip anything that could expose sensitive personal data, free text, or
 * secrets from event metadata. Only short primitive values survive, and keys are
 * capped so a buggy caller cannot bloat an event document.
 */
export function sanitizeAnalyticsMetadata(metadata?: Record<string, unknown>): AnalyticsMetadata {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  const safe: AnalyticsMetadata = {};
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
    } else if (typeof value === "number" && Number.isFinite(value)) {
      safe[key] = value;
      count += 1;
    } else if (typeof value === "boolean") {
      safe[key] = value;
      count += 1;
    } else if (typeof value === "string") {
      safe[key] = value.slice(0, MAX_METADATA_STRING_LENGTH);
      count += 1;
    }
    // Objects, arrays, functions, symbols, undefined are intentionally dropped.
  }
  return safe;
}

function metadataToField(metadata: AnalyticsMetadata): FirestoreValue {
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
 * Build the Firestore field map for an analytics event. Exposed for unit tests
 * that assert the schema is stable and nothing sensitive is ever persisted.
 */
export function buildAnalyticsEventFields(
  input: AnalyticsEventInput,
  now: Date = new Date(),
): Record<string, FirestoreValue> {
  return {
    event: stringField(String(input.event).slice(0, 80)),
    familyId: stringField((input.familyId ?? "").slice(0, 120)),
    userId: stringField((input.userId ?? "").slice(0, 120)),
    role: stringField((input.role ?? "").slice(0, 40)),
    platform: stringField((input.platform ?? "web").slice(0, 40)),
    metadata: metadataToField(sanitizeAnalyticsMetadata(input.metadata)),
    createdAt: timestampField(now.toISOString()),
  };
}

/**
 * Record a single analytics event. Best-effort and non-blocking by contract:
 * every failure is swallowed (logged) so instrumentation can never break chore
 * completion, approvals, store purchases, or authentication. Callers may
 * `void trackEvent(...)` without awaiting when latency matters.
 */
export async function trackEvent(input: AnalyticsEventInput): Promise<void> {
  if (!input.event) {
    return;
  }
  try {
    const now = new Date();
    const docId = `${now.toISOString().replace(/[^0-9]/g, "")}_${randomUUID()}`;
    await adminCreateDocument(
      ANALYTICS_EVENTS_COLLECTION,
      docId,
      buildAnalyticsEventFields(input, now),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.warn("[ANALYTICS_EVENT_WRITE_SKIPPED]", {
      event: input.event,
      familyId: input.familyId ?? "",
      userId: input.userId ?? "",
      reason: reason.slice(0, 180),
    });
  }
}

/**
 * Convenience wrapper for an event attributed to a specific user. Thin sugar over
 * trackEvent so call sites read intent-first; same best-effort guarantee.
 */
export async function trackUserEvent(
  event: AnalyticsEventName | string,
  userId: string,
  input?: Omit<AnalyticsEventInput, "event" | "userId">,
): Promise<void> {
  await trackEvent({ ...input, event, userId });
}

/**
 * Convenience wrapper for a family-scoped event. Same best-effort guarantee.
 */
export async function trackFamilyEvent(
  event: AnalyticsEventName | string,
  familyId: string,
  input?: Omit<AnalyticsEventInput, "event" | "familyId">,
): Promise<void> {
  await trackEvent({ ...input, event, familyId });
}
