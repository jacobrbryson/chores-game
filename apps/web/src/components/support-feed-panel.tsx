"use client";

import { useMemo } from "react";
import { mapNotificationKindToFeedType, type FeedEventType } from "@/lib/feed/feed-events";

// Internal operator diagnostics for the Family Activity Feed. The feed reuses the
// immutable family activity notification records, so this panel reports on those records
// mapped through the same feed-type allowlist the live feed uses. English-only, matching
// the rest of the /support operator console.

type SupportFeedEvent = {
  kind: "audit" | "notification";
  eventType: string;
  createdAt: string;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const FEED_TYPE_LABELS: Record<FeedEventType, string> = {
  chore_created: "Chore created",
  chore_completed: "Chore completed",
  chore_approved: "Chore approved",
  chore_rejected: "Chore rejected",
  reward_claimed: "Reward redeemed",
  routine_created: "Routine created",
  routine_assigned: "Routine assigned",
  routine_completed: "Routine completed",
  title_unlocked: "Title unlocked",
  family_award_created: "Family Award created",
};

export function SupportFeedPanel({ events }: { events: SupportFeedEvent[] }) {
  const summary = useMemo(() => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    const counts = new Map<FeedEventType, number>();
    let recentTotal = 0;
    for (const event of events) {
      if (event.kind !== "notification") {
        continue;
      }
      const feedType = mapNotificationKindToFeedType(event.eventType);
      if (!feedType) {
        continue;
      }
      const millis = Date.parse(event.createdAt);
      if (!Number.isFinite(millis) || millis < cutoff) {
        continue;
      }
      recentTotal += 1;
      counts.set(feedType, (counts.get(feedType) ?? 0) + 1);
    }
    const byType = [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
    return { recentTotal, byType };
  }, [events]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">Family Activity Feed</h2>
        <span className="rounded-full bg-rose-100 px-3 py-1 text-sm font-semibold text-rose-700">
          {summary.recentTotal} feed events (last 7 days)
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Derived from family activity notification records mapped to feed event types. The feed is
        family-scoped and never exposes support/admin-only activity.
      </p>
      {summary.byType.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {summary.byType.map((entry) => (
            <div
              key={entry.type}
              className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <span className="text-sm font-medium text-slate-700">{FEED_TYPE_LABELS[entry.type]}</span>
              <span className="text-sm font-bold text-slate-900">{entry.count}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">No feed events in the last 7 days of loaded data.</p>
      )}
    </section>
  );
}
