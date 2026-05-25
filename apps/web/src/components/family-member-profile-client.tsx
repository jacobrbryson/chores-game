"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AccountSwitchModal } from "@/components/account-switch-modal";
import { Alert } from "@/components/alert";
import { Avatar } from "@/components/avatar";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { EnumChip, humanizeEnum } from "@/components/enum-chip";
import { ModalShell } from "@/components/modal-shell";
import { formatDateTime } from "@/components/profile/profile-page.utils";
import { findFamilyRewardImageOption } from "@/lib/family/rewards";

type FamilyMemberProfileClientProps = {
  memberId: string;
};

type FamilyAwardClaim = {
  id: string;
  rewardDescription: string;
  rewardImageId: string;
  coinCost: number;
  purchasedAt?: string;
  claimedAt?: string;
  claimedByName?: string;
};

type OwnedItem = {
  id: string;
  name: string;
  description: string;
  image: string;
  category: string;
  quantity: number;
  source: "inventory" | "store_unlock";
  paidValue: number;
  acquisitionLabel: string;
};

type FamilyMemberProfileResponse = {
  familyId: string;
  familyName: string;
  viewerUid: string;
  viewerRole: "admin" | "player";
  canManageAwards: boolean;
  member: {
    id: string;
    uid?: string;
    name: string;
    email: string;
    role: "admin" | "player";
    status: "active" | "invited";
    lastSignInAt?: string;
    avatarId?: string;
    avatarPhotoUrl?: string;
  };
  theme: {
    name: string;
    palette: {
      primary: string;
      secondary: string;
      tertiary: string;
    };
    isDefault: boolean;
  };
  confetti: {
    name: string;
    colors: string[];
    isDefault: boolean;
  };
  ownedItems: OwnedItem[];
  unclaimedAwards: FamilyAwardClaim[];
  claimedAwards: FamilyAwardClaim[];
};

function categoryIcon(category: string) {
  const key = category.trim().toLowerCase();
  if (key.includes("confetti")) return "\u{1F389}";
  if (key.includes("avatar")) return "\u{1F9D1}";
  if (key.includes("color")) return "\u{1F3A8}";
  if (key.includes("quest")) return "\u{1F5FA}\uFE0F";
  if (key.includes("reward")) return "\u{1F3C6}";
  if (key.includes("inventory")) return "\u{1F392}";
  return "\u2728";
}

function categoryTone(category: string) {
  const key = category.trim().toLowerCase();
  if (key.includes("confetti")) return "violet" as const;
  if (key.includes("avatar")) return "indigo" as const;
  if (key.includes("color")) return "teal" as const;
  if (key.includes("quest")) return "amber" as const;
  if (key.includes("reward")) return "rose" as const;
  if (key.includes("inventory")) return "green" as const;
  return "blue" as const;
}

function categoryCardStyle(category: string) {
  const tone = categoryTone(category);
  if (tone === "violet") return { backgroundColor: "#f5f3ff", borderColor: "#ddd6fe" };
  if (tone === "indigo") return { backgroundColor: "#eef2ff", borderColor: "#c7d2fe" };
  if (tone === "teal") return { backgroundColor: "#f0fdfa", borderColor: "#99f6e4" };
  if (tone === "amber") return { backgroundColor: "#fffbeb", borderColor: "#fde68a" };
  if (tone === "rose") return { backgroundColor: "#fff1f2", borderColor: "#fecdd3" };
  if (tone === "green") return { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" };
  return { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" };
}

export function FamilyMemberProfileClient({ memberId }: FamilyMemberProfileClientProps) {
  const [profile, setProfile] = useState<FamilyMemberProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [claimingAwardId, setClaimingAwardId] = useState("");
  const [claimError, setClaimError] = useState("");
  const [pendingRemove, setPendingRemove] = useState(false);
  const [removePending, setRemovePending] = useState(false);
  const [memberActionError, setMemberActionError] = useState("");
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false);
  const [switchPin, setSwitchPin] = useState("");
  const [switchPinConfirm, setSwitchPinConfirm] = useState("");
  const [switchPending, setSwitchPending] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [switchRequiresPinSetup, setSwitchRequiresPinSetup] = useState(false);

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/family/members/${encodeURIComponent(memberId)}/profile`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `FAMILY_MEMBER_PROFILE_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as FamilyMemberProfileResponse;
      setProfile(payload);
    } catch (errorValue) {
      setProfile(null);
      setError(errorValue instanceof Error ? errorValue.message : "member_profile_unavailable");
    } finally {
      setIsLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const categoryCounts = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const item of profile?.ownedItems ?? []) {
      byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + Math.max(0, item.quantity));
    }
    return Array.from(byCategory.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  }, [profile?.ownedItems]);

  const canManageThisMember = Boolean(
    profile &&
      profile.viewerRole === "admin" &&
      profile.member.id !== profile.viewerUid &&
      profile.member.uid !== profile.viewerUid,
  );
  const canSwitchToMember = Boolean(canManageThisMember && profile?.member.role === "player");

  function closeSwitchDialog() {
    setSwitchDialogOpen(false);
    setSwitchPin("");
    setSwitchPinConfirm("");
    setSwitchError("");
    setSwitchRequiresPinSetup(false);
  }

  async function onSwitchAccount() {
    if (!profile || switchPending) {
      return;
    }
    setSwitchPending(true);
    setSwitchError("");
    try {
      const response = await fetch("/api/account-switch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: profile.member.id,
          pin: switchPin,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        if (payload.error === "pin_not_configured") {
          setSwitchRequiresPinSetup(true);
          throw new Error("pin_not_configured");
        }
        throw new Error(payload.error ?? `SWITCH_ACCOUNT_HTTP_${response.status}`);
      }
      window.location.assign("/");
    } catch (errorValue) {
      setSwitchError(errorValue instanceof Error ? errorValue.message : "switch_account_failed");
    } finally {
      setSwitchPending(false);
    }
  }

  async function onSetupPinAndSwitch() {
    if (!profile || switchPending) {
      return;
    }
    setSwitchPending(true);
    setSwitchError("");
    try {
      const pinResponse = await fetch("/api/account-switch/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin: switchPin,
          confirmPin: switchPinConfirm,
        }),
      });
      if (!pinResponse.ok) {
        const payload = (await pinResponse.json()) as { error?: string };
        throw new Error(payload.error ?? `PIN_SETUP_HTTP_${pinResponse.status}`);
      }

      const switchResponse = await fetch("/api/account-switch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: profile.member.id,
          pin: switchPin,
        }),
      });
      if (!switchResponse.ok) {
        const payload = (await switchResponse.json()) as { error?: string };
        throw new Error(payload.error ?? `SWITCH_ACCOUNT_HTTP_${switchResponse.status}`);
      }

      window.location.assign("/");
    } catch (errorValue) {
      setSwitchError(errorValue instanceof Error ? errorValue.message : "switch_account_failed");
    } finally {
      setSwitchPending(false);
    }
  }

  async function onRemoveMember() {
    if (!profile || removePending) {
      return;
    }
    setRemovePending(true);
    setMemberActionError("");
    try {
      const response = await fetch(`/api/family/members/${encodeURIComponent(profile.member.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `REMOVE_MEMBER_HTTP_${response.status}`);
      }
      window.location.assign("/family");
    } catch (errorValue) {
      setMemberActionError(errorValue instanceof Error ? errorValue.message : "remove_member_failed");
      setRemovePending(false);
      setPendingRemove(false);
    }
  }

  async function onClaimAward(awardId: string) {
    if (!profile || !profile.canManageAwards || claimingAwardId) {
      return;
    }
    setClaimingAwardId(awardId);
    setClaimError("");
    try {
      const response = await fetch(
        `/api/family/members/${encodeURIComponent(memberId)}/awards/${encodeURIComponent(awardId)}`,
        { method: "PATCH" },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `FAMILY_MEMBER_AWARD_CLAIM_HTTP_${response.status}`);
      }
      await loadProfile();
    } catch (errorValue) {
      setClaimError(errorValue instanceof Error ? errorValue.message : "claim_award_failed");
    } finally {
      setClaimingAwardId("");
    }
  }

  return (
    <main className="panel family-page profile-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link" fallbackHref="/family" />
          <h1>{profile?.member.name || "Family Profile"}</h1>
        </div>
      </div>
      <p className="small family-page-subhead">Family profile details and pending family awards.</p>

      {isLoading ? <p className="small">Loading family profile...</p> : null}
      {!isLoading && error ? <Alert>Could not load family profile: {error}</Alert> : null}

      {!isLoading && !error && profile ? (
        <>
          <section className="profile-page-grid family-member-profile-grid">
            <article className="profile-page-avatar-card family-member-profile-card">
              <div className="family-member-profile-card-header">
                <h2>Details</h2>
                {canManageThisMember ? (
                  <div className="family-member-profile-actions">
                    {canSwitchToMember ? (
                      <Button
                        type="button"
                        className="btn btn-secondary"
                        disabled={switchPending || removePending}
                        onClick={() => {
                          setSwitchDialogOpen(true);
                          setSwitchError("");
                          setMemberActionError("");
                        }}>
                        Switch To
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      className="btn member-action-remove"
                      disabled={switchPending || removePending}
                      onClick={() => {
                        setPendingRemove(true);
                        setMemberActionError("");
                      }}>
                      Remove
                    </Button>
                  </div>
                ) : null}
              </div>
              {memberActionError ? <Alert>Member update failed: {memberActionError}</Alert> : null}
              <div className="profile-page-account-row">
                <div className="profile-page-account-avatar">
                  <Avatar
                    className="profile-page-avatar-frame"
                    size={140}
                    borderWidth={3}
                    name={profile.member.name}
                    avatarId={profile.member.avatarId}
                    photoUrl={profile.member.avatarPhotoUrl || ""}
                    primaryColor={profile.theme.palette.primary}
                    secondaryColor={profile.theme.palette.primary}
                    fallbackColor="#ffffff"
                    referrerPolicy="no-referrer"
                    loading="eager"
                  />
                </div>
                <dl className="profile-page-fields profile-page-basic-fields">
                  <div><dt>Name</dt><dd>{profile.member.name}</dd></div>
                  <div><dt>Email</dt><dd>{profile.member.email || "-"}</dd></div>
                  <div>
                    <dt>Role</dt>
                    <dd><EnumChip label={humanizeEnum(profile.member.role)} tone={profile.member.role === "admin" ? "indigo" : "teal"} /></dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd><EnumChip label={humanizeEnum(profile.member.status)} tone={profile.member.status === "active" ? "green" : "amber"} /></dd>
                  </div>
                  <div><dt>Last Sign In</dt><dd>{formatDateTime(profile.member.lastSignInAt)}</dd></div>
                </dl>
              </div>
              <dl className="profile-page-fields profile-page-style-fields">
                <div>
                  <dt>Theme</dt>
                  <dd className="profile-page-theme-line">
                    <span className="profile-page-theme-name">{profile.theme.name}{profile.theme.isDefault ? " (default)" : ""}</span>
                    <span className="profile-page-theme-swatches" aria-hidden="true">
                      <span className="profile-theme-swatch" style={{ backgroundColor: profile.theme.palette.primary }} />
                      <span className="profile-theme-swatch" style={{ backgroundColor: profile.theme.palette.secondary }} />
                      <span className="profile-theme-swatch" style={{ backgroundColor: profile.theme.palette.tertiary }} />
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Victory Confetti</dt>
                  <dd className="profile-page-theme-line">
                    <span className="profile-page-theme-name">{profile.confetti.name}{profile.confetti.isDefault ? " (default)" : ""}</span>
                    {!profile.confetti.isDefault && profile.confetti.colors.length > 0 ? (
                      <span className="profile-page-theme-swatches" aria-hidden="true">
                        {profile.confetti.colors.map((color, index) => (
                          <span key={`${color}-${index}`} className="profile-theme-swatch" style={{ backgroundColor: color }} />
                        ))}
                      </span>
                    ) : null}
                  </dd>
                </div>
              </dl>
            </article>
          </section>

          <section className="family-page-card family-member-awards-card" aria-label="Unclaimed family awards">
            <div className="family-page-card-header family-member-awards-header">
              <div>
                <h2>Unclaimed Family Awards</h2>
                <p className="small family-page-subhead">
                  {profile.unclaimedAwards.length} pending reward
                  {profile.unclaimedAwards.length === 1 ? "" : "s"}
                </p>
              </div>
              <Link href={`/family/${encodeURIComponent(memberId)}/awards`} className="family-member-history-link">
                View claimed awards ({profile.claimedAwards.length})
              </Link>
            </div>

            {claimError ? <Alert>Could not claim award: {claimError}</Alert> : null}

            {profile.unclaimedAwards.length === 0 ? (
              <p className="small">No unclaimed family awards right now.</p>
            ) : (
              <div className="family-award-claim-list">
                {profile.unclaimedAwards.map((award) => {
                  const rewardImage = findFamilyRewardImageOption(award.rewardImageId);
                  return (
                    <article key={award.id} className="family-award-claim-card">
                      <div className="family-award-claim-media">
                        <Image
                          src={rewardImage?.imagePath ?? "/rewards/screens.png"}
                          alt={rewardImage?.label ?? award.rewardDescription}
                          width={120}
                          height={120}
                          className="family-award-claim-image"
                        />
                      </div>
                      <div className="family-award-claim-copy">
                        <h3>{award.rewardDescription}</h3>
                        <p className="small">{award.coinCost} coins</p>
                        <p className="small">Purchased: {formatDateTime(award.purchasedAt)}</p>
                      </div>
                      {profile.canManageAwards ? (
                        <div className="family-award-claim-actions">
                          <Button type="button" className="btn btn-primary" disabled={claimingAwardId.length > 0} onClick={() => void onClaimAward(award.id)}>
                            {claimingAwardId === award.id ? "Claiming..." : "Claim"}
                          </Button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="family-page-card profile-owned-items-card" aria-label="Owned items summary">
            <div className="family-page-card-header family-member-awards-header">
              <div>
                <h2>Owned Items</h2>
                <p className="small family-page-subhead">High-level inventory by category.</p>
              </div>
              <Link href={`/family/${encodeURIComponent(memberId)}/items`} className="family-member-history-link">
                View all items ({profile.ownedItems.length})
              </Link>
            </div>
            {categoryCounts.length === 0 ? (
              <p className="small">No owned items yet.</p>
            ) : (
              <div className="family-award-claim-list">
                {categoryCounts.map(({ category, count }) => (
                  <Link
                    key={category}
                    href={`/family/${encodeURIComponent(memberId)}/items?category=${encodeURIComponent(category)}`}
                    className="family-award-claim-card family-category-summary-card"
                    style={categoryCardStyle(category)}>
                    <div className="family-award-claim-media family-category-summary-media" aria-hidden="true">
                      <div className="family-category-summary-icon">{categoryIcon(category)}</div>
                    </div>
                    <div className="family-award-claim-copy">
                      <h3>{humanizeEnum(category)}</h3>
                      <p className="small">{count} item{count === 1 ? "" : "s"}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
      <AccountSwitchModal
        open={switchDialogOpen}
        onRequestClose={closeSwitchDialog}
        memberName={profile?.member.name ?? ""}
        pin={switchPin}
        onPinChange={setSwitchPin}
        confirmPin={switchPinConfirm}
        onConfirmPinChange={setSwitchPinConfirm}
        pending={switchPending}
        error={switchError}
        requiresPinSetup={switchRequiresPinSetup}
        onConfirm={switchRequiresPinSetup ? onSetupPinAndSwitch : onSwitchAccount}
      />
      <ModalShell open={pendingRemove} onRequestClose={() => setPendingRemove(false)}>
        <div className="family-modal-card">
          {profile ? (
            <>
              <div className="modal-dialog-title-row family-modal-title-row">
                <h3 className="family-modal-title">Remove Family Member</h3>
                <Button
                  type="button"
                  className="modal-close-button"
                  onClick={() => setPendingRemove(false)}
                  aria-label="Close dialog"
                  title="Close dialog">
                  X
                </Button>
              </div>
              <p className="mb-4 text-sm text-slate-600">
                Remove <strong>{profile.member.name}</strong> from your family?
              </p>
              <div className="family-modal-actions">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={removePending}
                  onClick={() => setPendingRemove(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="btn member-action-remove"
                  disabled={removePending}
                  onClick={onRemoveMember}>
                  {removePending ? "Removing..." : "Remove"}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>
    </main>
  );
}
