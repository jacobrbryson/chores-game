"use client";

import Image from "next/image";
import Link from "next/link";
import { CSSProperties, Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/avatar";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { EnumChip, humanizeEnum } from "@/components/enum-chip";
import { ModalShell } from "@/components/modal-shell";
import type { FamilySummaryResponse } from "@/lib/family/types";
import {
  FAMILY_REWARD_IMAGE_OPTIONS,
  findFamilyRewardImageOption,
  isFamilyRewardImageId,
  normalizeFamilyRewardCoinCost,
  type FamilyReward,
} from "@/lib/family/rewards";

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
type FamilyCategory = FamilySummaryResponse["categories"][number];

type CategoryFormState = {
  name: string;
  color: string;
};

type PendingRemoveCategory = {
  id: string;
  name: string;
};

type RewardFormState = {
  description: string;
  coinCost: string;
  imageId: string;
  individualLimit: string;
  familyLimit: string;
};

type PendingRemoveReward = {
  id: string;
  description: string;
  playerNames: string[];
};

type PendingDisableReward = {
  id: string;
  description: string;
};

type FamilyRewardsResponse = {
  noFamily: boolean;
  viewerRole: "admin" | "player";
  rewards: FamilyReward[];
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

const initialCategoryFormState: CategoryFormState = {
  name: "",
  color: "#3b82f6",
};

const initialRewardFormState: RewardFormState = {
  description: "",
  coinCost: "10",
  imageId: FAMILY_REWARD_IMAGE_OPTIONS[0]?.id ?? "screen_time",
  individualLimit: "",
  familyLimit: "",
};

function formatRewardLimitSummary(reward: FamilyReward) {
  const parts: string[] = [];
  if (reward.individualLimit) {
    parts.push(`${reward.individualLimit} per person`);
  }
  if (reward.familyLimit) {
    parts.push(`${reward.familyLimit} per family`);
  }
  return parts.length > 0 ? parts.join(" | ") : "Unlimited";
}

function memberRoleTone(role: string) {
  return role === "admin" ? "indigo" : "teal";
}

function memberStatusTone(status: string) {
  return status === "active" ? "green" : "amber";
}

function memberLastSignInLabel(member: FamilyMember) {
  if (!member.lastSignInAt) {
    return "-";
  }
  return new Date(member.lastSignInAt).toLocaleString();
}

function memberProfileHref(member: FamilyMember) {
  return `/family/${encodeURIComponent(member.uid || member.id)}`;
}

function canLinkToMemberProfile(member: FamilyMember) {
  return !(member.role === "player" && member.status !== "active");
}

function canReinviteMember(member: FamilyMember) {
  return member.status !== "active";
}

function normalizeCategoryColor(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : "";
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

  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [categoryForm, setCategoryForm] = useState<CategoryFormState>(initialCategoryFormState);
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryActionLoading, setCategoryActionLoading] = useState<{
    categoryId: string;
    action: "delete";
  } | null>(null);
  const [categoryError, setCategoryError] = useState("");
  const [pendingRemoveCategory, setPendingRemoveCategory] =
    useState<PendingRemoveCategory | null>(null);

  const [rewards, setRewards] = useState<FamilyReward[]>([]);
  const [rewardLoadError, setRewardLoadError] = useState("");
  const [showRewardEditor, setShowRewardEditor] = useState(false);
  const [rewardForm, setRewardForm] = useState<RewardFormState>(initialRewardFormState);
  const [editingRewardId, setEditingRewardId] = useState("");
  const [rewardSaving, setRewardSaving] = useState(false);
  const [rewardActionLoading, setRewardActionLoading] = useState<{
    rewardId: string;
    action: "disable" | "enable" | "delete";
  } | null>(null);
  const [rewardError, setRewardError] = useState("");
  const [openRewardMenuId, setOpenRewardMenuId] = useState("");
  const [pendingDisableReward, setPendingDisableReward] =
    useState<PendingDisableReward | null>(null);
  const [pendingRemoveReward, setPendingRemoveReward] =
    useState<PendingRemoveReward | null>(null);

  async function loadSummary() {
    setIsLoading(true);
    setError("");
    setRewardLoadError("");
    try {
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      const [summaryResponse, rewardsResponse] = await Promise.all([
        fetch(`/api/family/summary?tzOffsetMinutes=${tzOffsetMinutes}`, { cache: "no-store" }),
        fetch("/api/family/rewards", { cache: "no-store" }),
      ]);

      if (!summaryResponse.ok) {
        const body = (await summaryResponse.json()) as { error?: string };
        throw new Error(body.error ?? `SUMMARY_HTTP_${summaryResponse.status}`);
      }

      const payload = (await summaryResponse.json()) as FamilySummaryResponse;
      setSummary(payload);

      if (!rewardsResponse.ok) {
        const body = (await rewardsResponse.json()) as { error?: string };
        setRewardLoadError(body.error ?? `REWARDS_HTTP_${rewardsResponse.status}`);
        setRewards([]);
      } else {
        const rewardsPayload = (await rewardsResponse.json()) as FamilyRewardsResponse;
        setRewards(Array.isArray(rewardsPayload.rewards) ? rewardsPayload.rewards : []);
      }
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "summary_unavailable";
      setError(message);
      setRewards([]);
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

  function resetCategoryEditor() {
    setEditingCategoryId("");
    setCategoryForm(initialCategoryFormState);
    setCategoryError("");
  }

  function onEditCategory(category: FamilyCategory) {
    setEditingCategoryId(category.id);
    setCategoryForm({
      name: category.name,
      color: category.color,
    });
    setCategoryError("");
  }

  async function onSaveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (categorySaving) {
      return;
    }

    const normalizedName = categoryForm.name.trim().replace(/\s+/g, " ");
    const normalizedColor = normalizeCategoryColor(categoryForm.color);

    if (!normalizedName) {
      setCategoryError("name_required");
      return;
    }
    if (!normalizedColor) {
      setCategoryError("invalid_color");
      return;
    }

    setCategorySaving(true);
    setCategoryError("");

    try {
      const response = await fetch(
        editingCategoryId
          ? `/api/family/categories/${editingCategoryId}`
          : "/api/family/categories",
        {
          method: editingCategoryId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: normalizedName,
            color: normalizedColor,
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `CATEGORY_SAVE_HTTP_${response.status}`);
      }
      resetCategoryEditor();
      await loadSummary();
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "save_category_failed";
      setCategoryError(message);
    } finally {
      setCategorySaving(false);
    }
  }

  async function onDeleteCategory() {
    if (!pendingRemoveCategory || categoryActionLoading) {
      return;
    }

    setCategoryActionLoading({ categoryId: pendingRemoveCategory.id, action: "delete" });
    setCategoryError("");

    try {
      const response = await fetch(`/api/family/categories/${pendingRemoveCategory.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `CATEGORY_DELETE_HTTP_${response.status}`);
      }
      if (editingCategoryId === pendingRemoveCategory.id) {
        resetCategoryEditor();
      }
      setPendingRemoveCategory(null);
      await loadSummary();
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : "delete_category_failed";
      setCategoryError(message);
    } finally {
      setCategoryActionLoading(null);
    }
  }

  function resetRewardEditor() {
    setEditingRewardId("");
    setRewardForm(initialRewardFormState);
    setRewardError("");
    setShowRewardEditor(false);
  }

  function openAddRewardDialog() {
    setEditingRewardId("");
    setRewardForm(initialRewardFormState);
    setRewardError("");
    setShowRewardEditor(true);
    setOpenRewardMenuId("");
  }

  function onEditReward(reward: FamilyReward) {
    setEditingRewardId(reward.id);
    setRewardForm({
      description: reward.description,
      coinCost: String(reward.coinCost),
      imageId: reward.imageId,
      individualLimit: reward.individualLimit ? String(reward.individualLimit) : "",
      familyLimit: reward.familyLimit ? String(reward.familyLimit) : "",
    });
    setRewardError("");
    setShowRewardEditor(true);
    setOpenRewardMenuId("");
  }

  async function onSaveReward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rewardSaving) {
      return;
    }

    const description = rewardForm.description.trim().replace(/\s+/g, " " );
    const coinCost = normalizeFamilyRewardCoinCost(rewardForm.coinCost);
    const imageId = rewardForm.imageId.trim();
    const individualLimit = rewardForm.individualLimit.trim() === ""
      ? 0
      : normalizeFamilyRewardCoinCost(rewardForm.individualLimit);
    const familyLimit = rewardForm.familyLimit.trim() === ""
      ? 0
      : normalizeFamilyRewardCoinCost(rewardForm.familyLimit);

    if (!description) {
      setRewardError("description_required");
      return;
    }
    if (!Number.isInteger(coinCost) || coinCost < 1) {
      setRewardError("invalid_coin_cost");
      return;
    }
    if (!isFamilyRewardImageId(imageId)) {
      setRewardError("invalid_image_id");
      return;
    }
    if (!Number.isInteger(individualLimit) || individualLimit < 0) {
      setRewardError("invalid_individual_limit");
      return;
    }
    if (!Number.isInteger(familyLimit) || familyLimit < 0) {
      setRewardError("invalid_family_limit");
      return;
    }

    setRewardSaving(true);
    setRewardError("");

    try {
      const response = await fetch(
        editingRewardId
          ? `/api/family/rewards/${editingRewardId}`
          : "/api/family/rewards",
        {
          method: editingRewardId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description,
            coinCost,
            imageId,
            individualLimit,
            familyLimit,
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `REWARD_SAVE_HTTP_${response.status}`);
      }

      resetRewardEditor();
      await loadSummary();
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "save_reward_failed";
      setRewardError(message);
    } finally {
      setRewardSaving(false);
    }
  }

  async function onDeleteReward() {
    if (!pendingRemoveReward || rewardActionLoading) {
      return;
    }

    setRewardActionLoading({ rewardId: pendingRemoveReward.id, action: "delete" });
    setRewardError("");

    try {
      const response = await fetch(`/api/family/rewards/${pendingRemoveReward.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `REWARD_DELETE_HTTP_${response.status}`);
      }

      if (editingRewardId === pendingRemoveReward.id) {
        resetRewardEditor();
      }
      setOpenRewardMenuId("");
      setPendingRemoveReward(null);
      await loadSummary();
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : "delete_reward_failed";
      setRewardError(message);
    } finally {
      setRewardActionLoading(null);
    }
  }

  async function onDisableReward() {
    if (!pendingDisableReward || rewardActionLoading) {
      return;
    }

    setRewardActionLoading({ rewardId: pendingDisableReward.id, action: "disable" });
    setRewardError("");

    try {
      const response = await fetch(`/api/family/rewards/${pendingDisableReward.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: true }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `REWARD_DISABLE_HTTP_${response.status}`);
      }

      if (editingRewardId === pendingDisableReward.id) {
        resetRewardEditor();
      }
      setOpenRewardMenuId("");
      setPendingDisableReward(null);
      await loadSummary();
    } catch (disableError) {
      const message =
        disableError instanceof Error ? disableError.message : "disable_reward_failed";
      setRewardError(message);
    } finally {
      setRewardActionLoading(null);
    }
  }

  async function onEnableReward(reward: FamilyReward) {
    if (rewardActionLoading) {
      return;
    }

    setRewardActionLoading({ rewardId: reward.id, action: "enable" });
    setRewardError("");

    try {
      const response = await fetch(`/api/family/rewards/${reward.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: false }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `REWARD_ENABLE_HTTP_${response.status}`);
      }

      setOpenRewardMenuId("");
      await loadSummary();
    } catch (enableError) {
      const message =
        enableError instanceof Error ? enableError.message : "enable_reward_failed";
      setRewardError(message);
    } finally {
      setRewardActionLoading(null);
    }
  }

  const members = useMemo(() => summary?.members ?? [], [summary]);
  const categories = useMemo(() => summary?.categories ?? [], [summary]);
  const familyRewards = useMemo(() => rewards, [rewards]);
  const orderedFamilyRewards = useMemo(
    () =>
      [...familyRewards].sort((a, b) => {
        if (a.disabled === b.disabled) {
          return a.description.localeCompare(b.description);
        }
        return a.disabled ? 1 : -1;
      }),
    [familyRewards],
  );
  const playerMemberNames = useMemo(
    () =>
      members
        .filter((member) => member.role === "player" && member.status === "active")
        .map((member) => member.name),
    [members],
  );
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
              <BackLink className="page-back-link" fallbackHref="/" />
              <h1>Family Members</h1>
            </div>
            {canManageMembers ? (
              <div className="family-page-header-actions">
                <Button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowAddMemberForm(true)}>
                  Add Family Member
                </Button>
              </div>
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
                  <div className="family-page-grid">
                    <section className="family-page-card" aria-label="Family members">
                      <div className="family-page-card-header">
                        <h2>Members</h2>
                        <p className="small family-page-subhead">
                          {members.length} member{members.length === 1 ? "" : "s"}
                        </p>
                      </div>
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
                                  <td>
                                    {canLinkToMemberProfile(member) ? (
                                      <Link href={memberProfileHref(member)} className="family-member-link table-assignee-cell">
                                        <Avatar
                                          className="completion-chart-avatar"
                                          size={32}
                                          borderWidth={1}
                                          name={member.name}
                                          avatarId={member.avatarId}
                                          photoUrl={member.avatarPhotoUrl}
                                          primaryColor={member.dashboardPrimaryColor}
                                          secondaryColor={member.dashboardPrimaryColor}
                                          fallbackColor={member.dashboardPrimaryColor ? "#ffffff" : undefined}
                                          referrerPolicy="no-referrer"
                                        />
                                        <span className="family-member-link-label">{member.name}</span>
                                      </Link>
                                    ) : (
                                      <span className="table-assignee-cell">
                                        <Avatar
                                          className="completion-chart-avatar"
                                          size={32}
                                          borderWidth={1}
                                          name={member.name}
                                          avatarId={member.avatarId}
                                          photoUrl={member.avatarPhotoUrl}
                                          primaryColor={member.dashboardPrimaryColor}
                                          secondaryColor={member.dashboardPrimaryColor}
                                          fallbackColor={member.dashboardPrimaryColor ? "#ffffff" : undefined}
                                          referrerPolicy="no-referrer"
                                        />
                                        <span className="family-member-link-label">{member.name}</span>
                                      </span>
                                    )}
                                  </td>
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
                                  <td>{memberLastSignInLabel(member)}</td>
                                  <td>
                                    {canManageMembers &&
                                    member.id !== viewerUid &&
                                    member.uid !== viewerUid ? (
                                      <div className="member-actions">
                                        {canReinviteMember(member) ? (
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
                                        ) : null}
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
                                <div className="family-member-identity">
                                  <Avatar
                                    className="completion-chart-avatar"
                                    size={32}
                                    borderWidth={1}
                                    name={member.name}
                                    avatarId={member.avatarId}
                                    photoUrl={member.avatarPhotoUrl}
                                    primaryColor={member.dashboardPrimaryColor}
                                    secondaryColor={member.dashboardPrimaryColor}
                                    fallbackColor={member.dashboardPrimaryColor ? "#ffffff" : undefined}
                                    referrerPolicy="no-referrer"
                                  />
                                  <div>
                                    <h3 className="family-member-name">
                                      {canLinkToMemberProfile(member) ? (
                                        <Link href={memberProfileHref(member)} className="family-member-link">
                                          {member.name}
                                        </Link>
                                      ) : (
                                        member.name
                                      )}
                                    </h3>
                                    <p className="family-member-email">{member.email || "-"}</p>
                                  </div>
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
                                  <strong>{memberLastSignInLabel(member)}</strong>
                                </div>
                              </div>
                              {canManageMembers &&
                              member.id !== viewerUid &&
                              member.uid !== viewerUid ? (
                                <div className="family-member-actions">
                                  {canReinviteMember(member) ? (
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
                                  ) : null}
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
                    </section>
                    <section className="family-page-card family-categories-card" aria-label="Categories">
                      <div className="family-categories-card-header">
                        <div className="family-categories-card-title">
                          <h2>Categories</h2>
                          <p className="small">
                            {categories.length} categor{categories.length === 1 ? "y" : "ies"}
                          </p>
                        </div>
                        {canManageMembers ? (
                          <Button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              setShowCategoryManager(true);
                              setCategoryError("");
                            }}>
                            Manage Categories
                          </Button>
                        ) : null}
                      </div>
                      {categories.length > 0 ? (
                        <div className="family-category-chip-row">
                          {categories.map((category) => (
                            <span
                              key={category.id}
                              className="family-category-chip"
                              style={{ "--category-color": category.color } as CSSProperties}>
                              {category.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="small">No categories yet.</p>
                      )}
                    </section>
                    <section className="family-page-card family-categories-card" aria-label="Family awards">
                      <div className="family-categories-card-header">
                        <div className="family-categories-card-title">
                          <h2>Family Awards</h2>
                          <p className="small">
                            {familyRewards.length} reward{familyRewards.length === 1 ? "" : "s"}
                          </p>
                        </div>
                        {canManageMembers ? (
                          <Button
                            type="button"
                            className="btn btn-secondary"
                            onClick={openAddRewardDialog}>
                            Add Award
                          </Button>
                        ) : null}
                      </div>
                      {rewardLoadError ? (
                        <p className="small family-error">Could not load rewards: {rewardLoadError}</p>
                      ) : null}
                      {orderedFamilyRewards.length > 0 ? (
                        <div className="family-category-manage-list">
                          {orderedFamilyRewards.map((reward) => {
                            const image = findFamilyRewardImageOption(reward.imageId);
                            return (
                              <div
                                key={reward.id}
                                className="family-category-manage-item">
                                <div className={`flex items-center gap-3${reward.disabled ? " opacity-55" : ""}`}>
                                  <div className={`family-reward-chip-image-wrap${reward.disabled ? " grayscale" : ""}`}>
                                    <Image
                                      src={
                                        image?.imagePath ??
                                        FAMILY_REWARD_IMAGE_OPTIONS[0]?.imagePath ??
                                        "/rewards/screens.png"
                                      }
                                      alt={image?.label ?? "Reward image"}
                                      width={80}
                                      height={80}
                                      className="family-reward-chip-image"
                                    />
                                  </div>
                                  <div className="grid gap-0.5">
                                    <strong className={reward.disabled ? "text-slate-500" : "text-slate-800"}>
                                      {reward.description}
                                    </strong>
                                    <span className={`small ${reward.disabled ? "text-slate-400" : "text-slate-600"}`}>
                                      {reward.coinCost} coins
                                    </span>
                                    <span className={`small ${reward.disabled ? "text-slate-400" : "text-slate-500"}`}>
                                      {formatRewardLimitSummary(reward)}
                                    </span>
                                    {reward.disabled ? (
                                      <span className="small font-medium text-amber-700">Disabled</span>
                                    ) : null}
                                  </div>
                                </div>
                                {canManageMembers ? (
                                  <div className="relative flex items-center self-stretch">
                                    <Button
                                      type="button"
                                      className="btn btn-secondary member-action-btn"
                                      disabled={Boolean(rewardActionLoading) || rewardSaving}
                                      onClick={() =>
                                        setOpenRewardMenuId((current) =>
                                          current === reward.id ? "" : reward.id,
                                        )
                                      }
                                      aria-haspopup="menu"
                                      aria-expanded={openRewardMenuId === reward.id}
                                      title="Reward actions">
                                      ...
                                    </Button>
                                    {openRewardMenuId === reward.id ? (
                                      <div className="absolute right-0 top-1/2 z-20 min-w-32 -translate-y-1/2 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                                        <Button
                                          type="button"
                                          className="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                                          onClick={() => onEditReward(reward)}>
                                          Edit
                                        </Button>
                                        {reward.disabled ? (
                                          <Button
                                            type="button"
                                            className="block w-full rounded px-3 py-2 text-left text-sm text-emerald-700 hover:bg-emerald-50"
                                            onClick={() => void onEnableReward(reward)}>
                                            {rewardActionLoading?.rewardId === reward.id &&
                                            rewardActionLoading.action === "enable"
                                              ? "Re-enabling..."
                                              : "Re-enable"}
                                          </Button>
                                        ) : null}
                                        {reward.disabled ? (
                                          <Button
                                            type="button"
                                            className="block w-full rounded px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
                                            onClick={() =>
                                              {
                                                setOpenRewardMenuId("");
                                                setPendingRemoveReward({
                                                  id: reward.id,
                                                  description: reward.description,
                                                  playerNames: playerMemberNames,
                                                });
                                              }
                                            }>
                                            Delete
                                          </Button>
                                        ) : (
                                          <Button
                                            type="button"
                                            className="block w-full rounded px-3 py-2 text-left text-sm text-amber-700 hover:bg-amber-50"
                                            onClick={() =>
                                              {
                                                setOpenRewardMenuId("");
                                                setPendingDisableReward({
                                                  id: reward.id,
                                                  description: reward.description,
                                                });
                                              }
                                            }>
                                            Disable
                                          </Button>
                                        )}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="small">No custom rewards yet.</p>
                      )}
                    </section>
                  </div>
                </>
              )}
            </>
          ) : null}
      </main>

      <ModalShell open={showAddMemberForm} onRequestClose={() => setShowAddMemberForm(false)}>
        <div className="family-modal-card">
          <div className="modal-dialog-title-row family-modal-title-row">
          <h3 className="family-modal-title">Add Family Member</h3>
          <Button
            type="button"
            className="modal-close-button"
            onClick={() => setShowAddMemberForm(false)}
            aria-label="Close dialog"
            title="Close dialog">
            X
          </Button>
        </div>
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

      <ModalShell open={showCategoryManager} onRequestClose={() => setShowCategoryManager(false)}>
        <div className="family-modal-card">
          <div className="modal-dialog-title-row family-modal-title-row">
          <h3 className="family-modal-title">Manage Categories</h3>
          <Button
            type="button"
            className="modal-close-button"
            onClick={() => setShowCategoryManager(false)}
            aria-label="Close dialog"
            title="Close dialog">
            X
          </Button>
        </div>
          <p className="small mb-2">Create, recolor, rename, and remove chore categories.</p>
          <form className="flex w-full flex-col gap-3" onSubmit={onSaveCategory}>
            <label className="flex w-full flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Category Name</span>
              <input
                required
                maxLength={40}
                value={categoryForm.name}
                onChange={(event) =>
                  setCategoryForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Kitchen"
                className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
              />
            </label>
            <label className="flex w-full flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Chip Color</span>
              <div className="family-category-color-row">
                <input
                  type="color"
                  value={normalizeCategoryColor(categoryForm.color) || "#64748b"}
                  onChange={(event) =>
                    setCategoryForm((current) => ({ ...current, color: event.target.value }))
                  }
                  className="family-category-color-input"
                />
                <input
                  value={categoryForm.color}
                  onChange={(event) =>
                    setCategoryForm((current) => ({ ...current, color: event.target.value }))
                  }
                  placeholder="#3b82f6"
                  className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
                />
              </div>
            </label>
            {categoryError ? <p className="small family-error">Category update failed: {categoryError}</p> : null}
            <div className="family-modal-actions">
              {editingCategoryId ? (
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={categorySaving}
                  onClick={resetCategoryEditor}>
                  Cancel Edit
                </Button>
              ) : null}
              <Button
                type="submit"
                className="btn btn-primary"
                disabled={categorySaving}>
                {categorySaving
                  ? "Saving..."
                  : editingCategoryId
                    ? "Save Category"
                    : "Add Category"}
              </Button>
            </div>
          </form>

          <div className="family-category-manage-list">
            {categories.length === 0 ? (
              <p className="small">No categories yet.</p>
            ) : (
              categories.map((category) => (
                <div key={category.id} className="family-category-manage-item">
                  <span
                    className="family-category-chip"
                    style={{ "--category-color": category.color } as CSSProperties}>
                    {category.name}
                  </span>
                  <div className="member-actions">
                    <Button
                      type="button"
                      className="btn btn-secondary member-action-btn"
                      disabled={Boolean(categoryActionLoading) || categorySaving}
                      onClick={() => onEditCategory(category)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      className="btn member-action-remove"
                      disabled={Boolean(categoryActionLoading) || categorySaving}
                      onClick={() =>
                        setPendingRemoveCategory({
                          id: category.id,
                          name: category.name,
                        })
                      }>
                      {categoryActionLoading?.categoryId === category.id
                        ? "Working..."
                        : "Delete"}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </ModalShell>

      <ModalShell open={showRewardEditor} onRequestClose={resetRewardEditor}>
        <div className="family-modal-card">
          <div className="modal-dialog-title-row family-modal-title-row">
          <h3 className="family-modal-title">{editingRewardId ? "Edit Family Award" : "Add Family Award"}</h3>
          <Button
            type="button"
            className="modal-close-button"
            onClick={resetRewardEditor}
            aria-label="Close dialog"
            title="Close dialog">
            X
          </Button>
        </div>
          <p className="small mb-2">
            Add custom rewards your family can redeem with coins. Examples: extra screen time,
            ice cream, candy, soda, zoo trips, museum trips, vacations.
          </p>
          <form className="flex w-full flex-col gap-3" onSubmit={onSaveReward}>
            <label className="flex w-full flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Description</span>
              <input
                required
                maxLength={120}
                value={rewardForm.description}
                onChange={(event) =>
                  setRewardForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Extra screen time (30 minutes)"
                className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
              />
            </label>
            <label className="flex w-full flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Coin Amount</span>
              <input
                type="number"
                min={1}
                max={10000}
                required
                value={rewardForm.coinCost}
                onChange={(event) =>
                  setRewardForm((current) => ({ ...current, coinCost: event.target.value }))
                }
                placeholder="25"
                className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex w-full flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">Per Person Limit</span>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={rewardForm.individualLimit}
                  onChange={(event) =>
                    setRewardForm((current) => ({ ...current, individualLimit: event.target.value }))
                  }
                  placeholder="Unlimited"
                  className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
                />
                <span className="small text-slate-500">Use `0` or leave blank for unlimited.</span>
              </label>
              <label className="flex w-full flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">Family Limit</span>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={rewardForm.familyLimit}
                  onChange={(event) =>
                    setRewardForm((current) => ({ ...current, familyLimit: event.target.value }))
                  }
                  placeholder="Unlimited"
                  className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
                />
                <span className="small text-slate-500">Use `0` or leave blank for unlimited.</span>
              </label>
            </div>
            <label className="flex w-full flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Reward Image</span>
              <div className="family-reward-image-grid" role="radiogroup" aria-label="Reward image">
                {FAMILY_REWARD_IMAGE_OPTIONS.map((option) => {
                  const isSelected = rewardForm.imageId === option.id;
                  return (
                    <Button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      className={`family-reward-image-option${isSelected ? " is-selected" : ""}`}
                      onClick={() =>
                        setRewardForm((current) => ({ ...current, imageId: option.id }))
                      }>
                      <span className="family-reward-image-option-media">
                        <Image
                          src={option.imagePath}
                          alt={option.label}
                          width={120}
                          height={120}
                          className="family-reward-image-option-img"
                        />
                      </span>
                      <span className="family-reward-image-option-label">{option.label}</span>
                    </Button>
                  );
                })}
              </div>
            </label>
            {rewardError ? <p className="small family-error">Reward update failed: {rewardError}</p> : null}
            <div className="family-modal-actions">
              {editingRewardId ? (
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={rewardSaving}
                  onClick={resetRewardEditor}>
                  Cancel Edit
                </Button>
              ) : null}
              <Button
                type="submit"
                className="btn btn-primary"
                disabled={rewardSaving}>
                {rewardSaving
                  ? "Saving..."
                  : editingRewardId
                    ? "Save Reward"
                    : "Add Reward"}
              </Button>
            </div>
          </form>
        </div>
      </ModalShell>

      <ModalShell
        open={Boolean(pendingDisableReward)}
        onRequestClose={() => setPendingDisableReward(null)}>
        <div className="family-modal-card">
          {pendingDisableReward ? (
            <>
              <div className="modal-dialog-title-row family-modal-title-row">
          <h3 className="family-modal-title">Disable Family Award</h3>
          <Button
            type="button"
            className="modal-close-button"
            onClick={() => setPendingDisableReward(null)}
            aria-label="Close dialog"
            title="Close dialog">
            X
          </Button>
        </div>
              <p className="mb-4 text-sm text-slate-600">
                Disable <strong>{pendingDisableReward.description}</strong>? It will no longer be available for redemption.
              </p>
              <div className="family-modal-actions">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={Boolean(rewardActionLoading)}
                  onClick={() => setPendingDisableReward(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="btn member-action-remove"
                  disabled={Boolean(rewardActionLoading)}
                  onClick={onDisableReward}>
                  {rewardActionLoading?.action === "disable" ? "Disabling..." : "Disable"}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>

      <ModalShell
        open={Boolean(pendingRemoveReward)}
        onRequestClose={() => setPendingRemoveReward(null)}>
        <div className="family-modal-card">
          {pendingRemoveReward ? (
            <>
              <div className="modal-dialog-title-row family-modal-title-row">
          <h3 className="family-modal-title">Delete Family Award</h3>
          <Button
            type="button"
            className="modal-close-button"
            onClick={() => setPendingRemoveReward(null)}
            aria-label="Close dialog"
            title="Close dialog">
            X
          </Button>
        </div>
              <p className="mb-4 text-sm text-slate-600">
                Delete <strong>{pendingRemoveReward.description}</strong>? It will also remove the award from players{" "}
                <strong>
                  {pendingRemoveReward.playerNames.length > 0
                    ? pendingRemoveReward.playerNames.join(", ")
                    : "in this family"}
                </strong>.
              </p>
              <div className="family-modal-actions">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={Boolean(rewardActionLoading)}
                  onClick={() => setPendingRemoveReward(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="btn member-action-remove"
                  disabled={Boolean(rewardActionLoading)}
                  onClick={onDeleteReward}>
                  {rewardActionLoading ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>

      <ModalShell
        open={Boolean(pendingRemoveMember)}
        onRequestClose={() => setPendingRemoveMember(null)}>
        <div className="family-modal-card">
          {pendingRemoveMember ? (
            <>
              <div className="modal-dialog-title-row family-modal-title-row">
          <h3 className="family-modal-title">Remove Family Member</h3>
          <Button
            type="button"
            className="modal-close-button"
            onClick={() => setPendingRemoveMember(null)}
            aria-label="Close dialog"
            title="Close dialog">
            X
          </Button>
        </div>
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

      <ModalShell
        open={Boolean(pendingRemoveCategory)}
        onRequestClose={() => setPendingRemoveCategory(null)}>
        <div className="family-modal-card">
          {pendingRemoveCategory ? (
            <>
              <div className="modal-dialog-title-row family-modal-title-row">
          <h3 className="family-modal-title">Delete Category</h3>
          <Button
            type="button"
            className="modal-close-button"
            onClick={() => setPendingRemoveCategory(null)}
            aria-label="Close dialog"
            title="Close dialog">
            X
          </Button>
        </div>
              <p className="mb-4 text-sm text-slate-600">
                Delete <strong>{pendingRemoveCategory.name}</strong>?
                Existing chores will keep working and this category will be removed from them.
              </p>
              <div className="family-modal-actions">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={Boolean(categoryActionLoading)}
                  onClick={() => setPendingRemoveCategory(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="btn member-action-remove"
                  disabled={Boolean(categoryActionLoading)}
                  onClick={onDeleteCategory}>
                  {categoryActionLoading ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>
    </>
  );
}



