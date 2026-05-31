"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { EnumChip, humanizeEnum } from "@/components/enum-chip";
import { useLocale } from "@/components/locale-provider";

type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  message: string;
  createdAt: string;
  seen: boolean;
  triggeredByViewer: boolean;
};

type NotificationsResponse = {
  notifications: NotificationItem[];
  unseenCount: number;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type NotificationsPageClientProps = {
  initialUnseenOnly: boolean;
};
type NotificationSortBy = "createdAt" | "title" | "message" | "seen" | "kind";

function formatDateTime(value: string, locale: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "-";
  }
  return new Date(parsed).toLocaleString(locale);
}

function notificationKindTone(kind: string) {
  if (kind === "chore_completed") {
    return "green";
  }
  if (kind === "chore_undo_completed") {
    return "amber";
  }
  if (kind === "chore_created") {
    return "blue";
  }
  if (kind === "chore_edited") {
    return "indigo";
  }
  if (kind === "chore_deleted") {
    return "rose";
  }
  if (kind === "reward_claimed") {
    return "amber";
  }
  return "slate";
}

export function NotificationsPageClient({ initialUnseenOnly }: NotificationsPageClientProps) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [unseenOnly, setUnseenOnly] = useState(initialUnseenOnly);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [unseenCount, setUnseenCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<NotificationSortBy>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const requestSeqRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const shouldApplySearch = query.trim().length >= 3;
  const hasShortSearch = searchInput.trim().length > 0 && searchInput.trim().length < 3;

  async function loadNotifications() {
    setIsLoading(true);
    setError("");
    requestSeqRef.current += 1;
    const requestSeq = requestSeqRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    try {
      const params = new URLSearchParams();
      params.set("unseen", unseenOnly ? "true" : "false");
      params.set("page", String(page));
      params.set("limit", String(pageSize));
      params.set("sortBy", sortBy);
      params.set("sortDir", sortDir);
      if (shouldApplySearch) {
        params.set("q", query.trim());
      }
      const response = await fetch(`/api/notifications?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `NOTIFICATIONS_HTTP_${response.status}`);
      }
      if (requestSeq !== requestSeqRef.current) {
        return;
      }
      const payload = (await response.json()) as NotificationsResponse;
      const notifications = payload.notifications ?? [];
      setItems(notifications);
      setUnseenCount(payload.unseenCount ?? 0);
      setPage(payload.pagination?.page ?? page);
      setTotal(payload.pagination?.total ?? notifications.length);
      setTotalPages(payload.pagination?.totalPages ?? 1);
      if (unseenOnly && notifications.length > 0) {
        const unseenIds = notifications.map((entry) => entry.id);
        const markSeenResponse = await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: unseenIds }),
        });
        if (!markSeenResponse.ok) {
          const body = (await markSeenResponse.json()) as { error?: string };
          throw new Error(body.error ?? `NOTIFICATIONS_PATCH_HTTP_${markSeenResponse.status}`);
        }
        setItems((current) => current.map((entry) => ({ ...entry, seen: true })));
        setUnseenCount(0);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("notifications:refresh"));
        }
      }
    } catch (loadError) {
      if (controller.signal.aborted) {
        return;
      }
      const message =
        loadError instanceof Error ? loadError.message : "notifications_unavailable";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadNotifications();
  }, [page, query, sortBy, sortDir, unseenOnly]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setQuery(searchInput.trim());
    }, 220);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const subtitle = useMemo(() => {
    if (unseenOnly) {
      return t("notificationsPage.subtitle.unseen");
    }
    return unseenCount > 0
      ? t("notificationsPage.subtitle.unseenCount", {
          count: unseenCount,
          suffix: unseenCount === 1 ? "y" : "ies",
        })
      : t("notificationsPage.subtitle.all");
  }, [t, unseenCount, unseenOnly]);

  const sortLabel = useMemo(
    () => (column: NotificationSortBy, label: string) =>
      sortBy === column ? `${label} ${sortDir === "asc" ? "↑" : "↓"}` : label,
    [sortBy, sortDir],
  );

  function onSort(column: NotificationSortBy) {
    setPage(1);
    setSortDir((currentDir) =>
      sortBy === column ? (currentDir === "asc" ? "desc" : "asc") : "asc",
    );
    setSortBy(column);
  }

  return (
    <main className="panel family-page family-page-shell">
      <div className="notifications-header">
        <div className="notifications-filters">
          <Button
            type="button"
            className={`notifications-filter-btn ${unseenOnly ? "is-active" : ""}`}
            onClick={() => {
              setUnseenOnly(true);
              setPage(1);
              router.replace(`${pathname}?unseen=true`);
            }}>
            {t("notificationsPage.filters.unseen")}
          </Button>
          <Button
            type="button"
            className={`notifications-filter-btn ${!unseenOnly ? "is-active" : ""}`}
            onClick={() => {
              setUnseenOnly(false);
              setPage(1);
              router.replace(pathname);
            }}>
            {t("notificationsPage.filters.all")}
          </Button>
        </div>
      </div>
      <p className="small family-page-subhead">{subtitle}</p>
      <div className="table-controls">
        <input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={t("notificationsPage.search.placeholder")}
          className="table-search-input"
          aria-label={t("notificationsPage.search.ariaLabel")}
        />
        {hasShortSearch ? <p className="small">{t("notificationsPage.search.minimum")}</p> : null}
      </div>

      {isLoading ? (
        <section aria-label={t("notificationsPage.loading")} aria-hidden="true" className="space-y-3">
          <div className="family-skeleton-chip-row">
            <div className="family-skeleton family-skeleton-chip" />
            <div className="family-skeleton family-skeleton-chip" />
          </div>
          <div className="family-table-wrap">
            <table className="family-table">
              <thead>
                <tr>
                  <th><div className="family-skeleton family-skeleton-title" /></th>
                  <th><div className="family-skeleton family-skeleton-title" /></th>
                  <th><div className="family-skeleton family-skeleton-title" /></th>
                  <th><div className="family-skeleton family-skeleton-title" /></th>
                  <th><div className="family-skeleton family-skeleton-title" /></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={5}><div className="family-skeleton family-skeleton-row" /></td>
                </tr>
                <tr>
                  <td colSpan={5}><div className="family-skeleton family-skeleton-row" /></td>
                </tr>
                <tr>
                  <td colSpan={5}><div className="family-skeleton family-skeleton-row" /></td>
                </tr>
                <tr>
                  <td colSpan={5}><div className="family-skeleton family-skeleton-row" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {!isLoading && error ? (
        <Alert>{t("notificationsPage.loadError", { error })}</Alert>
      ) : null}
      {!isLoading && !error ? (
        items.length === 0 ? (
          <p className="small">{t("notificationsPage.empty")}</p>
        ) : (
          <>
            <div className="family-table-wrap">
              <table className="family-table">
                <thead>
                  <tr>
                    <th>
                      <button type="button" className="table-sort-btn" onClick={() => onSort("title")}>
                        {sortLabel("title", t("notificationsPage.columns.title"))}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort-btn" onClick={() => onSort("message")}>
                        {sortLabel("message", t("notificationsPage.columns.message"))}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort-btn" onClick={() => onSort("kind")}>
                        {sortLabel("kind", t("notificationsPage.columns.type"))}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort-btn" onClick={() => onSort("createdAt")}>
                        {sortLabel("createdAt", t("notificationsPage.columns.when"))}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="table-sort-btn" onClick={() => onSort("seen")}>
                        {sortLabel("seen", t("notificationsPage.columns.seen"))}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={item.seen ? "" : "notifications-row-unseen"}>
                      <td>{item.title || t("notificationsPage.fallback.title")}</td>
                      <td>{item.message || t("notificationsPage.fallback.message")}</td>
                      <td>
                        <EnumChip
                          label={item.kind ? humanizeEnum(item.kind) : "-"}
                          tone={notificationKindTone(item.kind)}
                        />
                      </td>
                      <td>{formatDateTime(item.createdAt, locale)}</td>
                      <td>
                        <EnumChip
                          label={item.seen ? t("notificationsPage.status.seen") : t("notificationsPage.status.unseen")}
                          tone={item.seen ? "teal" : "amber"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-pager">
              <Button
                type="button"
                className="btn btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}>
                {t("notificationsPage.pager.previous")}
              </Button>
              <span className="small">
                {t("notificationsPage.pager.pageOf", { page, totalPages, total })}
              </span>
              <Button
                type="button"
                className="btn btn-secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                {t("notificationsPage.pager.next")}
              </Button>
            </div>
          </>
        )
      ) : null}
    </main>
  );
}
