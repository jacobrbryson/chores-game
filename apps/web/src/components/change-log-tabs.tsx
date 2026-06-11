"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AppTabs } from "@/components/app-tabs";
import { Button } from "@/components/button";
import { DiscoveryBadge } from "@/components/discovery-badge";
import { EnumChip } from "@/components/enum-chip";
import { useLocale } from "@/components/locale-provider";
import {
  getSectionCount,
  markDiscoverySeen,
  useDiscoverySummary,
} from "@/lib/hooks/use-discovery";

type TabId = "recent" | "requested";

type RequestedFilterId = "open" | "features" | "bugs" | "closed";

const REQUESTED_FILTERS: RequestedFilterId[] = ["open", "features", "bugs", "closed"];

const CLOSED_STATUSES: ReadonlySet<PublicRequestedChange["publicStatus"]> = new Set([
  "completed",
  "declined",
]);

function matchesRequestedFilter(rc: PublicRequestedChange, filter: RequestedFilterId) {
  switch (filter) {
    case "features":
      return rc.type === "feature";
    case "bugs":
      return rc.type === "bug";
    case "closed":
      return CLOSED_STATUSES.has(rc.publicStatus);
    case "open":
    default:
      return !CLOSED_STATUSES.has(rc.publicStatus);
  }
}

type PublicRequestedChange = {
  id: string;
  targetType: "public_support_request";
  targetId: string;
  type: "bug" | "feature";
  category: string;
  publicTitle: string;
  publicDescription: string;
  publicStatus: "under_review" | "planned" | "in_progress" | "completed" | "declined";
  upvoteCount: number;
  viewerVote: 1 | null;
  canVote: boolean;
};

type RequestedChangesResponse = {
  requests: PublicRequestedChange[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  error?: string;
};

function statusTone(status: PublicRequestedChange["publicStatus"]) {
  if (status === "completed") return "green";
  if (status === "declined") return "rose";
  if (status === "in_progress") return "amber";
  if (status === "planned") return "violet";
  return "blue";
}

function typeTone(type: PublicRequestedChange["type"]) {
  return type === "bug" ? "rose" : "violet";
}

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

function displayCategory(category: string, t: TranslateFn) {
  if (!category) {
    return t("changeLog.requested.uncategorized");
  }
  const key = `support.categories.${category}`;
  const translated = t(key);
  return translated === key ? category : translated;
}

function RequestedChangeCard({
  requestedChange,
  votePendingId,
  onVote,
  t,
}: {
  requestedChange: PublicRequestedChange;
  votePendingId: string;
  onVote: (rc: PublicRequestedChange) => void;
  t: TranslateFn;
}) {
  return (
    <article className="family-page-card change-log-card">
      <div className="change-log-copy">
        <div className="change-log-meta">
          <EnumChip
            label={t(`changeLog.requested.types.${requestedChange.type}`)}
            tone={typeTone(requestedChange.type)}
          />
          <EnumChip
            label={t(`changeLog.requested.status.${requestedChange.publicStatus}`)}
            tone={statusTone(requestedChange.publicStatus)}
          />
        </div>
        <h2>{requestedChange.publicTitle}</h2>
        <p className="change-log-description">{requestedChange.publicDescription}</p>
      </div>
      <div className="change-log-vote-box">
        {requestedChange.canVote ? (
          <Button
            className={`btn ${requestedChange.viewerVote ? "btn-primary" : "btn-secondary"}`}
            disabled={votePendingId === requestedChange.id}
            onClick={() => onVote(requestedChange)}
            aria-pressed={requestedChange.viewerVote === 1}
            title={t("changeLog.requested.upvote")}
          >
            {requestedChange.viewerVote ? t("changeLog.requested.upvoted") : t("changeLog.requested.upvote")}
          </Button>
        ) : null}
        <div
          className="small"
          title={!requestedChange.canVote ? t("changeLog.requested.loginToVote") : undefined}
          style={!requestedChange.canVote ? { cursor: "default" } : undefined}
        >
          {t("changeLog.requested.voteCount", { count: requestedChange.upvoteCount })}
        </div>
      </div>
    </article>
  );
}

function RequestedChangesGrouped({
  requests,
  votePendingId,
  onVote,
  t,
}: {
  requests: PublicRequestedChange[];
  votePendingId: string;
  onVote: (rc: PublicRequestedChange) => void;
  t: TranslateFn;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, PublicRequestedChange[]>();
    for (const req of requests) {
      const key = req.category || "";
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(req);
    }
    // Sort: named categories first (alphabetically by display name), then uncategorized last
    const sorted = [...map.entries()].sort(([a], [b]) => {
      if (!a && b) return 1;
      if (a && !b) return -1;
      return displayCategory(a, t).localeCompare(displayCategory(b, t));
    });
    return sorted;
  }, [requests, t]);

  if (groups.length === 1 && !groups[0][0]) {
    // All items are uncategorized — render flat without group headers
    return (
      <section className="change-log-list">
        {requests.map((rc) => (
          <RequestedChangeCard key={rc.id} requestedChange={rc} votePendingId={votePendingId} onVote={onVote} t={t} />
        ))}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map(([category, items]) => (
        <section key={category || "__none__"} className="space-y-3">
          <h3 className="change-log-category-heading">{displayCategory(category, t)}</h3>
          <div className="change-log-list">
            {items.map((rc) => (
              <RequestedChangeCard key={rc.id} requestedChange={rc} votePendingId={votePendingId} onVote={onVote} t={t} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RequestedChangesSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="chores-filter-pills">
        {[58, 82, 60, 70].map((width, index) => (
          <span
            key={index}
            className="family-skeleton change-log-filter-pill-skeleton"
            style={{ width }}
          />
        ))}
      </div>
      <section className="change-log-list">
        <article className="family-page-card change-log-card">
          <div className="family-skeleton family-skeleton-row" />
        </article>
        <article className="family-page-card change-log-card">
          <div className="family-skeleton family-skeleton-row" />
        </article>
      </section>
    </div>
  );
}

export function ChangeLogTabs({ recentContent }: { recentContent: ReactNode }) {
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<TabId>("recent");
  const [data, setData] = useState<RequestedChangesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasRequestedFetchAttempted, setHasRequestedFetchAttempted] = useState(false);
  const [error, setError] = useState("");
  const [votePendingId, setVotePendingId] = useState("");
  const [requestedFilter, setRequestedFilter] = useState<RequestedFilterId>("open");

  const filteredRequests = useMemo(
    () => (data?.requests ?? []).filter((rc) => matchesRequestedFilter(rc, requestedFilter)),
    [data, requestedFilter],
  );

  const filterCounts = useMemo(() => {
    const requests = data?.requests ?? [];
    return REQUESTED_FILTERS.reduce(
      (counts, filter) => {
        counts[filter] = requests.filter((rc) => matchesRequestedFilter(rc, filter)).length;
        return counts;
      },
      {} as Record<RequestedFilterId, number>,
    );
  }, [data]);

  const { summary: discoverySummary } = useDiscoverySummary(["changelog", "requested_changes"]);
  const recentCount = getSectionCount(discoverySummary, "changelog");
  const requestedCount = getSectionCount(discoverySummary, "requested_changes");

  const tabs = useMemo(
    () => [
      {
        id: "recent" as const,
        label: (
          <span className="change-log-tab-label">
            {t("changeLog.tabs.recent")}
            <DiscoveryBadge count={recentCount} />
          </span>
        ),
      },
      {
        id: "requested" as const,
        label: (
          <span className="change-log-tab-label">
            {t("changeLog.tabs.requested")}
            <DiscoveryBadge count={requestedCount} />
          </span>
        ),
      },
    ],
    [t, recentCount, requestedCount],
  );

  // Mark the active tab's discovery section seen on view (recent -> changelog,
  // requested -> requested_changes), clearing that tab's badge.
  useEffect(() => {
    void markDiscoverySeen([activeTab === "requested" ? "requested_changes" : "changelog"]);
  }, [activeTab]);

  const loadRequested = useCallback(async () => {
    setHasRequestedFetchAttempted(true);
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/change-log/requested?sort=most_voted", { cache: "no-store" });
      const json = (await response.json().catch(() => ({}))) as RequestedChangesResponse;
      if (!response.ok) {
        throw new Error(json.error ?? "requested_changes_unavailable");
      }
      setData(json);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "requested_changes_unavailable");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "requested" && !data && !isLoading && !hasRequestedFetchAttempted) {
      void loadRequested();
    }
  }, [activeTab, data, hasRequestedFetchAttempted, isLoading, loadRequested]);

  async function toggleVote(requestedChange: PublicRequestedChange) {
    if (!requestedChange.canVote || votePendingId) {
      return;
    }
    setVotePendingId(requestedChange.id);
    setError("");
    try {
      const response = await fetch("/api/votes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: requestedChange.targetType,
          targetId: requestedChange.targetId,
          value: 1,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        upvoteCount?: number;
        viewerVote?: 1 | null;
      };
      if (!response.ok) {
        throw new Error(json.error ?? "vote_failed");
      }
      setData((current) =>
        current
          ? {
              ...current,
              requests: current.requests.map((entry) =>
                entry.id === requestedChange.id
                  ? {
                      ...entry,
                      upvoteCount: json.upvoteCount ?? entry.upvoteCount,
                      viewerVote: json.viewerVote ?? null,
                    }
                  : entry,
              ),
            }
          : current,
      );
    } catch (voteError) {
      setError(voteError instanceof Error ? voteError.message : "vote_failed");
    } finally {
      setVotePendingId("");
    }
  }

  return (
    <main className="panel family-page family-page-shell">
      <AppTabs
        ariaLabel={t("changeLog.title")}
        tabs={tabs}
        activeTab={activeTab}
        onChange={setActiveTab}
      />
      {activeTab === "recent" ? <div className="mt-4">{recentContent}</div> : null}
      {activeTab === "requested" ? (
        <section className="mt-4 space-y-4" aria-label={t("changeLog.tabs.requested")}>
          {!isLoading && !error && data ? (
            <div className="chores-filter-pills" role="group" aria-label={t("changeLog.tabs.requested")}>
              {REQUESTED_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`chores-filter-pill${requestedFilter === filter ? " is-active" : ""}`}
                  aria-pressed={requestedFilter === filter}
                  onClick={() => setRequestedFilter(filter)}>
                  {t(`changeLog.requested.filters.${filter}`)}
                  <DiscoveryBadge count={filterCounts[filter]} />
                </button>
              ))}
            </div>
          ) : null}
          {isLoading ? <RequestedChangesSkeleton /> : null}
          {error ? (
            <section className="family-page-card change-log-empty-card">
              <p className="small text-rose-700">{t("changeLog.requested.loadError", { error })}</p>
              <Button
                className="btn btn-secondary mt-3"
                disabled={isLoading}
                onClick={() => {
                  setHasRequestedFetchAttempted(false);
                  setData(null);
                  setError("");
                }}
              >
                {t("common.actions.retry")}
              </Button>
            </section>
          ) : null}
          {!isLoading && data?.requests.length === 0 ? (
            <section className="family-page-card change-log-empty-card">
              <p className="small">{t("changeLog.requested.empty")}</p>
            </section>
          ) : null}
          {!isLoading && data && data.requests.length > 0 && filteredRequests.length === 0 ? (
            <section className="family-page-card change-log-empty-card">
              <p className="small">{t("changeLog.requested.filters.empty")}</p>
            </section>
          ) : null}
          {!isLoading && filteredRequests.length ? (
            <RequestedChangesGrouped
              requests={filteredRequests}
              votePendingId={votePendingId}
              onVote={(rc) => void toggleVote(rc)}
              t={t}
            />
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
