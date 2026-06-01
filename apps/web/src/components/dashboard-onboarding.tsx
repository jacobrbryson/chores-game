"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { useLocale } from "@/components/locale-provider";

function useDismissible(storageKey: string) {
  // Start hidden, then reveal after reading storage so a previously dismissed
  // card never flashes in and out on load.
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(storageKey) === "1");
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Ignore storage errors; the card simply reappears next load.
    }
  };
  return { dismissed, dismiss };
}

type OnboardingCardProps = {
  title: string;
  body: string;
  dismissLabel: string;
  onDismiss: () => void;
  cta?: { href: string; label: string };
};

// Matches the existing dashboard onboarding cards (the "Get Started" /
// pending-invite states) so it blends with the rest of the app: soft blue
// `family-panel`, h3 title, muted body, and a shared primary button.
function OnboardingCard({ title, body, dismissLabel, onDismiss, cta }: OnboardingCardProps) {
  return (
    <article className="family-panel dashboard-onboarding-card mb-3">
      <div className="dashboard-onboarding-head">
        <h3>{title}</h3>
        <Button
          type="button"
          className="dashboard-onboarding-dismiss"
          onClick={onDismiss}
          aria-label={dismissLabel}
          title={dismissLabel}>
          <span aria-hidden="true">&times;</span>
        </Button>
      </div>
      <p className="small">{body}</p>
      {cta ? (
        <div className="mt-3">
          <Link href={cta.href} className="btn btn-primary">
            {cta.label}
          </Link>
        </div>
      ) : null}
    </article>
  );
}

type NudgeProps = {
  familyId: string;
  viewerUid: string;
};

/**
 * Shown to admins whose family has no active player yet. The earn/spend loop
 * cannot start without someone to earn coins, so we nudge toward adding a kid.
 */
export function DashboardAddMemberNudge({ familyId, viewerUid }: NudgeProps) {
  const { t } = useLocale();
  const { dismissed, dismiss } = useDismissible(`add_member_nudge_dismissed:${familyId}:${viewerUid}`);
  if (dismissed) {
    return null;
  }
  return (
    <OnboardingCard
      title={t("dashboard.addMemberNudgeTitle")}
      body={t("dashboard.addMemberNudgeBody")}
      dismissLabel={t("common.actions.close")}
      onDismiss={dismiss}
      cta={{ href: "/family?tab=members", label: t("dashboard.addMemberNudgeCta") }}
    />
  );
}

/**
 * Shown to a brand-new player (no coins earned yet) to explain the core loop:
 * complete chores, earn coins, spend them in the Store.
 */
export function DashboardPlayerWelcome({ familyId, viewerUid }: NudgeProps) {
  const { t } = useLocale();
  const { dismissed, dismiss } = useDismissible(`player_welcome_dismissed:${familyId}:${viewerUid}`);
  if (dismissed) {
    return null;
  }
  return (
    <OnboardingCard
      title={t("dashboard.playerWelcomeTitle")}
      body={t("dashboard.playerWelcomeBody")}
      dismissLabel={t("common.actions.close")}
      onDismiss={dismiss}
    />
  );
}
