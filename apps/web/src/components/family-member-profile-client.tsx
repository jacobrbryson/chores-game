"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Avatar } from "@/components/avatar";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { EnumChip, humanizeEnum } from "@/components/enum-chip";
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

type FamilyMemberProfileResponse = {
  familyId: string;
  familyName: string;
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
  unclaimedAwards: FamilyAwardClaim[];
  claimedAwards: FamilyAwardClaim[];
};

export function FamilyMemberProfileClient({
  memberId,
}: FamilyMemberProfileClientProps) {
  const [profile, setProfile] = useState<FamilyMemberProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [claimingAwardId, setClaimingAwardId] = useState("");
  const [claimError, setClaimError] = useState("");

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

  async function onClaimAward(awardId: string) {
    if (!profile || !profile.canManageAwards || claimingAwardId) {
      return;
    }
    setClaimingAwardId(awardId);
    setClaimError("");
    try {
      const response = await fetch(
        `/api/family/members/${encodeURIComponent(memberId)}/awards/${encodeURIComponent(awardId)}`,
        {
          method: "PATCH",
        },
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
      <p className="small family-page-subhead">
        Family profile details and pending family awards.
      </p>

      {isLoading ? <p className="small">Loading family profile...</p> : null}
      {!isLoading && error ? <Alert>Could not load family profile: {error}</Alert> : null}

      {!isLoading && !error && profile ? (
        <>
          <section className="profile-page-grid family-member-profile-grid">
            <article className="profile-page-avatar-card family-member-profile-card">
              <h2>Details</h2>
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
                  <div>
                    <dt>Name</dt>
                    <dd>{profile.member.name}</dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>{profile.member.email || "-"}</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>
                      <EnumChip
                        label={humanizeEnum(profile.member.role)}
                        tone={profile.member.role === "admin" ? "indigo" : "teal"}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <EnumChip
                        label={humanizeEnum(profile.member.status)}
                        tone={profile.member.status === "active" ? "green" : "amber"}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Last Sign In</dt>
                    <dd>{formatDateTime(profile.member.lastSignInAt)}</dd>
                  </div>
                </dl>
              </div>
              <dl className="profile-page-fields profile-page-style-fields">
                <div>
                  <dt>Theme</dt>
                  <dd className="profile-page-theme-line">
                    <span className="profile-page-theme-name">
                      {profile.theme.name}
                      {profile.theme.isDefault ? " (default)" : ""}
                    </span>
                    <span className="profile-page-theme-swatches" aria-hidden="true">
                      <span
                        className="profile-theme-swatch"
                        style={{ backgroundColor: profile.theme.palette.primary }}
                      />
                      <span
                        className="profile-theme-swatch"
                        style={{ backgroundColor: profile.theme.palette.secondary }}
                      />
                      <span
                        className="profile-theme-swatch"
                        style={{ backgroundColor: profile.theme.palette.tertiary }}
                      />
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Victory Confetti</dt>
                  <dd className="profile-page-theme-line">
                    <span className="profile-page-theme-name">
                      {profile.confetti.name}
                      {profile.confetti.isDefault ? " (default)" : ""}
                    </span>
                    {!profile.confetti.isDefault && profile.confetti.colors.length > 0 ? (
                      <span className="profile-page-theme-swatches" aria-hidden="true">
                        {profile.confetti.colors.map((color, index) => (
                          <span
                            key={`${color}-${index}`}
                            className="profile-theme-swatch"
                            style={{ backgroundColor: color }}
                          />
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
              <Link
                href={`/family/${encodeURIComponent(memberId)}/awards`}
                className="family-member-history-link">
                View claimed awards ({profile.claimedAwards.length})
              </Link>
            </div>

            {claimError ? <Alert>Could not claim award: {claimError}</Alert> : null}

            {profile.unclaimedAwards.length === 0 ? (
              <p className="small">
                No unclaimed family awards right now.
              </p>
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
                        <p className="small">
                          {award.coinCost} coins
                        </p>
                        <p className="small">
                          Purchased: {formatDateTime(award.purchasedAt)}
                        </p>
                      </div>
                      {profile.canManageAwards ? (
                        <div className="family-award-claim-actions">
                          <Button
                            type="button"
                            className="btn btn-primary"
                            disabled={claimingAwardId.length > 0}
                            onClick={() => void onClaimAward(award.id)}>
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
        </>
      ) : null}
    </main>
  );
}
