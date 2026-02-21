"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { TodayChoresPanel } from "@/components/today-chores-panel";
import type { FamilySummaryResponse } from "@/lib/family/types";

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
  const viewerAssigneeIds =
    summary?.members
      .filter((member) => member.uid === viewerUid || member.id === viewerUid)
      .flatMap((member) => [member.id, member.uid ?? ""])
      .filter((value) => value.length > 0) ?? [viewerUid].filter(Boolean);

  async function loadSummary(options?: { silent?: boolean }) {
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
  }

  useEffect(() => {
    void loadSummary();
  }, []);

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
              onReload={() => loadSummary({ silent: true })}
            />
          )}
        </>
      ) : null}
    </>
  );
}
