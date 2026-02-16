"use client";

import Link from "next/link";
import { Dispatch, FormEvent, SetStateAction, useEffect, useState } from "react";
import { AddChoresDialog } from "@/components/add-chores-dialog";
import type { FamilySummaryResponse } from "@/lib/family/types";

type AddMemberState = {
  name: string;
  email: string;
  role: "admin" | "player";
};

type PendingRemoveMember = {
  id: string;
  name: string;
};

type AddMemberFieldsProps = {
  form: AddMemberState;
  setForm: Dispatch<SetStateAction<AddMemberState>>;
};

function AddMemberFields({ form, setForm }: AddMemberFieldsProps) {
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const roleLabel = form.role === "admin" ? "Parent (admin)" : "Child (player)";

  return (
    <>
      <label className="flex w-full flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700">Name</span>
        <input
          required
          minLength={2}
          maxLength={80}
          value={form.name}
          onChange={(event) =>
            setForm((current) => ({ ...current, name: event.target.value }))
          }
          placeholder="Avery"
          className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
        />
      </label>
      <label className="flex w-full flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700">Email</span>
        <input
          type="email"
          required
          value={form.email}
          onChange={(event) =>
            setForm((current) => ({ ...current, email: event.target.value }))
          }
          placeholder="avery@example.com"
          className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
        />
      </label>
      <label className="flex w-full flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700">Role</span>
        <div className="relative w-full">
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 text-left text-slate-800"
            onClick={() => setRoleMenuOpen((open) => !open)}
            aria-haspopup="listbox"
            aria-expanded={roleMenuOpen}>
            <span>{roleLabel}</span>
            <span className="text-xs text-slate-500" aria-hidden="true">
              ▾
            </span>
          </button>
          <input type="hidden" name="role" value={form.role} />
          {roleMenuOpen ? (
            <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-300 bg-white p-1 shadow-lg">
              <button
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  setForm((current) => ({ ...current, role: "player" }));
                  setRoleMenuOpen(false);
                }}>
                Child (player)
              </button>
              <button
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  setForm((current) => ({ ...current, role: "admin" }));
                  setRoleMenuOpen(false);
                }}>
                Parent (admin)
              </button>
            </div>
          ) : null}
        </div>
      </label>
    </>
  );
}

const initialMemberState: AddMemberState = {
  name: "",
  email: "",
  role: "player",
};

export function FamilyCard() {
  const [summary, setSummary] = useState<FamilySummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<AddMemberState>(initialMemberState);
  const [saving, setSaving] = useState(false);
  const [memberActionLoading, setMemberActionLoading] = useState<{
    memberId: string;
    action: "reinvite" | "remove";
  } | null>(null);
  const [memberActionError, setMemberActionError] = useState("");
  const [choreActionLoadingId, setChoreActionLoadingId] = useState("");
  const [choreActionError, setChoreActionError] = useState("");
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [acceptInviteError, setAcceptInviteError] = useState("");
  const [pendingRemoveMember, setPendingRemoveMember] =
    useState<PendingRemoveMember | null>(null);
  const [showAddMemberForm, setShowAddMemberForm] = useState(false);
  const needsReauth =
    error === "reauth_required" ||
    error === "missing_firebase_session" ||
    error === "SUMMARY_HTTP_401";
  const firestoreNotConfigured = error === "firestore_not_configured";
  const firestoreForbidden = error === "firestore_forbidden";
  const visibleMembers =
    summary?.members
      .slice()
      .sort((a, b) => {
        if (a.status === b.status) {
          return 0;
        }
        return a.status === "invited" ? -1 : 1;
      })
      .slice(0, 5) ?? [];
  const hasMoreMembers = (summary?.members.length ?? 0) > 5;
  const viewerMember =
    summary?.members.find(
      (member) => member.uid === summary.viewerUid || member.id === summary.viewerUid,
    ) ?? null;
  const canManageMembers = viewerMember?.role === "admin";
  const shouldShowAddMemberModal = showAddMemberForm;

  async function loadSummary() {
    setIsLoading(true);
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
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/family/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `ADD_MEMBER_HTTP_${response.status}`);
      }

      setForm(initialMemberState);
      setShowAddMemberForm(false);
      await loadSummary();
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "add_member_failed";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function onMemberAction(
    memberId: string,
    action: "reinvite" | "remove",
  ) {
    if (memberActionLoading) {
      return;
    }

    setMemberActionError("");
    setMemberActionLoading({ memberId, action });
    try {
      const endpoint =
        action === "reinvite"
          ? `/api/family/members/${memberId}/reinvite`
          : `/api/family/members/${memberId}`;
      const response = await fetch(endpoint, {
        method: action === "reinvite" ? "POST" : "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `${action}_failed`);
      }
      await loadSummary();
    } catch (actionError) {
      const message =
        actionError instanceof Error ? actionError.message : "member_action_failed";
      setMemberActionError(message);
    } finally {
      setMemberActionLoading(null);
      if (action === "remove") {
        setPendingRemoveMember(null);
      }
    }
  }

  async function onRemoveChore(choreId: string) {
    if (choreActionLoadingId) {
      return;
    }
    setChoreActionError("");
    setChoreActionLoadingId(choreId);
    try {
      const response = await fetch(`/api/chores/${choreId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `REMOVE_CHORE_HTTP_${response.status}`);
      }
      await loadSummary();
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : "remove_chore_failed";
      setChoreActionError(message);
    } finally {
      setChoreActionLoadingId("");
    }
  }

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
      await loadSummary();
    } catch (acceptError) {
      const message =
        acceptError instanceof Error ? acceptError.message : "accept_invite_failed";
      setAcceptInviteError(message);
    } finally {
      setAcceptingInvite(false);
    }
  }

  return (
    <section className="card family-card">
      <div className="family-header">
        <h2>My Family</h2>
        {!isLoading && !error && canManageMembers ? (
          <details className="family-settings">
            <summary title="Family settings" aria-label="Family settings">
              <span className="family-kebab" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </summary>
            <div className="family-settings-menu">
              <button
                type="button"
                className="family-settings-item"
                onClick={() => setShowAddMemberForm(true)}>
                Add Family Member
              </button>
            </div>
          </details>
        ) : null}
      </div>
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
              <button type="submit" className="btn btn-secondary">
                Sign out and sign in again
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
      {!isLoading && !error && summary ? (
        <>
          {summary.pendingInvite ? (
            <div className="family-grid">
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
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={onAcceptInvite}
                    disabled={acceptingInvite}>
                    {acceptingInvite ? "Accepting..." : "Accept invitation"}
                  </button>
                </div>
              </article>
            </div>
          ) : (
            <>
          <p className="small family-subhead">
            Your family has {summary.members.length} member
            {summary.members.length === 1 ? "" : "s"}.
          </p>

          <div className="family-grid">
            <article className="family-panel">
              <h3>Members</h3>
              {memberActionError ? (
                <p className="small family-error">Member update failed: {memberActionError}</p>
              ) : null}
              {summary.members.length === 0 ? (
                <div className="flex flex-col gap-3">
                  <p className="small">No members yet.</p>
                  <div className="chores-empty-cta">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setShowAddMemberForm(true)}>
                      Let&apos;s add some!
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <ul className="family-list">
                    {visibleMembers.map((member) => (
                      <li key={member.id}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <strong>{member.name}</strong>
                            <span
                              title={member.role === "admin" ? "Admin" : "Player"}
                              aria-label={member.role === "admin" ? "Admin" : "Player"}
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xs leading-none">
                              {member.role === "admin" ? "\u{1F451}" : "\u{1F9F8}"}
                            </span>
                          </div>
                          <span
                            className={
                              member.status === "active"
                                ? "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700"
                                : "inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-700"
                            }>
                            {member.status}
                          </span>
                        </div>
                        {member.email ? <span>{member.email}</span> : null}
                        {member.id !== summary.viewerUid &&
                        member.uid !== summary.viewerUid ? (
                          <span>
                            Last sign in:{" "}
                            {member.lastSignInAt
                              ? new Date(member.lastSignInAt).toLocaleString()
                              : "-"}
                          </span>
                        ) : null}
                        {canManageMembers &&
                        member.id !== summary.viewerUid &&
                        member.uid !== summary.viewerUid ? (
                          <div className="member-actions">
                            <button
                              type="button"
                              className="btn btn-secondary member-action-btn"
                              disabled={Boolean(memberActionLoading)}
                              onClick={() =>
                                onMemberAction(member.id, "reinvite")
                              }>
                              {memberActionLoading?.memberId === member.id &&
                              memberActionLoading.action === "reinvite"
                                ? "Working..."
                                : "Re-invite"}
                            </button>
                            <button
                              type="button"
                              className="btn member-action-remove"
                              disabled={Boolean(memberActionLoading)}
                              onClick={() =>
                                setPendingRemoveMember({
                                  id: member.id,
                                  name: member.name,
                                })
                              }>
                              {memberActionLoading?.memberId === member.id &&
                              memberActionLoading.action === "remove"
                                ? "Working..."
                                : "Remove"}
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {hasMoreMembers ? (
                    <Link className="family-more-link" href="/family">
                      View all {summary.members.length} family members
                    </Link>
                  ) : null}
                </>
              )}
            </article>

            <article className="family-panel">
              <div className="flex items-center justify-between gap-2">
                <h3>Today&apos;s Chores</h3>
                <Link className="text-sm font-semibold text-[#1f69b7] hover:underline" href="/chores">
                  All Chores
                </Link>
              </div>
              {choreActionError ? (
                <p className="small family-error">Chore update failed: {choreActionError}</p>
              ) : null}
              {summary.choresToday.length === 0 ? (
                <div className="flex flex-col gap-3">
                  <p className="small">No chores due today.</p>
                  <div className="chores-empty-cta">
                    <AddChoresDialog onCreated={loadSummary} />
                  </div>
                </div>
              ) : (
                <>
                  <ul className="family-list">
                    {summary.choresToday.map((chore) => (
                      <li key={chore.id}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="grid gap-1">
                            <strong>{chore.title}</strong>
                            <span>{chore.assigneeName}</span>
                            <span>{chore.status}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-600">
                              <span aria-hidden="true">🪙</span>
                              {chore.coinValue}
                            </span>
                            <button
                              type="button"
                              title="Remove chore"
                              aria-label="Remove chore"
                              className="chore-remove-btn"
                              disabled={Boolean(choreActionLoadingId)}
                              onClick={() => onRemoveChore(chore.id)}>
                              {choreActionLoadingId === chore.id ? "…" : "×"}
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="chores-empty-cta chores-add-more-cta">
                    <AddChoresDialog triggerLabel="Add more chores" onCreated={loadSummary} />
                  </div>
                </>
              )}
            </article>
          </div>
            </>
          )}
        </>
      ) : null}

      {!isLoading && shouldShowAddMemberModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="mb-3 text-lg font-bold text-slate-800">Add Family Member</h3>
            <form className="flex w-full flex-col gap-3" onSubmit={onSubmit}>
              <AddMemberFields form={form} setForm={setForm} />
              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  className="h-10 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700"
                  disabled={saving}
                  onClick={() => setShowAddMemberForm(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-10 rounded-md border border-blue-300 bg-blue-50 px-3 text-sm font-semibold text-blue-700"
                  disabled={saving}>
                  {saving ? "Saving..." : "Add Member"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {pendingRemoveMember ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="mb-2 text-lg font-bold text-slate-800">Remove Family Member</h3>
            <p className="mb-4 text-sm text-slate-600">
              Remove <strong>{pendingRemoveMember.name}</strong> from your family?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                disabled={Boolean(memberActionLoading)}
                onClick={() => setPendingRemoveMember(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
                disabled={Boolean(memberActionLoading)}
                onClick={() =>
                  onMemberAction(
                    pendingRemoveMember.id,
                    "remove",
                  )
                }>
                {memberActionLoading?.memberId === pendingRemoveMember.id &&
                memberActionLoading.action === "remove"
                  ? "Removing..."
                  : "Remove"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}


