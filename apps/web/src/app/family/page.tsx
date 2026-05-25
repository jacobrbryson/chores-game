"use client";

import Image from "next/image";
import Link from "next/link";
import { CSSProperties, Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/alert";
import { AppMenu } from "@/components/app-menu";
import { Avatar } from "@/components/avatar";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { CoinIcon } from "@/components/coin-icon";
import { EnumChip, humanizeEnum } from "@/components/enum-chip";
import { FamilySectionTabs, type FamilySectionTabId } from "@/components/family/family-section-tabs";
import { FamilyQuestsSection } from "@/components/family-quests-section";
import { ModalShell } from "@/components/modal-shell";
import type { FamilySummaryResponse } from "@/lib/family/types";
import { usePersistedTab } from "@/lib/hooks/use-persisted-tab";
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

const FAMILY_TAB_IDS: readonly FamilySectionTabId[] = ["members", "awards", "categories", "quests"];

type AddMemberFieldsProps = {
  form: AddMemberState;
  setForm: Dispatch<SetStateAction<AddMemberState>>;
};

function AddMemberFields({ form, setForm }: AddMemberFieldsProps) {
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const roleLabel = form.role === "admin" ? "Parent (admin)" : "Child (player)";
  const emailIsRequired = form.role === "admin";

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
          required={emailIsRequired}
          value={form.email}
          onChange={(event) =>
            setForm((current) => ({ ...current, email: event.target.value }))
          }
          placeholder={emailIsRequired ? "avery@example.com" : "Optional for children"}
          className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
        />
        {form.role === "player" ? (
          <span className="small text-slate-500">
            Leave blank to create a managed child profile without Google sign-in for now.
          </span>
        ) : null}
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

function formatWholeNumber(value: number) {
  return Math.max(0, Math.trunc(value)).toLocaleString();
}

function FamilyMemberStats({ member, compact = false }: { member: FamilyMember; compact?: boolean }) {
  const statsClassName = compact ? "family-member-stats family-member-stats-compact" : "family-member-stats";

  return (
    <div className={statsClassName}>
      <div className="family-member-stat">
        <span className="family-member-stat-label" title="Lifetime Chores Completed">
          Lifetime Chores Completed
        </span>
        <strong className="family-member-stat-value">
          {formatWholeNumber(member.stats.lifetimeChoresCompleted)}
        </strong>
      </div>
      <div className="family-member-stat family-member-stat-coins">
        <span className="family-member-stat-label" title="Lifetime Coins Earned">
          Lifetime Coins Earned
        </span>
        <strong className="family-member-stat-value">
          <CoinIcon size={14} className="family-member-stat-icon" />
          {formatWholeNumber(member.stats.lifetimeCoinsEarned)}
        </strong>
      </div>
      <div className="family-member-stat family-member-stat-current">
        <span className="family-member-stat-label" title="Current Coins">
          Current Coins
        </span>
        <strong className="family-member-stat-value">
          <CoinIcon size={14} className="family-member-stat-icon" />
          {formatWholeNumber(member.stats.currentCoins)}
        </strong>
      </div>
    </div>
  );
}

function memberProfileHref(member: FamilyMember) {
  return `/family/${encodeURIComponent(member.uid || member.id)}`;
}

function canLinkToMemberProfile(member: FamilyMember) {
  return true;
}

function ActionMenuDots() {
  return (
    <span className="action-menu-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function MembersSkeleton() {
  return (
    <div className="family-table-wrap family-table-desktop" aria-label="Loading members">
      <table className="family-table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Status / Last Sign In</th>
            <th>Stats</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 3 }).map((_, index) => (
            <tr key={index}>
              <td>
                <div className="family-skeleton family-skeleton-row" />
              </td>
              <td>
                <div className="family-skeleton family-skeleton-row" />
              </td>
              <td>
                <div className="family-skeleton family-skeleton-row" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AwardsSkeleton() {
  return (
    <div className="family-category-manage-list" aria-label="Loading awards">
      <div className="family-skeleton family-skeleton-reward" />
      <div className="family-skeleton family-skeleton-reward" />
    </div>
  );
}

function CategoriesSkeleton() {
  return (
    <section className="family-page-card family-categories-card" aria-label="Loading categories">
      <div className="family-page-card-header">
        <div className="family-skeleton family-skeleton-title" />
        <div className="family-skeleton family-skeleton-button" />
      </div>
      <div className="family-skeleton-chip-row">
        <div className="family-skeleton family-skeleton-chip" />
        <div className="family-skeleton family-skeleton-chip" />
        <div className="family-skeleton family-skeleton-chip" />
      </div>
    </section>
  );
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
  const [showAddMemberForm, setShowAddMemberForm] = useState(false);
  const [activeFamilyTab, setActiveFamilyTab] = usePersistedTab<FamilySectionTabId>({
    storageKey: "family-page-active-tab",
    defaultTab: "members",
    validTabs: FAMILY_TAB_IDS,
  });

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

  function setRewardMenuOpen(rewardId: string, open: boolean) {
    setOpenRewardMenuId(open ? rewardId : "");
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

  function onSelectRewardImage(option: (typeof FAMILY_REWARD_IMAGE_OPTIONS)[number]) {
    setRewardForm((current) => ({
      ...current,
      imageId: option.id,
      description: option.label,
    }));
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
  const canManageMembers = Boolean(summary?.noFamily) || viewerMember?.role === "admin";

  return (
    <>
      <main className="family-page">
          <div className="page-header-row">
            <div className="page-header-inline">
              <BackLink className="page-back-link" fallbackHref="/" />
              <h1>Family</h1>
            </div>
          </div>

          {!isLoading && error ? <Alert>Could not load members: {error}</Alert> : null}
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 pt-3">
              <FamilySectionTabs activeTab={activeFamilyTab} onChange={setActiveFamilyTab} />
            </div>
            <div className="p-4">
          {isLoading && !error ? (
            <div className="family-page-grid" aria-hidden="true">
              {activeFamilyTab === "members" ? <MembersSkeleton /> : null}
              {activeFamilyTab === "awards" ? <AwardsSkeleton /> : null}
              {activeFamilyTab === "categories" ? <CategoriesSkeleton /> : null}
              {activeFamilyTab === "quests" ? <AwardsSkeleton /> : null}
            </div>
          ) : null}
          {!isLoading && !error ? (
            <>
              {summary?.pendingInvite ? (
                <p className="small">
                  Invitation is pending acceptance. Go back to the home dashboard to accept it.
                </p>
              ) : (
                <>
                  {summary?.noFamily ? (
                    <p className="small">
                      No family is linked to this account yet. Add your first family member and the
                      app will create your family with you as the admin.
                    </p>
                  ) : null}
                  <div className="family-page-grid">
                    {activeFamilyTab === "members" ? (
                    <section aria-label="Family members">
                      <div className="family-table-wrap family-table-desktop">
                        <table className="family-table">
                          <thead>
                            <tr>
                              <th>Member</th>
                              <th>Status / Last Sign In</th>
                              <th>Stats</th>
                            </tr>
                          </thead>
                          <tbody>
                            {members.length === 0 ? (
                              <tr>
                                <td colSpan={3}>No family members found.</td>
                              </tr>
                            ) : (
                              members.map((member) => {
                                const memberHref = memberProfileHref(member);
                                return (
                                <tr
                                  key={member.id}
                                  className="family-member-table-row"
                                  role="link"
                                  tabIndex={0}
                                  onClick={() => {
                                    window.location.assign(memberHref);
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      window.location.assign(memberHref);
                                    }
                                  }}>
                                  <td title={`${member.name}${member.email ? ` - ${member.email}` : ""} - ${humanizeEnum(member.role)}`}>
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
                                      <span className="family-member-table-copy">
                                        <span className="family-member-table-name-row">
                                          <span className="family-member-link-label" title={member.name}>
                                            {member.name}
                                          </span>
                                          <EnumChip
                                            label={humanizeEnum(member.role)}
                                            tone={memberRoleTone(member.role)}
                                          />
                                        </span>
                                        <span className="family-member-email" title={member.email || "-"}>
                                          {member.email || "-"}
                                        </span>
                                      </span>
                                    </span>
                                  </td>
                                  <td title={`${humanizeEnum(member.status)} - ${memberLastSignInLabel(member)}`}>
                                    <EnumChip
                                      label={humanizeEnum(member.status)}
                                      tone={memberStatusTone(member.status)}
                                    />
                                    <span className="family-member-table-secondary">
                                      {memberLastSignInLabel(member)}
                                    </span>
                                  </td>
                                  <td className="family-member-stats-cell">
                                    <FamilyMemberStats member={member} compact />
                                  </td>
                                </tr>
                                );
                              })
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
                              <FamilyMemberStats member={member} />
                            </article>
                          ))
                        )}
                      </div>
                      {canManageMembers ? (
                        <div className="mt-4 flex justify-center">
                          <Button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => setShowAddMemberForm(true)}>
                            Add Family Member
                          </Button>
                        </div>
                      ) : null}
                    </section>
                    ) : null}
                    {activeFamilyTab === "categories" ? (
                    <section aria-label="Categories">
                      {categories.length > 0 ? (
                        <div className="family-category-manage-list">
                          {categories.map((category) => (
                            <div key={category.id} className="family-category-manage-item">
                              <span
                                className="family-category-chip"
                                style={{ "--category-color": category.color } as CSSProperties}>
                                {category.name}
                              </span>
                              {canManageMembers ? (
                                <div className="member-actions">
                                  <Button
                                    type="button"
                                    className="btn btn-secondary member-action-btn"
                                    disabled={Boolean(categoryActionLoading) || categorySaving}
                                    onClick={() => {
                                      onEditCategory(category);
                                      setShowCategoryManager(true);
                                    }}>
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
                                    {categoryActionLoading?.categoryId === category.id ? "Working..." : "Delete"}
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Alert tone="info" role="status" className="family-awards-info-card">
                          <div className="grid gap-1">
                            <strong>Categories organize chores into clear household areas.</strong>
                            <span>
                              Parents create categories such as Kitchen, Bedrooms, Pets, or Yard so chores are easier
                              to group and scan. Everyone sees categories wherever chores are created or reviewed, and
                              they help your family keep recurring work understandable before the list gets long.
                            </span>
                          </div>
                        </Alert>
                      )}
                      {canManageMembers ? (
                        <div className="mt-4 flex justify-center">
                          <Button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => {
                              resetCategoryEditor();
                              setShowCategoryManager(true);
                            }}>
                            Add Category
                          </Button>
                        </div>
                      ) : null}
                    </section>
                    ) : null}
                    {activeFamilyTab === "awards" ? (
                    <section aria-label="Family awards">
                      {rewardLoadError ? <Alert>Could not load rewards: {rewardLoadError}</Alert> : null}
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
                                  <AppMenu
                                    open={openRewardMenuId === reward.id}
                                    onOpenChange={(open) => setRewardMenuOpen(reward.id, open)}
                                    wrapperClassName="flex items-center self-stretch"
                                    triggerClassName="btn btn-secondary member-action-btn"
                                    triggerDisabled={Boolean(rewardActionLoading) || rewardSaving}
                                    triggerTitle="Reward actions"
                                    triggerAriaLabel={`Open actions for ${reward.description}`}
                                    panelClassName="app-menu-panel family-action-dropdown"
                                    trigger={<ActionMenuDots />}>
                                    <Button
                                      type="button"
                                      className="menu-action-link menu-action-link-full"
                                      onClick={() => onEditReward(reward)}>
                                      Edit
                                    </Button>
                                    {reward.disabled ? (
                                      <Button
                                        type="button"
                                        className="menu-action-link menu-action-link-full menu-action-link-success"
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
                                        className="menu-action-link menu-action-link-full menu-action-link-danger"
                                        onClick={() => {
                                          setOpenRewardMenuId("");
                                          setPendingRemoveReward({
                                            id: reward.id,
                                            description: reward.description,
                                            playerNames: playerMemberNames,
                                          });
                                        }}>
                                        Delete
                                      </Button>
                                    ) : (
                                      <Button
                                        type="button"
                                        className="menu-action-link menu-action-link-full menu-action-link-warning"
                                        onClick={() => {
                                          setOpenRewardMenuId("");
                                          setPendingDisableReward({
                                            id: reward.id,
                                            description: reward.description,
                                          });
                                        }}>
                                        Disable
                                      </Button>
                                    )}
                                  </AppMenu>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <Alert tone="info" role="status" className="family-awards-info-card">
                          <div className="grid gap-1">
                            <strong>Family awards are custom prizes kids can redeem with coins.</strong>
                            <span>
                              Parents create awards like extra screen time, a special snack, or a weekend activity.
                              Kids earn coins from chores, spend them on available awards, and parents can later
                              review and claim the reward from each member profile. Add awards whenever your family
                              wants clear, trackable goals beyond avatar and store items.
                            </span>
                          </div>
                        </Alert>
                      )}
                      {canManageMembers ? (
                        <div className="mt-4 flex justify-center">
                          <Button
                            type="button"
                            className="btn btn-primary"
                            onClick={openAddRewardDialog}>
                            Add Award
                          </Button>
                        </div>
                      ) : null}
                    </section>
                    ) : null}
                    {activeFamilyTab === "quests" ? <FamilyQuestsSection /> : null}
                  </div>
                </>
              )}
            </>
          ) : null}
            </div>
          </section>
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
          <h3 className="family-modal-title">{editingCategoryId ? "Edit Category" : "Add Category"}</h3>
          <Button
            type="button"
            className="modal-close-button"
            onClick={() => setShowCategoryManager(false)}
            aria-label="Close dialog"
            title="Close dialog">
            X
          </Button>
        </div>
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
            {categoryError ? <Alert>Category update failed: {categoryError}</Alert> : null}
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
                    onClick={() => onSelectRewardImage(option)}>
                    <span className="family-reward-image-option-media">
                      <Image
                        src={option.imagePath}
                        alt={option.label}
                        width={120}
                        height={120}
                        className="family-reward-image-option-img"
                      />
                    </span>
                  </Button>
                );
              })}
            </div>
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
            {rewardError ? <Alert>Reward update failed: {rewardError}</Alert> : null}
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



