"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { useLocale } from "@/components/locale-provider";

type IncomingInvite = {
  id: string;
  status: string;
  fromFamilyName: string;
  fromAdminName: string;
};

export function FamilyFriendsHighlights() {
  const { t } = useLocale();
  const [incoming, setIncoming] = useState<IncomingInvite[]>([]);
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/family-friends", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        viewerRole?: string;
        incoming?: IncomingInvite[];
        friends?: Array<{ familyId: string }>;
      };
      setIncoming(
        payload.viewerRole === "admin"
          ? (payload.incoming || []).filter((invite) => invite.status === "pending")
          : [],
      );
    } catch {
      // The highlights are additive and should never block the chores dashboard.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirm(invite: IncomingInvite) {
    if (pendingId) return;
    setPendingId(invite.id);
    setError("");
    try {
      const response = await fetch(`/api/family-friends/invitations/${encodeURIComponent(invite.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `FAMILY_FRIEND_CONFIRM_HTTP_${response.status}`);
      await load();
      window.dispatchEvent(new Event("notifications:refresh"));
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "family_friend_confirm_failed");
    } finally {
      setPendingId("");
    }
  }

  return (
    <>
      {incoming.map((invite) => (
        <article key={invite.id} className="family-page-card mb-4 border-blue-200 bg-blue-50">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2>{t("familyFriends.incoming.dashboardTitle", { family: invite.fromFamilyName })}</h2>
              <p className="small">{t("familyFriends.incoming.from", { name: invite.fromAdminName })}</p>
            </div>
            <span title={pendingId ? t("familyFriends.disabled.actionPending") : undefined}>
              <Button className="btn btn-primary" disabled={Boolean(pendingId)} onClick={() => void confirm(invite)}>
                {pendingId === invite.id ? t("familyFriends.actions.confirming") : t("familyFriends.actions.confirm")}
              </Button>
            </span>
          </div>
        </article>
      ))}
      {error ? <Alert>{t("familyFriends.errors.action", { error })}</Alert> : null}
    </>
  );
}
