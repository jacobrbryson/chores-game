"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { useLocale } from "@/components/locale-provider";
import { ModalShell } from "@/components/modal-shell";

type Friend = { familyId: string; familyName: string; connectedAt: string };
type Invite = {
  id: string;
  status: string;
  fromFamilyName: string;
  fromAdminName: string;
  toEmail: string;
  createdAt: string;
  expiresAt: string;
};
type FriendsResponse = {
  viewerRole: "admin" | "player";
  friends: Friend[];
  incoming: Invite[];
  outgoing: Invite[];
};

function LoadingCards() {
  return (
    <div className="family-friends-list" aria-hidden="true">
      {[0, 1, 2].map((key) => (
        <div key={key} className="family-skeleton family-skeleton-reward h-20" />
      ))}
    </div>
  );
}

export function FamilyFriendsSection() {
  const { locale, t } = useLocale();
  const [data, setData] = useState<FriendsResponse | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removeTarget, setRemoveTarget] = useState<Friend | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/family-friends", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as FriendsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || `FAMILY_FRIENDS_HTTP_${response.status}`);
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "family_friends_unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingIncoming = useMemo(
    () => (data?.incoming || []).filter((invite) => invite.status === "pending"),
    [data?.incoming],
  );
  const pendingOutgoing = useMemo(
    () => (data?.outgoing || []).filter((invite) => invite.status === "pending" || invite.status === "expired"),
    [data?.outgoing],
  );

  async function inviteFamily(event: FormEvent) {
    event.preventDefault();
    if (pendingId) return;
    setPendingId("invite");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/family-friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        delivery?: { email?: boolean; inApp?: boolean; emailOptedOut?: boolean };
      };
      if (!response.ok) throw new Error(payload.error || `FAMILY_FRIEND_INVITE_HTTP_${response.status}`);
      setEmail("");
      // An email opt-out is a recipient choice, not a delivery failure — the
      // request is still waiting for them in their in-app notifications.
      setNotice(
        payload.delivery?.emailOptedOut
          ? "sent_in_app_only"
          : payload.delivery?.email
            ? "sent"
            : "email_warning",
      );
      await load();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "family_friend_invite_failed");
    } finally {
      setPendingId("");
    }
  }

  async function invitationAction(invite: Invite, action: "accept" | "resend" | "cancel") {
    if (pendingId) return;
    setPendingId(invite.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/family-friends/invitations/${encodeURIComponent(invite.id)}`, {
        method: action === "cancel" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "cancel" ? undefined : JSON.stringify({ action }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `FAMILY_FRIEND_ACTION_HTTP_${response.status}`);
      setNotice(action);
      await load();
      window.dispatchEvent(new Event("notifications:refresh"));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "family_friend_action_failed");
    } finally {
      setPendingId("");
    }
  }

  async function removeFriend() {
    if (!removeTarget || pendingId) return;
    setPendingId(removeTarget.familyId);
    setError("");
    try {
      const response = await fetch(`/api/family-friends/${encodeURIComponent(removeTarget.familyId)}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `FAMILY_FRIEND_REMOVE_HTTP_${response.status}`);
      setRemoveTarget(null);
      setNotice("removed");
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "family_friend_remove_failed");
    } finally {
      setPendingId("");
    }
  }

  return (
    <section className="grid gap-5">
      <div className="family-page-card">
        <div className="family-page-card-header">
          <div>
            <h2>{t("familyFriends.title")}</h2>
            <p className="small">{t("familyFriends.description")}</p>
          </div>
        </div>
        {error ? <Alert>{t("familyFriends.errors.action", { error })}</Alert> : null}
        {notice ? (
          <Alert tone={notice === "email_warning" ? "warning" : "success"}>
            {t(`familyFriends.notices.${notice}`)}
          </Alert>
        ) : null}
        {data?.viewerRole === "admin" ? (
          <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={inviteFamily}>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">{t("familyFriends.invite.email")}</span>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t("familyFriends.invite.placeholder")}
                className="h-10 rounded-md border border-slate-300 px-3"
              />
            </label>
            <span className="self-end" title={pendingId ? t("familyFriends.disabled.actionPending") : undefined}>
              <Button type="submit" className="btn btn-primary" disabled={Boolean(pendingId)}>
                {pendingId === "invite" ? t("familyFriends.actions.sending") : t("familyFriends.actions.invite")}
              </Button>
            </span>
          </form>
        ) : null}
      </div>

      {loading ? <LoadingCards /> : null}
      {!loading && data?.viewerRole === "admin" && pendingIncoming.length ? (
        <div className="family-page-card">
          <h3>{t("familyFriends.incoming.title")}</h3>
          <div className="family-friends-list mt-3">
            {pendingIncoming.map((invite) => (
              <article key={invite.id} className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <strong>{invite.fromFamilyName}</strong>
                <p className="small">{t("familyFriends.incoming.from", { name: invite.fromAdminName })}</p>
                <span title={pendingId ? t("familyFriends.disabled.actionPending") : undefined}>
                  <Button className="btn btn-primary mt-3" disabled={Boolean(pendingId)} onClick={() => void invitationAction(invite, "accept")}>
                    {pendingId === invite.id ? t("familyFriends.actions.confirming") : t("familyFriends.actions.confirm")}
                  </Button>
                </span>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {!loading && data?.viewerRole === "admin" && pendingOutgoing.length ? (
        <div className="family-page-card">
          <h3>{t("familyFriends.outgoing.title")}</h3>
          <div className="family-friends-list mt-3">
            {pendingOutgoing.map((invite) => (
              <article key={invite.id} className="family-friends-request-card">
                <div className="family-friends-request-details">
                  <strong>{invite.toEmail}</strong>
                  <p className="small">{new Date(invite.createdAt).toLocaleDateString(locale)}</p>
                </div>
                <div className="family-friends-request-actions">
                  <span title={pendingId ? t("familyFriends.disabled.actionPending") : undefined}>
                    <Button className="btn btn-secondary" disabled={Boolean(pendingId)} onClick={() => void invitationAction(invite, "resend")}>{t("familyFriends.actions.resend")}</Button>
                  </span>
                  <span title={pendingId ? t("familyFriends.disabled.actionPending") : undefined}>
                    <Button className="btn btn-secondary" disabled={Boolean(pendingId)} onClick={() => void invitationAction(invite, "cancel")}>{t("familyFriends.actions.cancel")}</Button>
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {!loading ? (
        <div className="family-page-card">
          <h3>{t("familyFriends.connected.title")}</h3>
          {data?.friends.length ? (
            <div className="family-friends-list mt-3">
              {data.friends.map((friend) => (
                <article key={friend.familyId} className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div><strong>{friend.familyName}</strong><p className="small">{t("familyFriends.connected.since", { date: new Date(friend.connectedAt).toLocaleDateString(locale) })}</p></div>
                  {data.viewerRole === "admin" ? <Button className="btn btn-secondary" onClick={() => setRemoveTarget(friend)}>{t("familyFriends.actions.remove")}</Button> : null}
                </article>
              ))}
            </div>
          ) : <p className="small mt-3">{t("familyFriends.connected.empty")}</p>}
        </div>
      ) : null}

      <ModalShell open={Boolean(removeTarget)} onRequestClose={() => setRemoveTarget(null)}>
        <div className="family-modal-card">
          <h3>{t("familyFriends.remove.title")}</h3>
          <p className="mt-2 text-sm text-slate-600">{t("familyFriends.remove.body", { family: removeTarget?.familyName || "" })}</p>
          <div className="family-modal-actions mt-4">
            <span title={pendingId ? t("familyFriends.disabled.actionPending") : undefined}>
              <Button className="btn btn-secondary" disabled={Boolean(pendingId)} onClick={() => setRemoveTarget(null)}>{t("familyFriends.actions.keep")}</Button>
            </span>
            <span title={pendingId ? t("familyFriends.disabled.actionPending") : undefined}>
              <Button className="btn member-action-remove" disabled={Boolean(pendingId)} onClick={() => void removeFriend()}>{t("familyFriends.actions.remove")}</Button>
            </span>
          </div>
        </div>
      </ModalShell>
    </section>
  );
}
