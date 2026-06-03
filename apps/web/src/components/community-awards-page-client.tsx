"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { CoinIcon } from "@/components/coin-icon";
import { useLocale } from "@/components/locale-provider";

type CommunityAward = {
  id: string;
  publicTitle: string;
  publicDescription: string;
  publicCoinAmount: number;
  publicImage: string;
  publicImagePath: string;
  publicCategory: string;
  publicTags: string[];
  voteCount: number;
  copyCount: number;
  viewerVote: 1 | null;
};

type CommunityAwardsResponse = {
  awards: CommunityAward[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

const SORT_OPTIONS = ["most_popular", "newest"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

type CommunityAwardsLibraryProps = {
  embedded?: boolean;
};

export function CommunityAwardsLibrary({ embedded = false }: CommunityAwardsLibraryProps) {
  const { t } = useLocale();
  const [payload, setPayload] = useState<CommunityAwardsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("most_popular");
  const [page, setPage] = useState(1);
  const [pendingId, setPendingId] = useState("");
  const [notice, setNotice] = useState("");

  const params = useMemo(() => {
    const next = new URLSearchParams();
    next.set("page", String(page));
    next.set("limit", "12");
    next.set("sort", sort);
    if (submittedQuery.trim()) {
      next.set("q", submittedQuery.trim());
    }
    return next;
  }, [page, sort, submittedQuery]);

  const loadAwards = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/community/awards?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `COMMUNITY_AWARDS_HTTP_${response.status}`);
      }
      setPayload((await response.json()) as CommunityAwardsResponse);
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : "community_awards_unavailable");
    } finally {
      setIsLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void loadAwards();
  }, [loadAwards]);

  async function vote(award: CommunityAward) {
    if (pendingId) return;
    setPendingId(`vote:${award.id}`);
    setError("");
    try {
      const response = await fetch("/api/votes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "community_award", targetId: award.id, value: 1 }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `VOTE_HTTP_${response.status}`);
      }
      await loadAwards();
    } catch (voteError) {
      setError(voteError instanceof Error ? voteError.message : "vote_failed");
    } finally {
      setPendingId("");
    }
  }

  async function copyAward(award: CommunityAward) {
    if (pendingId) return;
    setPendingId(`copy:${award.id}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/community/awards/${encodeURIComponent(award.id)}/copy`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `COPY_HTTP_${response.status}`);
      }
      setNotice(t("communityAwards.copySuccess"));
      await loadAwards();
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "copy_failed");
    } finally {
      setPendingId("");
    }
  }

  const content = (
    <>
      <div className="page-header-row">
        <div>
          {embedded ? <h2>{t("communityAwards.title")}</h2> : <h1>{t("communityAwards.title")}</h1>}
          <p className="small family-page-subhead">{t("communityAwards.subtitle")}</p>
        </div>
      </div>

      <form
        className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSubmittedQuery(query);
        }}>
        <input
          type="search"
          className="table-search-input w-full"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("communityAwards.searchPlaceholder")}
          aria-label={t("communityAwards.searchLabel")}
        />
        <select
          value={sort}
          onChange={(event) => {
            setPage(1);
            setSort(event.target.value as SortOption);
          }}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
          {SORT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`communityAwards.sort.${option}`)}
            </option>
          ))}
        </select>
        <Button type="submit" className="btn btn-primary">
          {t("communityAwards.search")}
        </Button>
      </form>

      {notice ? <Alert tone="success" role="status" className="mb-4">{notice}</Alert> : null}
      {error ? <Alert className="mb-4">{t("communityAwards.loadError", { error })}</Alert> : null}

      {isLoading ? (
        <div className="store-grid" aria-label={t("common.status.loading")} aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <article key={index} className="store-card">
              <div className="family-skeleton family-skeleton-reward" />
              <div className="family-skeleton family-skeleton-title mt-3" />
              <div className="family-skeleton family-skeleton-subtitle mt-2" />
              <div className="family-skeleton family-skeleton-button mt-3" />
            </article>
          ))}
        </div>
      ) : null}

      {!isLoading && payload?.awards.length === 0 ? (
        <Alert tone="info" role="status">{t("communityAwards.empty")}</Alert>
      ) : null}

      {!isLoading && payload?.awards.length ? (
        <>
          <section className="store-grid" aria-label={t("communityAwards.title")}>
            {payload.awards.map((award) => (
              <article key={award.id} className="store-card">
                <Image
                  src={award.publicImagePath || "/rewards/screens.png"}
                  alt=""
                  width={320}
                  height={180}
                  className="store-card-image"
                />
                <h3>{award.publicTitle}</h3>
                <p className="small">{award.publicDescription}</p>
                <p className="small">
                  <CoinIcon size={14} /> {t("communityAwards.coinAmount", { coins: award.publicCoinAmount })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {award.publicCategory ? (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                      {award.publicCategory}
                    </span>
                  ) : null}
                  {award.publicTags.map((tag) => (
                    <span key={tag} className="rounded-full bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="small">
                  {t("communityAwards.metrics", { votes: award.voteCount, copies: award.copyCount })}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className={award.viewerVote ? "btn btn-secondary" : "btn btn-primary"}
                    disabled={Boolean(pendingId)}
                    onClick={() => void vote(award)}>
                    {pendingId === `vote:${award.id}`
                      ? t("communityAwards.voting")
                      : award.viewerVote
                        ? t("communityAwards.voted")
                        : t("communityAwards.vote")}
                  </Button>
                  <Button
                    type="button"
                    className="btn btn-secondary"
                    disabled={Boolean(pendingId)}
                    onClick={() => void copyAward(award)}>
                    {pendingId === `copy:${award.id}` ? t("communityAwards.copying") : t("communityAwards.copy")}
                  </Button>
                </div>
              </article>
            ))}
          </section>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-600">
            <span>
              {t("communityAwards.pageOf", {
                page: payload.pagination.page,
                totalPages: payload.pagination.totalPages,
                total: payload.pagination.total,
              })}
            </span>
            <div className="flex gap-2">
              <Button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {t("notifications.pager.previous")}
              </Button>
              <Button
                type="button"
                className="btn btn-secondary"
                disabled={page >= payload.pagination.totalPages}
                onClick={() => setPage(page + 1)}>
                {t("notifications.pager.next")}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <section className="community-awards-embedded" aria-label={t("communityAwards.title")}>
        {content}
      </section>
    );
  }

  return <main className="family-page">{content}</main>;
}

export function CommunityAwardsPageClient() {
  return <CommunityAwardsLibrary />;
}
