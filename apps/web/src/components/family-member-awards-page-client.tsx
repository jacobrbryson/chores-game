"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { BackLink } from "@/components/back-link";
import { formatDateTime } from "@/components/profile/profile-page.utils";
import { findFamilyRewardImageOption } from "@/lib/family/rewards";

type FamilyMemberAwardsPageClientProps = {
  memberId: string;
};

type ClaimedAward = {
  id: string;
  rewardDescription: string;
  rewardImageId: string;
  coinCost: number;
  purchasedAt?: string;
  claimedAt?: string;
  claimedByName?: string;
};

type FamilyMemberAwardsResponse = {
  familyId: string;
  familyName: string;
  viewerRole: "admin" | "player";
  member: {
    id: string;
    uid?: string;
    name: string;
  };
  claimedAwards: ClaimedAward[];
};

export function FamilyMemberAwardsPageClient({
  memberId,
}: FamilyMemberAwardsPageClientProps) {
  const [summary, setSummary] = useState<FamilyMemberAwardsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAwards = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/family/members/${encodeURIComponent(memberId)}/awards`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `FAMILY_MEMBER_AWARDS_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as FamilyMemberAwardsResponse;
      setSummary(payload);
    } catch (errorValue) {
      setSummary(null);
      setError(errorValue instanceof Error ? errorValue.message : "member_awards_unavailable");
    } finally {
      setIsLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    void loadAwards();
  }, [loadAwards]);

  return (
    <main className="panel family-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link" fallbackHref={`/family/${encodeURIComponent(memberId)}`} />
          <h1>{summary?.member.name ? `${summary.member.name} Awards` : "Claimed Awards"}</h1>
        </div>
      </div>
      <p className="small family-page-subhead">
        Claimed family awards history for this family member.
      </p>

      {isLoading ? <p className="small">Loading awards...</p> : null}
      {!isLoading && error ? (
        <p className="small family-error">Could not load awards: {error}</p>
      ) : null}

      {!isLoading && !error && summary ? (
        <section className="family-page-card family-member-awards-card" aria-label="Claimed family awards">
          <div className="family-page-card-header">
            <h2>Claimed Awards</h2>
            <p className="small family-page-subhead">
              {summary.claimedAwards.length} claimed reward
              {summary.claimedAwards.length === 1 ? "" : "s"}
            </p>
          </div>

          {summary.claimedAwards.length === 0 ? (
            <p className="small">No claimed family awards yet.</p>
          ) : (
            <div className="family-award-claim-list">
              {summary.claimedAwards.map((award) => {
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
                      <p className="small">Claimed: {formatDateTime(award.claimedAt)}</p>
                      <p className="small">
                        Claimed by: {award.claimedByName?.trim() || "Admin"}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
