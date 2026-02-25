"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { EnumChip, humanizeEnum } from "@/components/enum-chip";

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

function formatDateTime(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "-";
  }
  return new Date(parsed).toLocaleString();
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
  return "slate";
}

export function NotificationsPageClient({ initialUnseenOnly }: NotificationsPageClientProps) {
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
        await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: unseenIds }),
        });
        setItems((current) => current.map((entry) => ({ ...entry, seen: true })));
        setUnseenCount(0);
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
      return "Showing unseen activity.";
    }
    return unseenCount > 0
      ? `${unseenCount} unseen activit${unseenCount === 1 ? "y" : "ies"}`
      : "All activity";
  }, [unseenCount, unseenOnly]);

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
    <main className="panel family-page">
          <div className="notifications-header">
            <div className="page-header-inline">
              <BackLink className="page-back-link">{"<- Back"}</BackLink>
              <h1>Notifications</h1>
            </div>
            <div className="notifications-filters">
              <Button
                type="button"
                className={`notifications-filter-btn ${unseenOnly ? "is-active" : ""}`}
                onClick={() => {
                  setUnseenOnly(true);
                  setPage(1);
                  router.replace(`${pathname}?unseen=true`);
                }}>
                Unseen
              </Button>
              <Button
                type="button"
                className={`notifications-filter-btn ${!unseenOnly ? "is-active" : ""}`}
                onClick={() => {
                  setUnseenOnly(false);
                  setPage(1);
                  router.replace(pathname);
                }}>
                All
              </Button>
            </div>
          </div>
          <p className="small family-page-subhead">{subtitle}</p>
          <div className="table-controls">
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search notifications (3+ chars)"
              className="table-search-input"
            />
            {hasShortSearch ? <p className="small">Type at least 3 characters to filter.</p> : null}
          </div>

          {isLoading ? <p className="small">Loading notifications...</p> : null}
          {!isLoading && error ? (
            <p className="small family-error">Could not load notifications: {error}</p>
          ) : null}
          {!isLoading && !error ? (
            items.length === 0 ? (
              <p className="small">No notifications yet.</p>
            ) : (
              <>
                <div className="family-table-wrap">
                  <table className="family-table">
                    <thead>
                      <tr>
                        <th>
                          <button type="button" className="table-sort-btn" onClick={() => onSort("title")}>
                            {sortLabel("title", "Title")}
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort-btn" onClick={() => onSort("message")}>
                            {sortLabel("message", "Message")}
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort-btn" onClick={() => onSort("kind")}>
                            {sortLabel("kind", "Type")}
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort-btn" onClick={() => onSort("createdAt")}>
                            {sortLabel("createdAt", "When")}
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort-btn" onClick={() => onSort("seen")}>
                            {sortLabel("seen", "Seen")}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id} className={item.seen ? "" : "notifications-row-unseen"}>
                          <td>{item.title || "Activity"}</td>
                          <td>{item.message || "Activity logged."}</td>
                          <td>
                            <EnumChip
                              label={item.kind ? humanizeEnum(item.kind) : "-"}
                              tone={notificationKindTone(item.kind)}
                            />
                          </td>
                          <td>{formatDateTime(item.createdAt)}</td>
                          <td>
                            <EnumChip label={item.seen ? "Seen" : "Unseen"} tone={item.seen ? "teal" : "amber"} />
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
                    Previous
                  </Button>
                  <span className="small">
                    Page {page} of {totalPages} ({total})
                  </span>
                  <Button
                    type="button"
                    className="btn btn-secondary"
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                    Next
                  </Button>
                </div>
              </>
              )
          ) : null}
    </main>
  );
}
