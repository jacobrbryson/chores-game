"use client";

import { Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useState } from "react";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { EnumChip, humanizeEnum } from "@/components/enum-chip";
import { ModalShell } from "@/components/modal-shell";
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

type FamilyMember = FamilySummaryResponse["members"][number];

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
          <Button
            type="button"
            className="flex h-10 w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 text-left text-slate-800"
            onClick={() => setRoleMenuOpen((open) => !open)}
            aria-haspopup="listbox"
            aria-expanded={roleMenuOpen}>
            <span>{roleLabel}</span>
            <span className="text-xs text-slate-500" aria-hidden="true">
              v
            </span>
          </Button>
          <input type="hidden" name="role" value={form.role} />
          {roleMenuOpen ? (
            <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-300 bg-white p-1 shadow-lg">
              <Button
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  setForm((current) => ({ ...current, role: "player" }));
                  setRoleMenuOpen(false);
                }}>
                Child (player)
              </Button>
              <Button
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  setForm((current) => ({ ...current, role: "admin" }));
                  setRoleMenuOpen(false);
                }}>
                Parent (admin)
              </Button>
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

function memberRoleTone(role: string) {
  return role === "admin" ? "indigo" : "teal";
}

function memberStatusTone(status: string) {
  return status === "active" ? "green" : "amber";
}

function memberLastSignInLabel(member: FamilyMember, viewerUid?: string) {
  if (!viewerUid) {
    return "-";
  }
  if (member.id === viewerUid || member.uid === viewerUid) {
    return "-";
  }
  if (!member.lastSignInAt) {
    return "-";
  }
  return new Date(member.lastSignInAt).toLocaleString();
}

export default function FamilyPage() {
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
  const [pendingRemoveMember, setPendingRemoveMember] =
    useState<PendingRemoveMember | null>(null);
  const [showAddMemberForm, setShowAddMemberForm] = useState(false);

  async function loadSummary() {
    setIsLoading(true);
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

  async function onMemberAction(memberId: string, action: "reinvite" | "remove") {
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

  const members = useMemo(() => summary?.members ?? [], [summary]);
  const viewerMember =
    summary?.members.find(
      (member) => member.uid === summary.viewerUid || member.id === summary.viewerUid,
    ) ?? null;
  const viewerUid = summary?.viewerUid ?? "";
  const canManageMembers = viewerMember?.role === "admin";

  return (
    <>
      <main className="panel family-page">
          <div className="page-header-row">
            <div className="page-header-inline">
              <BackLink className="page-back-link" />
              <h1>Family Members</h1>
            </div>
            {canManageMembers ? (
              <Button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowAddMemberForm(true)}>
                Add Family Member
              </Button>
            ) : null}
          </div>

          {isLoading ? <p className="small">Loading family members...</p> : null}
          {!isLoading && error ? (
            <p className="small family-error">Could not load members: {error}</p>
          ) : null}
          {!isLoading && !error ? (
            <>
              {summary?.pendingInvite ? (
                <p className="small">
                  Invitation is pending acceptance. Go back to the home dashboard to accept it.
                </p>
              ) : (
                <>
                  {memberActionError ? (
                    <p className="small family-error">Member update failed: {memberActionError}</p>
                  ) : null}
                  <p className="small family-page-subhead">
                    {members.length} member{members.length === 1 ? "" : "s"}
                  </p>
                  <div className="family-table-wrap family-table-desktop">
                    <table className="family-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Status</th>
                          <th>Last Sign In</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {members.length === 0 ? (
                          <tr>
                            <td colSpan={6}>No family members found.</td>
                          </tr>
                        ) : (
                          members.map((member) => (
                            <tr key={member.id}>
                              <td>{member.name}</td>
                              <td>{member.email || "-"}</td>
                              <td>
                                <EnumChip
                                  label={humanizeEnum(member.role)}
                                  tone={memberRoleTone(member.role)}
                                />
                              </td>
                              <td>
                                <EnumChip
                                  label={humanizeEnum(member.status)}
                                  tone={memberStatusTone(member.status)}
                                />
                              </td>
                              <td>
                                {memberLastSignInLabel(member, summary?.viewerUid)}
                              </td>
                              <td>
                                {canManageMembers &&
                                member.id !== viewerUid &&
                                member.uid !== viewerUid ? (
                                  <div className="member-actions">
                                    <Button
                                      type="button"
                                      className="btn btn-secondary member-action-btn"
                                      disabled={Boolean(memberActionLoading)}
                                      onClick={() => onMemberAction(member.id, "reinvite")}>
                                      {memberActionLoading?.memberId === member.id &&
                                      memberActionLoading.action === "reinvite"
                                        ? "Working..."
                                        : "Re-invite"}
                                    </Button>
                                    <Button
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
                                    </Button>
                                  </div>
                                ) : null}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="family-member-cards">
                    {members.length === 0 ? (
                      <div className="family-member-empty">No family members found.</div>
                    ) : (
                      members.map((member) => (
                        <article key={member.id} className="family-member-card">
                          <div className="family-member-card-head">
                            <div>
                              <h3 className="family-member-name">{member.name}</h3>
                              <p className="family-member-email">{member.email || "-"}</p>
                            </div>
                            <EnumChip
                              label={humanizeEnum(member.status)}
                              tone={memberStatusTone(member.status)}
                            />
                          </div>
                          <div className="family-member-meta">
                            <div className="family-member-meta-item">
                              <span>Role</span>
                              <EnumChip
                                label={humanizeEnum(member.role)}
                                tone={memberRoleTone(member.role)}
                              />
                            </div>
                            <div className="family-member-meta-item">
                              <span>Last Sign In</span>
                              <strong>{memberLastSignInLabel(member, summary?.viewerUid)}</strong>
                            </div>
                          </div>
                          {canManageMembers &&
                          member.id !== viewerUid &&
                          member.uid !== viewerUid ? (
                            <div className="family-member-actions">
                              <Button
                                type="button"
                                className="btn btn-secondary member-action-btn"
                                disabled={Boolean(memberActionLoading)}
                                onClick={() => onMemberAction(member.id, "reinvite")}>
                                {memberActionLoading?.memberId === member.id &&
                                memberActionLoading.action === "reinvite"
                                  ? "Working..."
                                  : "Re-invite"}
                              </Button>
                              <Button
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
                              </Button>
                            </div>
                          ) : null}
                        </article>
                      ))
                    )}
                  </div>
                </>
              )}
            </>
          ) : null}
      </main>

      <ModalShell open={showAddMemberForm} onRequestClose={() => setShowAddMemberForm(false)}>
        <div className="family-modal-card">
          <h3 className="family-modal-title">Add Family Member</h3>
          <form className="flex w-full flex-col gap-3" onSubmit={onSubmit}>
            <AddMemberFields form={form} setForm={setForm} />
            <div className="family-modal-actions">
              <Button
                type="button"
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => setShowAddMemberForm(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="btn btn-primary"
                disabled={saving}>
                {saving ? "Saving..." : "Add Member"}
              </Button>
            </div>
          </form>
        </div>
      </ModalShell>

      <ModalShell
        open={Boolean(pendingRemoveMember)}
        onRequestClose={() => setPendingRemoveMember(null)}>
        <div className="family-modal-card">
          {pendingRemoveMember ? (
            <>
              <h3 className="family-modal-title">Remove Family Member</h3>
              <p className="mb-4 text-sm text-slate-600">
                Remove <strong>{pendingRemoveMember.name}</strong> from your family?
              </p>
              <div className="family-modal-actions">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={Boolean(memberActionLoading)}
                  onClick={() => setPendingRemoveMember(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="btn member-action-remove"
                  disabled={Boolean(memberActionLoading)}
                  onClick={() => onMemberAction(pendingRemoveMember.id, "remove")}>
                  {memberActionLoading?.memberId === pendingRemoveMember.id &&
                  memberActionLoading.action === "remove"
                    ? "Removing..."
                    : "Remove"}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>
    </>
  );
}


