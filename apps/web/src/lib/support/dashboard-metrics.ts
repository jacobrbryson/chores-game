import { adminGetDocument } from "@/lib/firestore/admin";
import { readInteger, readString, readTimestamp, type FirestoreValue } from "@/lib/firestore/rest";

export const SUPPORT_DASHBOARD_METRICS_DOC_PATH = "appConfig/supportDashboardMetrics";

export type SupportAudit30DayPoint = {
  date: string;
  count: number;
};

export type SupportDashboardMetrics = {
  audit30DayTotal: number;
  audit30DaySeries: SupportAudit30DayPoint[];
  audit30DayWindowStart: string;
  audit30DayWindowEnd: string;
  updatedAt: string;
};

function buildEmptySeries() {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (29 - index));
    return {
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      count: 0,
    };
  });
}

export function defaultSupportDashboardMetrics(): SupportDashboardMetrics {
  const series = buildEmptySeries();
  return {
    audit30DayTotal: 0,
    audit30DaySeries: series,
    audit30DayWindowStart: series[0]?.date ?? "",
    audit30DayWindowEnd: series[series.length - 1]?.date ?? "",
    updatedAt: "",
  };
}

export function parseSupportDashboardMetricsFields(
  fields: Record<string, FirestoreValue> | undefined,
): SupportDashboardMetrics {
  const fallback = defaultSupportDashboardMetrics();
  if (!fields) {
    return fallback;
  }

  let audit30DaySeries = fallback.audit30DaySeries;
  const audit30DaySeriesJson = readString(fields, "audit30DaySeriesJson");
  if (audit30DaySeriesJson) {
    try {
      const parsed = JSON.parse(audit30DaySeriesJson) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.every(
          (entry) =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as { date?: unknown }).date === "string" &&
            typeof (entry as { count?: unknown }).count === "number",
        )
      ) {
        audit30DaySeries = parsed.map((entry) => ({
          date: String((entry as { date: string }).date),
          count: Math.max(0, Math.trunc((entry as { count: number }).count)),
        }));
      }
    } catch {
      audit30DaySeries = fallback.audit30DaySeries;
    }
  }

  return {
    audit30DayTotal: readInteger(fields, "audit30DayTotal"),
    audit30DaySeries,
    audit30DayWindowStart: readString(fields, "audit30DayWindowStart") || fallback.audit30DayWindowStart,
    audit30DayWindowEnd: readString(fields, "audit30DayWindowEnd") || fallback.audit30DayWindowEnd,
    updatedAt: readTimestamp(fields, "updatedAt"),
  };
}

export async function loadSupportDashboardMetrics(): Promise<SupportDashboardMetrics> {
  try {
    const doc = await adminGetDocument(SUPPORT_DASHBOARD_METRICS_DOC_PATH);
    return parseSupportDashboardMetricsFields(doc.fields);
  } catch {
    return defaultSupportDashboardMetrics();
  }
}
