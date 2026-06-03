"use client";

import Image from "next/image";
import Link from "next/link";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { useLocale } from "@/components/locale-provider";
import { formatDateTime } from "@/components/profile/profile-page.utils";
import { findFamilyRewardImageOption } from "@/lib/family/rewards";

export type ProfileFamilyAwardClaim = {
  id: string;
  rewardDescription: string;
  rewardImageId: string;
  coinCost: number;
  purchasedAt?: string;
};

export type ProfileOwnedItem = {
  id: string;
  name: string;
  description: string;
  image: string;
  category: string;
  quantity: number;
};

export type ProfileFamilySummary = {
  canManageAwards: boolean;
  member: {
    id: string;
    role: "admin" | "player";
  };
  unclaimedAwards: ProfileFamilyAwardClaim[];
  claimedAwards: ProfileFamilyAwardClaim[];
  ownedItems: ProfileOwnedItem[];
};

type ProfileFamilySummarySectionProps = {
  summary: ProfileFamilySummary | null;
  isLoading: boolean;
  error: string;
  memberId?: string;
  canManageAwards?: boolean;
  claimingAwardId?: string;
  claimError?: string;
  onClaimAward?: (awardId: string) => void;
};

function humanizeCategory(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function categoryCardStyle(category: string) {
  const key = category.trim().toLowerCase();
  if (key.includes("confetti")) return { backgroundColor: "#f5f3ff", borderColor: "#ddd6fe" };
  if (key.includes("avatar")) return { backgroundColor: "#eef2ff", borderColor: "#c7d2fe" };
  if (key.includes("color")) return { backgroundColor: "#f0fdfa", borderColor: "#99f6e4" };
  if (key.includes("quest")) return { backgroundColor: "#fffbeb", borderColor: "#fde68a" };
  if (key.includes("reward")) return { backgroundColor: "#fff1f2", borderColor: "#fecdd3" };
  if (key.includes("inventory")) return { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" };
  return { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" };
}

function buildCategoryCounts(items: ProfileOwnedItem[]) {
  const byCategory = new Map<string, number>();
  for (const item of items) {
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + Math.max(0, item.quantity));
  }
  return Array.from(byCategory.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

function ProfileFamilySummarySkeleton() {
  return (
    <div className="profile-family-summary-skeleton" aria-hidden="true">
      <div />
      <div />
      <div />
    </div>
  );
}

export function ProfileFamilySummarySection({
  summary,
  isLoading,
  error,
  memberId,
  canManageAwards = false,
  claimingAwardId = "",
  claimError = "",
  onClaimAward,
}: ProfileFamilySummarySectionProps) {
  const { t } = useLocale();
  const categoryCounts = buildCategoryCounts(summary?.ownedItems ?? []);

  if (isLoading) {
    return <ProfileFamilySummarySkeleton />;
  }

  if (error) {
    return <Alert>{t("profile.familySummaryLoadError", { error })}</Alert>;
  }

  if (!summary) {
    return null;
  }
  const resolvedMemberId = memberId || summary.member.id;

  return (
    <div className="profile-family-summary-stack">
      <section className="family-page-card family-member-awards-card" aria-label={t("family.unclaimedAwards")}>
        <div className="family-page-card-header family-member-awards-header">
          <div>
            <h2>{t("family.unclaimedAwards")}</h2>
            <p className="small family-page-subhead">
              {t("family.pendingRewards", {
                count: summary.unclaimedAwards.length,
                suffix: summary.unclaimedAwards.length === 1 ? "" : "s",
              })}
            </p>
          </div>
          <Link href={`/family/${encodeURIComponent(resolvedMemberId)}/awards`} className="family-member-history-link">
            {t("family.viewClaimedAwards", { count: summary.claimedAwards.length })}
          </Link>
        </div>

        {claimError ? <Alert>{t("family.claimAwardError", { error: claimError })}</Alert> : null}

        {summary.unclaimedAwards.length === 0 ? (
          <p className="small">{t("family.noUnclaimedAwards")}</p>
        ) : (
          <div className="family-award-claim-list">
            {summary.unclaimedAwards.map((award) => {
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
                    <p className="small">{t("communityAwards.coinAmount", { coins: award.coinCost })}</p>
                    <p className="small">{t("family.purchasedAt", { value: formatDateTime(award.purchasedAt) })}</p>
                  </div>
                  {canManageAwards ? (
                    <div className="family-award-claim-actions">
                      <Button
                        type="button"
                        className="btn btn-primary"
                        disabled={claimingAwardId.length > 0}
                        onClick={() => onClaimAward?.(award.id)}>
                        {claimingAwardId === award.id ? t("family.claiming") : t("family.claim")}
                      </Button>
                    </div>
                  ) : (
                    <div className="family-award-claim-actions">
                      <p className="small profile-award-guardian-note">{t("profile.awardGuardianAcknowledgement")}</p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="family-page-card profile-owned-items-card" aria-label={t("family.ownedItems")}>
        <div className="family-page-card-header family-member-awards-header">
          <div>
            <h2>{t("family.ownedItems")}</h2>
            <p className="small family-page-subhead">{t("family.ownedItemsSubtitle")}</p>
          </div>
          <Link href={`/family/${encodeURIComponent(resolvedMemberId)}/items`} className="family-member-history-link">
            {t("family.viewAllItems", { count: summary.ownedItems.length })}
          </Link>
        </div>
        {categoryCounts.length === 0 ? (
          <p className="small">{t("family.noOwnedItems")}</p>
        ) : (
          <div className="family-award-claim-list">
            {categoryCounts.map(({ category, count }) => (
              <Link
                key={category}
                href={`/family/${encodeURIComponent(resolvedMemberId)}/items?category=${encodeURIComponent(category)}`}
                className="family-award-claim-card family-category-summary-card"
                style={categoryCardStyle(category)}>
                <div className="family-award-claim-copy">
                  <h3>{humanizeCategory(category)}</h3>
                  <p className="small">{t("family.itemCount", { count, suffix: count === 1 ? "" : "s" })}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
