"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { useLocale } from "@/components/locale-provider";
import { TodayChoresPanel } from "@/components/today-chores-panel";
import type { FamilySnapshotChore, FamilySummaryResponse } from "@/lib/family/types";
import { connectFamilySocket, type FamilyActivityEvent } from "@/lib/ws";

export function FamilyCard() {
  const { t } = useLocale();
  const [summary, setSummary] = useState<FamilySummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [acceptInviteError, setAcceptInviteError] = useState("");
  const [completionStatsReloadKey, setCompletionStatsReloadKey] = useState(0);
  const silentRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const needsReauth =
    error === "reauth_required" ||
    error === "missing_firebase_session" ||
    error === "SUMMARY_HTTP_401";
  const firestoreNotConfigured = error === "firestore_not_configured";
  const firestoreForbidden = error === "firestore_forbidden";
  const viewerUid = summary?.viewerUid ?? "";
  const viewerRole =
    summary?.members.find((member) => member.uid === viewerUid || member.id === viewerUid)
      ?.role ?? "player";
  const viewerAssigneeIds =
    summary?.viewerAssigneeAliases?.filter((value) => value.trim().length > 0) ??
    summary?.members
      .filter((member) => member.uid === viewerUid || member.id === viewerUid)
      .flatMap((member) => [member.id, member.uid ?? "", member.email.trim().toLowerCase()])
      .filter((value) => value.length > 0) ??
    [viewerUid].filter(Boolean);
  const familyId = summary?.family?.id ?? "";

  function toFamilySnapshotStatus(value: string): FamilySnapshotChore["status"] {
    if (value === "Open" || value === "Submitted" || value === "Approved" || value === "Rejected") {
      return value;
    }
    return "Unknown";
  }

  function sortTodayChores(items: FamilySnapshotChore[]) {
    return [...items].sort((a, b) => {
      const aHasSortOrder = typeof a.sortOrder === "number";
      const bHasSortOrder = typeof b.sortOrder === "number";
      const aSortOrder = aHasSortOrder ? (a.sortOrder as number) : -1;
      const bSortOrder = bHasSortOrder ? (b.sortOrder as number) : -1;
      if (aHasSortOrder && bHasSortOrder && aSortOrder !== bSortOrder) {
        return aSortOrder - bSortOrder;
      }
      if (aHasSortOrder && !bHasSortOrder) {
        return -1;
      }
      if (!aHasSortOrder && bHasSortOrder) {
        return 1;
      }
      const createdDiff =
        (Number.isNaN(Date.parse(a.createdAt || "")) ? 0 : Date.parse(a.createdAt || "")) -
        (Number.isNaN(Date.parse(b.createdAt || "")) ? 0 : Date.parse(b.createdAt || ""));
      if (createdDiff !== 0) {
        return createdDiff;
      }
      return a.id.localeCompare(b.id);
    });
  }

  const upsertTodayChore = useCallback((nextChore: FamilySnapshotChore | null) => {
    setSummary((current) => {
      if (!current) {
        return current;
      }
      const withoutCurrent = current.choresToday.filter((entry) => entry.id !== nextChore?.id);
      if (!nextChore) {
        return { ...current, choresToday: withoutCurrent };
      }
      return {
        ...current,
        choresToday: sortTodayChores([...withoutCurrent, nextChore]),
      };
    });
  }, []);

  const removeTodayChore = useCallback((choreId: string) => {
    setSummary((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        choresToday: current.choresToday.filter((entry) => entry.id !== choreId),
      };
    });
  }, []);

  const refreshTodayChoreFromApi = useCallback(async (choreId: string) => {
    try {
      const response = await fetch(`/api/chores/${choreId}`, { cache: "no-store" });
      if (!response.ok) {
        removeTodayChore(choreId);
        return;
      }
      const payload = (await response.json()) as {
        chore?: {
          id: string;
          title: string;
          status: string;
          source?: "manual" | "google_tasks";
          sortOrder?: number;
          assigneeId?: string;
          assigneeIds?: string[];
          assigneeScope?: "single" | "multiple" | "family";
          assigneeName: string;
          assigneePrimaryColor?: string;
          assigneeAvatarId?: string;
          assigneeAvatarPhotoUrl?: string;
          dueDate: string;
          details?: string;
          categoryIds?: string[];
          categories?: { id: string; name: string; color: string }[];
          coinValue: number;
          requireApproval?: boolean;
          recurrenceType?: FamilySnapshotChore["recurrenceType"];
          recurrenceInterval?: number;
          recurrenceUnit?: FamilySnapshotChore["recurrenceUnit"];
          createdAt?: string;
        };
      };
      const chore = payload.chore;
      if (!chore) {
        removeTodayChore(choreId);
        return;
      }
      const normalized = {
        id: chore.id,
        title: chore.title,
        sortOrder: typeof chore.sortOrder === "number" ? chore.sortOrder : undefined,
        assigneeId: chore.assigneeId,
        assigneeIds: Array.isArray(chore.assigneeIds) ? chore.assigneeIds : [],
        assigneeScope: chore.assigneeScope,
        assigneeName: chore.assigneeName || "Unassigned",
        assigneePrimaryColor: chore.assigneePrimaryColor,
        assigneeAvatarId: chore.assigneeAvatarId,
        assigneeAvatarPhotoUrl: chore.assigneeAvatarPhotoUrl,
        dueDate: chore.dueDate,
        details: chore.details,
        categoryIds: Array.isArray(chore.categoryIds) ? chore.categoryIds : [],
        categories: Array.isArray(chore.categories) ? chore.categories : [],
        coinValue: chore.coinValue,
        requireApproval: Boolean(chore.requireApproval),
        recurrenceType: chore.recurrenceType,
        recurrenceInterval: chore.recurrenceInterval,
        recurrenceUnit: chore.recurrenceUnit,
        createdAt: chore.createdAt,
        source: chore.source,
        status: toFamilySnapshotStatus(chore.status),
      } satisfies FamilySnapshotChore;
      if (normalized.status !== "Open") {
        removeTodayChore(choreId);
        return;
      }
      upsertTodayChore(normalized);
    } catch {
      // Keep current local state on transient realtime sync failure.
    }
  }, [removeTodayChore, upsertTodayChore]);

  const loadSummary = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setIsLoading(true);
    }
    setError("");
    try {
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      const response = await fetch(`/api/family/summary?tzOffsetMinutes=${tzOffsetMinutes}`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `SUMMARY_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as FamilySummaryResponse;
      setSummary(payload);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "summary_unavailable";
      setError(message);
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, []);

  const queueSilentSummaryRefresh = useCallback(() => {
    if (silentRefreshTimerRef.current) {
      return;
    }
    silentRefreshTimerRef.current = setTimeout(() => {
      silentRefreshTimerRef.current = null;
      void loadSummary({ silent: true });
    }, 120);
  }, [loadSummary]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    return () => {
      if (silentRefreshTimerRef.current) {
        clearTimeout(silentRefreshTimerRef.current);
        silentRefreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!familyId || !summary?.wsAuthToken) {
      return;
    }
    const socket = connectFamilySocket({
      authToken: summary.wsAuthToken,
    });
    if (!socket) {
      return;
    }

    const onFamilyActivity = (event: FamilyActivityEvent) => {
      if (event.familyId !== familyId) {
        return;
      }
      if (
        event.type === "chore_completed" ||
        event.type === "chore_deleted" ||
        event.type === "chore_updated"
      ) {
        setCompletionStatsReloadKey((current) => current + 1);
      }
      if (
        event.type === "theme_changed" ||
        event.type === "avatar_changed" ||
        event.type === "chore_reordered"
      ) {
        queueSilentSummaryRefresh();
        return;
      }
      if (event.type === "chore_completed" || event.type === "chore_deleted") {
        if (event.choreId) {
          removeTodayChore(event.choreId);
        }
        queueSilentSummaryRefresh();
      } else if (event.choreId) {
        void refreshTodayChoreFromApi(event.choreId);
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("notifications:refresh"));
        window.dispatchEvent(new Event("wallet:refresh"));
      }
    };

    socket.on("family:activity", onFamilyActivity);
    return () => {
      socket.off("family:activity", onFamilyActivity);
    };
  }, [familyId, queueSilentSummaryRefresh, refreshTodayChoreFromApi, removeTodayChore, summary?.wsAuthToken]);

  async function onAcceptInvite() {
    if (acceptingInvite) {
      return;
    }
    setAcceptInviteError("");
    setAcceptingInvite(true);
    try {
      const response = await fetch("/api/family/invitations/accept", {
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `ACCEPT_INVITE_HTTP_${response.status}`);
      }
      await loadSummary({ silent: true });
    } catch (acceptError) {
      const message =
        acceptError instanceof Error ? acceptError.message : "accept_invite_failed";
      setAcceptInviteError(message);
    } finally {
      setAcceptingInvite(false);
    }
  }

  return (
    <>
      {isLoading ? (
        <article className="family-panel" aria-label={t("dashboard.loading")} aria-hidden="true">
          <div className="family-skeleton family-skeleton-title" />
          <div className="family-skeleton family-skeleton-subtitle" />
          <div className="family-skeleton-chip-row mt-3">
            <div className="family-skeleton family-skeleton-chip" />
            <div className="family-skeleton family-skeleton-chip" />
            <div className="family-skeleton family-skeleton-chip" />
          </div>
          <div className="family-skeleton-stack mt-3">
            <div className="family-skeleton family-skeleton-row" />
            <div className="family-skeleton family-skeleton-row" />
            <div className="family-skeleton family-skeleton-row" />
          </div>
        </article>
      ) : null}
      {!isLoading && error ? (
        <div className="family-error-wrap">
          <Alert>{t("dashboard.familyLoadError", { error })}</Alert>
          {firestoreNotConfigured ? (
            <Alert>{t("dashboard.firestoreMissing")}</Alert>
          ) : null}
          {firestoreForbidden ? (
            <Alert>{t("dashboard.firestoreForbidden")}</Alert>
          ) : null}
          {needsReauth ? (
            <form action="/api/auth/logout" method="post">
              <Button type="submit" className="btn btn-secondary">
                {t("dashboard.reauth")}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
      {!isLoading && !error && summary ? (
        <>
          {summary.noFamily ? (
            <article className="family-panel">
              <h3>{t("dashboard.getStartedTitle")}</h3>
              <p className="small">{t("dashboard.getStartedBody")}</p>
              <div className="mt-3">
                <Link href="/family" className="btn btn-primary">
                  {t("dashboard.finishFamilySetup")}
                </Link>
              </div>
            </article>
          ) : summary.pendingInvite ? (
            <article className="family-panel">
              <h3>{t("dashboard.invitePendingTitle")}</h3>
              <p className="small">{t("dashboard.invitedToFamily", { familyName: summary.pendingInvite.familyName })}</p>
              {summary.pendingInvite.inviter ? (
                <p className="small">
                  {t("dashboard.invitedBy", {
                    name: summary.pendingInvite.inviter.name,
                    emailSuffix: summary.pendingInvite.inviter.email
                      ? ` (${summary.pendingInvite.inviter.email})`
                      : "",
                  })}
                </p>
              ) : (
                <p className="small">{t("dashboard.inviterUnavailable")}</p>
              )}
              {acceptInviteError ? <Alert>{t("dashboard.acceptInviteError", { error: acceptInviteError })}</Alert> : null}
              <div className="mt-3">
                <Button
                  type="button"
                  className="btn btn-primary"
                  onClick={onAcceptInvite}
                  disabled={acceptingInvite}>
                  {acceptingInvite ? t("dashboard.acceptingInvite") : t("dashboard.acceptInvite")}
                </Button>
              </div>
            </article>
          ) : (
            <TodayChoresPanel
              chores={summary.choresToday}
              members={summary.members}
              viewerAssigneeIds={viewerAssigneeIds}
              viewerRole={viewerRole}
              onReload={() => loadSummary({ silent: true })}
              completionStatsReloadKey={completionStatsReloadKey}
            />
          )}
        </>
      ) : null}
    </>
  );
}

