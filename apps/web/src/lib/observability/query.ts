import { adminRunQuery } from "@/lib/firestore/admin";
import {
  documentIdFromName,
  readBoolean,
  readInteger,
  readString,
  readTimestamp,
  type FirestoreDocument,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import { METRIC_COUNT_ABSENT, OPERATION_METRICS_COLLECTION } from "@/lib/observability/metrics";
import type { OperationMetricRecord } from "@/lib/observability/summary";

// Cap on how many recent records we pull into memory for a dashboard view. The
// read is a single ordered query over a bounded time window (uses the
// single-field index on createdAt); filtering by area/status/risk happens in
// memory so we don't need a composite index per filter combination.
export const OPERATION_METRICS_READ_CAP = 2000;

export type OperationMetricFilters = {
  sinceMillis: number;
  area?: string;
  status?: "ok" | "error" | "slow";
  paginationRisksOnly?: boolean;
  slowOnly?: boolean;
};

function readSignedCount(fields: Record<string, FirestoreValue> | undefined, key: string): number | null {
  const value = readInteger(fields, key);
  return value <= METRIC_COUNT_ABSENT ? null : value;
}

function readMetadata(
  fields: Record<string, FirestoreValue> | undefined,
): Record<string, string | number | boolean | null> {
  const value = fields?.metadata;
  if (!value || !("mapValue" in value)) {
    return {};
  }
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(value.mapValue.fields ?? {})) {
    if ("stringValue" in entry) {
      out[key] = entry.stringValue;
    } else if ("integerValue" in entry) {
      const parsed = Number(entry.integerValue);
      out[key] = Number.isFinite(parsed) ? parsed : 0;
    } else if ("booleanValue" in entry) {
      out[key] = entry.booleanValue;
    } else if ("nullValue" in entry) {
      out[key] = null;
    }
  }
  return out;
}

function normalizeStatus(value: string): "ok" | "error" | "slow" {
  return value === "error" || value === "slow" ? value : "ok";
}

export function normalizeOperationMetric(doc: FirestoreDocument): OperationMetricRecord {
  return {
    id: documentIdFromName(doc.name),
    area: readString(doc.fields, "area"),
    operation: readString(doc.fields, "operation"),
    durationMs: readInteger(doc.fields, "durationMs"),
    status: normalizeStatus(readString(doc.fields, "status")),
    slow: readBoolean(doc.fields, "slow"),
    resultCount: readSignedCount(doc.fields, "resultCount"),
    requestedLimit: readSignedCount(doc.fields, "requestedLimit"),
    hasNextPage: readBoolean(doc.fields, "hasNextPage"),
    paginationRisk: readBoolean(doc.fields, "paginationRisk"),
    riskReason: readString(doc.fields, "riskReason"),
    errorCode: readString(doc.fields, "errorCode"),
    familyId: readString(doc.fields, "familyId"),
    userId: readString(doc.fields, "userId"),
    metadata: readMetadata(doc.fields),
    createdAt: readTimestamp(doc.fields, "createdAt"),
  };
}

export function applyOperationMetricFilters(
  records: OperationMetricRecord[],
  filters: OperationMetricFilters,
): OperationMetricRecord[] {
  return records.filter((record) => {
    if (filters.area && record.area !== filters.area) {
      return false;
    }
    if (filters.status && record.status !== filters.status) {
      return false;
    }
    if (filters.paginationRisksOnly && !record.paginationRisk) {
      return false;
    }
    if (filters.slowOnly && !record.slow) {
      return false;
    }
    return true;
  });
}

/**
 * Load recent operation metrics for the dashboard. Reads a bounded, time-windowed
 * page ordered by createdAt (newest first) via admin credentials, then applies
 * the requested filters in memory.
 */
export async function loadOperationMetrics(
  filters: OperationMetricFilters,
): Promise<OperationMetricRecord[]> {
  const docs = await adminRunQuery({
    from: [{ collectionId: OPERATION_METRICS_COLLECTION }],
    where: {
      fieldFilter: {
        field: { fieldPath: "createdAt" },
        op: "GREATER_THAN_OR_EQUAL",
        value: { timestampValue: new Date(filters.sinceMillis).toISOString() },
      },
    },
    orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
    limit: OPERATION_METRICS_READ_CAP,
  });

  const records = docs.map(normalizeOperationMetric);
  return applyOperationMetricFilters(records, filters);
}
