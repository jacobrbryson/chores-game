import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { loadOperationMetrics, type OperationMetricFilters } from "@/lib/observability/query";
import { summarizeOperationMetrics } from "@/lib/observability/summary";

export const runtime = "nodejs";

const DEFAULT_RANGE_HOURS = 24;
const MAX_RANGE_HOURS = 30 * 24; // matches the 30-day retention ceiling
// How many records to return to the client after filtering. The dashboard tables
// only ever render the most recent slice; the summary is computed over the full
// filtered window before slicing.
const MAX_RESPONSE_RECORDS = 500;

const VALID_AREAS = new Set([
  "chores",
  "routines",
  "responsibility",
  "achievements",
  "notifications",
  "store",
  "feed",
  "support",
  "changelog",
]);

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonForbidden() {
  return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
}

function parseRangeHours(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RANGE_HOURS;
  }
  return Math.min(MAX_RANGE_HOURS, Math.trunc(parsed));
}

function parseStatus(value: string | null): "ok" | "error" | "slow" | undefined {
  return value === "ok" || value === "error" || value === "slow" ? value : undefined;
}

function parseBoolean(value: string | null): boolean {
  return value === "true" || value === "1";
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  // Server-side authorization — the UI also hides the tab, but the metrics must
  // never be reachable by a non-support user who calls the endpoint directly.
  if (!isSupportAdmin(session)) {
    return jsonForbidden();
  }

  const params = new URL(request.url).searchParams;
  const rangeHours = parseRangeHours(params.get("rangeHours"));
  const areaParam = (params.get("area") ?? "").trim();
  const filters: OperationMetricFilters = {
    sinceMillis: Date.now() - rangeHours * 60 * 60 * 1000,
    area: VALID_AREAS.has(areaParam) ? areaParam : undefined,
    status: parseStatus(params.get("status")),
    paginationRisksOnly: parseBoolean(params.get("paginationRisksOnly")),
    slowOnly: parseBoolean(params.get("slowOnly")),
  };

  try {
    const records = await loadOperationMetrics(filters);
    const summary = summarizeOperationMetrics(records);

    return NextResponse.json({
      summary,
      records: records.slice(0, MAX_RESPONSE_RECORDS),
      filters: {
        rangeHours,
        area: filters.area ?? "",
        status: filters.status ?? "",
        paginationRisksOnly: Boolean(filters.paginationRisksOnly),
        slowOnly: Boolean(filters.slowOnly),
      },
      counts: {
        returned: Math.min(records.length, MAX_RESPONSE_RECORDS),
        matched: records.length,
        maxResponseRecords: MAX_RESPONSE_RECORDS,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_OPERATIONS_ERROR]", reason.slice(0, 240));
    return NextResponse.json(
      {
        error: "operations_metrics_unavailable",
        message:
          "Operation metrics could not be loaded. Check service account credentials and Firestore access.",
      },
      { status: 500 },
    );
  }
}
