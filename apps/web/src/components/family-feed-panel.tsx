"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { FamilyMemberAvatar } from "@/components/family-member-avatar";
import { useLocale } from "@/components/locale-provider";
import { feedTypeEmoji, type FeedActionType, type FeedEventType } from "@/lib/feed/feed-events";

type FeedActor = {
  uid: string;
  name: string;
  avatarId: string;
  avatarPhotoUrl: string;
  primaryColor: string;
};

type FeedItem = {
  id: string;
  type: FeedEventType;
  title: string;
  message: string;
  actor: FeedActor | null;
  icon: string;
  action: FeedActionType | null;
  createdAt: string;
  sourceFamily: { id: string; name: string; isFriend: boolean };
  metadata: {
    choreId?: string;
    choreTitle?: string;
    rewardId?: string;
    rewardDescription?: string;
  };
};

type FeedResponse = {
  items: FeedItem[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
};

function formatRelativeTime(value: string, locale: string, fallback: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  const diffMs = parsed - Date.now();
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const divisions: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
    { amount: 60, unit: "second" },
    { amount: 60, unit: "minute" },
    { amount: 24, unit: "hour" },
    { amount: 7, unit: "day" },
    { amount: 4.34524, unit: "week" },
    { amount: 12, unit: "month" },
    { amount: Number.POSITIVE_INFINITY, unit: "year" },
  ];
  let duration = diffMs / 1000;
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return fallback;
}

function feedActionHref(action: FeedActionType | null): string | null {
  if (action === "view_chore") {
    return "/chores";
  }
  if (action === "view_reward") {
    return "/store";
  }
  return null;
}

function FeedSkeleton({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <section className="feed-list" aria-label={label} aria-hidden="true">
      {(compact ? [0, 1, 2] : [0, 1, 2, 3]).map((key) => (
        <div key={key} className="feed-card feed-card-skeleton">
          <div className="family-skeleton feed-skeleton-avatar" />
          <div className="feed-skeleton-body">
            <div className="family-skeleton family-skeleton-title" />
            <div className="family-skeleton family-skeleton-subtitle" />
          </div>
        </div>
      ))}
    </section>
  );
}

type FamilyFeedPanelProps = { scope?: "all" | "friends"; compact?: boolean };

export function FamilyFeedPanel({ scope = "all", compact = false }: FamilyFeedPanelProps) {
  const { locale, t } = useLocale();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [copyPendingId, setCopyPendingId] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const requestSeqRef = useRef(0);

  const loadFeed = useCallback(async (targetPage: number, mode: "replace" | "append") => {
    if (mode === "append") {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }
    setError("");
    requestSeqRef.current += 1;
    const requestSeq = requestSeqRef.current;
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        limit: compact ? "3" : "20",
      });
      if (scope === "friends") params.set("scope", "friends");
      const response = await fetch(`/api/feed?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `FEED_HTTP_${response.status}`);
      }
      if (requestSeq !== requestSeqRef.current) {
        return;
      }
      const payload = (await response.json()) as FeedResponse;
      const nextItems = payload.items ?? [];
      setItems((current) => (mode === "append" ? [...current, ...nextItems] : nextItems));
      setHasMore(Boolean(payload.pagination?.hasMore));
      setPage(payload.pagination?.page ?? targetPage);
    } catch (loadError) {
      if (requestSeq !== requestSeqRef.current) {
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "feed_unavailable");
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [compact, scope]);

  useEffect(() => {
    void loadFeed(1, "replace");
  }, [loadFeed]);

  // Lightweight realtime: FamilyCard's websocket subscriber already dispatches a
  // `notifications:refresh` window event when family activity arrives. The feed reuses it
  // to refresh from the top rather than opening a second socket.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handler = () => {
      void loadFeed(1, "replace");
    };
    window.addEventListener("notifications:refresh", handler);
    return () => window.removeEventListener("notifications:refresh", handler);
  }, [loadFeed]);

  if (isLoading) {
    return <FeedSkeleton label={t("feed.loading")} compact={compact} />;
  }

  if (error) {
    return <Alert>{t("feed.loadError", { error })}</Alert>;
  }

  if (items.length === 0) {
    if (compact) return null;
    return (
      <article className="family-panel feed-empty">
        <div className="feed-empty-emoji" aria-hidden="true">🎉</div>
        <h3>{t("feed.emptyTitle")}</h3>
        <p className="small">{t("feed.emptyBody")}</p>
      </article>
    );
  }

  async function copyFriendAward(item: FeedItem) {
    if (!item.metadata.rewardId || !item.sourceFamily.isFriend || copyPendingId) return;
    setCopyPendingId(item.id);
    setCopyNotice("");
    try {
      const response = await fetch("/api/family-friends/awards/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceFamilyId: item.sourceFamily.id,
          rewardId: item.metadata.rewardId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `FRIEND_AWARD_COPY_HTTP_${response.status}`);
      setCopyNotice("copied");
    } catch (copyError) {
      setCopyNotice(copyError instanceof Error ? copyError.message : "friend_award_copy_failed");
    } finally {
      setCopyPendingId("");
    }
  }

  return (
    <section className={compact ? "family-page-card mb-4" : ""} aria-label={compact ? t("familyFriends.latest.title") : t("feed.ariaLabel")}>
      {compact ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><h2>{t("familyFriends.latest.title")}</h2><p className="small">{t("familyFriends.latest.description")}</p></div>
          <Link href="/?tab=feed" className="feed-card-action">{t("familyFriends.latest.viewAll")}</Link>
        </div>
      ) : null}
      {copyNotice ? (
        <Alert tone={copyNotice === "copied" ? "success" : "warning"}>
          {copyNotice === "copied" ? t("familyFriends.awards.copied") : t("familyFriends.errors.action", { error: copyNotice })}
        </Alert>
      ) : null}
      <div className="feed-list">
      {items.map((item) => {
        // A completed chore is what a parent reviews in the Approval Inbox, so
        // deep-link those events straight there (the page redirects non-parents
        // home). Other chore/reward events keep their existing destinations.
        const isApprovalEvent = item.type === "chore_completed" && !item.sourceFamily.isFriend;
        const href = isApprovalEvent ? "/approvals" : feedActionHref(item.action);
        const actionLabel = isApprovalEvent
          ? t("feed.actions.reviewApproval")
          : item.action === "view_reward"
            ? t("feed.actions.viewReward")
            : t("feed.actions.viewChore");
        return (
          <article
            key={item.id}
            className={`feed-card${item.type === "title_unlocked" ? " feed-card-title-unlocked" : ""}`}>
            <div className="feed-card-icon">
              {item.actor ? (
                <FamilyMemberAvatar
                  name={item.actor.name}
                  avatarId={item.actor.avatarId || undefined}
                  avatarPhotoUrl={item.actor.avatarPhotoUrl || undefined}
                  primaryColor={item.actor.primaryColor || undefined}
                  size={40}
                  ariaHidden
                />
              ) : (
                <span className="feed-card-emoji" aria-hidden="true">
                  {feedTypeEmoji(item.type)}
                </span>
              )}
              <span className="feed-card-badge" aria-hidden="true">
                {feedTypeEmoji(item.type)}
              </span>
            </div>
            <div className="feed-card-body">
              <div className="feed-card-headline">
                <span className="feed-card-title">
                  {t(`feed.events.${item.type}`)}
                </span>
                <time className="feed-card-time" dateTime={item.createdAt}>
                  {formatRelativeTime(item.createdAt, locale, t("feed.justNow"))}
                </time>
              </div>
              {item.sourceFamily.isFriend ? (
                <p className="small font-semibold text-teal-700">
                  {t("familyFriends.feed.fromFamily", { family: item.sourceFamily.name })}
                </p>
              ) : null}
              {item.message ? <p className="feed-card-message">{item.message}</p> : null}
              {href ? (
                <Link href={href} className="feed-card-action">
                  {actionLabel}
                </Link>
              ) : null}
              {item.action === "copy_friend_award" && item.sourceFamily.isFriend && item.metadata.rewardId ? (
                <span title={copyPendingId ? t("familyFriends.disabled.actionPending") : undefined}>
                  <Button
                    type="button"
                    className="btn btn-primary mt-2"
                    disabled={Boolean(copyPendingId)}
                    onClick={() => void copyFriendAward(item)}>
                    {copyPendingId === item.id
                      ? t("familyFriends.awards.copying")
                      : t("familyFriends.awards.copy")}
                  </Button>
                </span>
              ) : null}
            </div>
          </article>
        );
      })}
      {hasMore ? (
        <div className="feed-load-more">
          <Button
            type="button"
            className="btn btn-secondary"
            disabled={isLoadingMore}
            onClick={() => loadFeed(page + 1, "append")}>
            {isLoadingMore ? t("feed.loadingMore") : t("feed.loadMore")}
          </Button>
        </div>
      ) : null}
      </div>
    </section>
  );
}
