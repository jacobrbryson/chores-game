import { adminRunQuery } from "@/lib/firestore/admin";
import {
  documentIdFromName,
  firestoreValueToPlain,
  readString,
  readTimestamp,
  type FirestoreDocument,
} from "@/lib/firestore/rest";
import { ANALYTICS_EVENTS_COLLECTION, type AnalyticsEvent, type AnalyticsMetadata } from "@/lib/analytics/service";

// Cap on how many recent events we pull into memory for the support validation
// page. The read is a single ordered query over createdAt (uses the single-field
// index); counting/grouping happens in memory. The summary discloses the cap so
// operators know whether totals are exact or a recent-window sample.
export const ANALYTICS_READ_CAP = 5000;

const RECENT_EVENTS_LIMIT = 50;
const TOP_EVENTS_LIMIT = 15;

export type AnalyticsSummary = {
  scanned: number;
  scanCap: number;
  capped: boolean;
  totalEvents: number;
  eventsToday: number;
  topEvents: Array<{ event: string; count: number }>;
  recentEvents: AnalyticsEvent[];
};

function readMetadata(doc: FirestoreDocument): AnalyticsMetadata {
  const value = doc.fields?.metadata;
  if (!value || !("mapValue" in value)) {
    return {};
  }
  const out: AnalyticsMetadata = {};
  for (const [key, entry] of Object.entries(value.mapValue.fields ?? {})) {
    const plain = firestoreValueToPlain(entry);
    if (
      plain === null ||
      typeof plain === "string" ||
      typeof plain === "number" ||
      typeof plain === "boolean"
    ) {
      out[key] = plain;
    }
  }
  return out;
}

export function normalizeAnalyticsEvent(doc: FirestoreDocument): AnalyticsEvent {
  return {
    id: documentIdFromName(doc.name),
    event: readString(doc.fields, "event"),
    timestamp: readTimestamp(doc.fields, "createdAt"),
    familyId: readString(doc.fields, "familyId") || undefined,
    userId: readString(doc.fields, "userId") || undefined,
    role: readString(doc.fields, "role") || undefined,
    platform: readString(doc.fields, "platform") || undefined,
    metadata: readMetadata(doc),
  };
}

function startOfTodayMillis(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Load the support Analytics validation summary: total events, events today,
 * the most frequent event names, and the most recent events. Reads a bounded,
 * newest-first page via admin credentials and aggregates in memory.
 */
export async function loadAnalyticsSummary(now: Date = new Date()): Promise<AnalyticsSummary> {
  const docs = await adminRunQuery({
    from: [{ collectionId: ANALYTICS_EVENTS_COLLECTION }],
    orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
    limit: ANALYTICS_READ_CAP,
  });

  const events = docs.map(normalizeAnalyticsEvent);
  const todayCutoff = startOfTodayMillis(now);

  const countsByEvent = new Map<string, number>();
  let eventsToday = 0;
  for (const event of events) {
    countsByEvent.set(event.event, (countsByEvent.get(event.event) ?? 0) + 1);
    const millis = Date.parse(event.timestamp);
    if (Number.isFinite(millis) && millis >= todayCutoff) {
      eventsToday += 1;
    }
  }

  const topEvents = Array.from(countsByEvent.entries())
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_EVENTS_LIMIT);

  return {
    scanned: events.length,
    scanCap: ANALYTICS_READ_CAP,
    capped: events.length >= ANALYTICS_READ_CAP,
    totalEvents: events.length,
    eventsToday,
    topEvents,
    recentEvents: events.slice(0, RECENT_EVENTS_LIMIT),
  };
}
