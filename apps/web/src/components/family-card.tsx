"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { TodayChoresPanel } from "@/components/today-chores-panel";
import type { FamilySnapshotChore, FamilySummaryResponse } from "@/lib/family/types";
import { connectFamilySocket, type FamilyActivityEvent } from "@/lib/ws";

export function FamilyCard() {
  const [summary, setSummary] = useState<FamilySummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [acceptInviteError, setAcceptInviteError] = useState("");

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
    summary?.members
      .filter((member) => member.uid === viewerUid || member.id === viewerUid)
      .flatMap((member) => [member.id, member.uid ?? ""])
      .filter((value) => value.length > 0) ?? [viewerUid].filter(Boolean);
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
            assigneeName: string;
            assigneePrimaryColor?: string;
            assigneeAvatarId?: string;
            assigneeAvatarPhotoUrl?: string;
            dueDate: string;
            details?: string;
            coinValue: number;
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
        assigneeName: chore.assigneeName || "Unassigned",
        assigneePrimaryColor: chore.assigneePrimaryColor,
        assigneeAvatarId: chore.assigneeAvatarId,
        assigneeAvatarPhotoUrl: chore.assigneeAvatarPhotoUrl,
        dueDate: chore.dueDate,
        details: chore.details,
        coinValue: chore.coinValue || 10,
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
      const response = await fetch("/api/family/summary", { cache: "no-store" });
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

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

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
        event.type === "theme_changed" ||
        event.type === "avatar_changed" ||
        event.type === "chore_reordered"
      ) {
        void loadSummary({ silent: true });
        return;
      }
      if (event.type === "chore_completed" || event.type === "chore_deleted") {
        if (event.choreId) {
          removeTodayChore(event.choreId);
        }
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
  }, [familyId, loadSummary, refreshTodayChoreFromApi, removeTodayChore, summary?.wsAuthToken]);

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
      {isLoading ? <p className="small">Loading family snapshot...</p> : null}
      {!isLoading && error ? (
        <div className="family-error-wrap">
          <p className="small family-error">Could not load family snapshot: {error}</p>
          {firestoreNotConfigured ? (
            <p className="small family-error">
              Firestore default database is missing. Open Firebase console and create
              Firestore for this project, then refresh.
            </p>
          ) : null}
          {firestoreForbidden ? (
            <p className="small family-error">
              Firestore rules are denying this user. Update your Firestore security
              rules to allow reads and writes for authenticated users in this app.
            </p>
          ) : null}
          {needsReauth ? (
            <form action="/api/auth/logout" method="post">
              <Button type="submit" className="btn btn-secondary">
                Sign out and sign in again
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
      {!isLoading && !error && summary ? (
        <>
          {summary.pendingInvite ? (
            <article className="family-panel">
              <h3>Invitation Pending</h3>
              <p className="small">
                You&apos;ve been invited to join <strong>{summary.pendingInvite.familyName}</strong>.
              </p>
              {summary.pendingInvite.inviter ? (
                <p className="small">
                  Invited by {summary.pendingInvite.inviter.name}
                  {summary.pendingInvite.inviter.email
                    ? ` (${summary.pendingInvite.inviter.email})`
                    : ""}.
                </p>
              ) : (
                <p className="small">Inviter details are unavailable.</p>
              )}
              {acceptInviteError ? (
                <p className="small family-error">
                  Could not accept invite: {acceptInviteError}
                </p>
              ) : null}
              <div className="mt-3">
                <Button
                  type="button"
                  className="btn btn-primary"
                  onClick={onAcceptInvite}
                  disabled={acceptingInvite}>
                  {acceptingInvite ? "Accepting..." : "Accept invitation"}
                </Button>
              </div>
            </article>
          ) : (
            <TodayChoresPanel
              chores={summary.choresToday}
              viewerAssigneeIds={viewerAssigneeIds}
              viewerRole={viewerRole}
              onReload={() => loadSummary({ silent: true })}
            />
          )}
        </>
      ) : null}
    </>
  );
}
