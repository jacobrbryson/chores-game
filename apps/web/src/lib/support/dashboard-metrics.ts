import { adminGetDocument } from "@/lib/firestore/admin";
import { readString, readTimestamp, type FirestoreValue } from "@/lib/firestore/rest";

export const SUPPORT_DASHBOARD_METRICS_DOC_PATH = "appConfig/supportDashboardMetrics";

export type SupportFamilyActivityPoint = {
  date: string;
  newFamilies: number;
  newUsers: number;
  choresCreated: number;
  routinesCreated: number;
  choresCompleted: number;
  routinesCompleted: number;
};

export type SupportDashboardMetrics = {
  familyActivity30DaySeries: SupportFamilyActivityPoint[];
  familyActivity30DayWindowStart: string;
  familyActivity30DayWindowEnd: string;
  updatedAt: string;
};

function buildEmptySeries(): SupportFamilyActivityPoint[] {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (29 - index));
    return {
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      newFamilies: 0,
      newUsers: 0,
      choresCreated: 0,
      routinesCreated: 0,
      choresCompleted: 0,
      routinesCompleted: 0,
    };
  });
}

export function defaultSupportDashboardMetrics(): SupportDashboardMetrics {
  const series = buildEmptySeries();
  return {
    familyActivity30DaySeries: series,
    familyActivity30DayWindowStart: series[0]?.date ?? "",
    familyActivity30DayWindowEnd: series[series.length - 1]?.date ?? "",
    updatedAt: "",
  };
}

function isFamilyActivityPoint(value: unknown): value is SupportFamilyActivityPoint {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const point = value as Record<string, unknown>;
  return (
    typeof point.date === "string" &&
    typeof point.newFamilies === "number" &&
    typeof point.newUsers === "number" &&
    typeof point.choresCreated === "number" &&
    typeof point.routinesCreated === "number" &&
    typeof point.choresCompleted === "number" &&
    typeof point.routinesCompleted === "number"
  );
}

export function parseSupportDashboardMetricsFields(
  fields: Record<string, FirestoreValue> | undefined,
): SupportDashboardMetrics {
  const fallback = defaultSupportDashboardMetrics();
  if (!fields) {
    return fallback;
  }

  let familyActivity30DaySeries = fallback.familyActivity30DaySeries;
  const seriesJson = readString(fields, "familyActivity30DaySeriesJson");
  if (seriesJson) {
    try {
      const parsed = JSON.parse(seriesJson) as unknown;
      if (Array.isArray(parsed) && parsed.every(isFamilyActivityPoint)) {
        familyActivity30DaySeries = parsed.map((entry) => ({
          date: entry.date,
          newFamilies: Math.max(0, Math.trunc(entry.newFamilies)),
          newUsers: Math.max(0, Math.trunc(entry.newUsers)),
          choresCreated: Math.max(0, Math.trunc(entry.choresCreated)),
          routinesCreated: Math.max(0, Math.trunc(entry.routinesCreated)),
          choresCompleted: Math.max(0, Math.trunc(entry.choresCompleted)),
          routinesCompleted: Math.max(0, Math.trunc(entry.routinesCompleted)),
        }));
      }
    } catch {
      familyActivity30DaySeries = fallback.familyActivity30DaySeries;
    }
  }

  return {
    familyActivity30DaySeries,
    familyActivity30DayWindowStart:
      readString(fields, "familyActivity30DayWindowStart") || fallback.familyActivity30DayWindowStart,
    familyActivity30DayWindowEnd:
      readString(fields, "familyActivity30DayWindowEnd") || fallback.familyActivity30DayWindowEnd,
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
