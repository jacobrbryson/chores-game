"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CoinIcon } from "@/components/coin-icon";
import { useLocale } from "@/components/locale-provider";
import {
  groupApprovalsByChild,
  splitForApproveAll,
  summarizeApprovals,
  trackApproval,
  type ApprovalChore,
} from "@/lib/approvals/inbox";
import { useApprovalActions } from "@/lib/approvals/use-approval-actions";
import { useApprovalInbox } from "@/lib/approvals/use-approval-inbox";

type SuccessSummary = {
  count: number;
  perChild: Array<{ name: string; coins: number }>;
};

// Persists the dismissal of the "all caught up" state across reloads. It is
// cleared automatically whenever new approvals appear (see the re-arm effect), so
// the positive state never reappears until there is something new to review.
const CAUGHT_UP_DISMISSED_KEY = "approvals:caughtUpDismissed";

function readCaughtUpDismissed() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(CAUGHT_UP_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCaughtUpDismissed(value: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (value) {
      window.localStorage.setItem(CAUGHT_UP_DISMISSED_KEY, "1");
    } else {
      window.localStorage.removeItem(CAUGHT_UP_DISMISSED_KEY);
    }
  } catch {
    // Ignore storage failures; dismissal just won't persist.
  }
}

function buildSuccessSummary(
  approvedIds: string[],
  chores: ApprovalChore[],
  childNameByKey: Map<string, string>,
  directoryName: (chore: ApprovalChore) => string,
): SuccessSummary {
  const byId = new Map(chores.map((chore) => [chore.id, chore] as const));
  const coinsByChild = new Map<string, { name: string; coins: number }>();
  for (const id of approvedIds) {
    const chore = byId.get(id);
    if (!chore) {
      continue;
    }
    const name = directoryName(chore);
    const entry = coinsByChild.get(name) ?? { name, coins: 0 };
    entry.coins += Math.max(0, Math.trunc(chore.coinValue || 0));
    coinsByChild.set(name, entry);
  }
  return { count: approvedIds.length, perChild: Array.from(coinsByChild.values()) };
}

// High-visibility dashboard card surfacing chores awaiting parent approval. Renders
// a celebratory queue summary with quick actions when approvals are pending, or a
// positive "all caught up" state when there are none. Admin-only; players see
// nothing.
export function ApprovalInboxCard() {
  const { t } = useLocale();
  const router = useRouter();
  // Pick a singular/plural key variant since the translator does only simple
  // {token} interpolation (no ICU plurals).
  const tc = (base: string, count: number, extra?: Record<string, string | number>) =>
    t(`${base}${count === 1 ? "One" : "Other"}`, { count, ...(extra ?? {}) });
  const { chores, directory, viewerRole, loading, reload } = useApprovalInbox();
  const { busy, approveAll } = useApprovalActions();
  const [successSummary, setSuccessSummary] = useState<SuccessSummary | null>(null);
  const [caughtUpDismissed, setCaughtUpDismissed] = useState(false);

  const familyLabel = t("approvals.familyBucket");
  const groups = useMemo(
    () => groupApprovalsByChild(chores, directory, familyLabel),
    [chores, directory, familyLabel],
  );
  const summary = useMemo(() => summarizeApprovals(groups), [groups]);

  // Read the persisted dismissal once on mount (client only, avoids hydration
  // mismatch).
  useEffect(() => {
    setCaughtUpDismissed(readCaughtUpDismissed());
  }, []);

  // Re-arm the positive state whenever there are approvals to review again, so a
  // previously dismissed "all caught up" message reappears next time the parent
  // clears the queue.
  useEffect(() => {
    if (summary.total > 0 && caughtUpDismissed) {
      setCaughtUpDismissed(false);
      writeCaughtUpDismissed(false);
    }
  }, [summary.total, caughtUpDismissed]);

  const childNameByKey = useMemo(
    () => new Map(groups.map((group) => [group.key, group.name] as const)),
    [groups],
  );
  const directoryNameByKey = useMemo(
    () => new Map(directory.map((entry) => [entry.id, entry.name] as const)),
    [directory],
  );

  // Hide entirely until we know the viewer is a parent, so children never see a
  // flash of the card and there is no layout shift mid-load.
  if (viewerRole !== "admin") {
    return null;
  }

  const resolveChildName = (chore: ApprovalChore) => {
    if (chore.assigneeScope === "family") {
      return familyLabel;
    }
    const key = chore.assigneeId || chore.assigneeIds?.[0] || "";
    return directoryNameByKey.get(key) || childNameByKey.get(key) || chore.assigneeName;
  };

  async function onApproveAll() {
    if (busy) {
      return;
    }
    trackApproval("dashboard_approval_card_clicked", { action: "approve_all" });
    const { immediate, needsCoins } = splitForApproveAll(chores);
    // Never silently assign zero coins: if any chore still needs a coin value,
    // hand off to the full page flow that walks the parent through them.
    if (needsCoins.length > 0) {
      router.push("/approvals?approveAll=1");
      return;
    }
    trackApproval("approval_inbox_approve_all", { count: immediate.length });
    const result = await approveAll(immediate.map((chore) => chore.id));
    if (result.succeeded.length > 0) {
      setSuccessSummary(
        buildSuccessSummary(result.succeeded, chores, childNameByKey, resolveChildName),
      );
    }
    await reload({ silent: true });
  }

  function onReview() {
    trackApproval("dashboard_approval_card_clicked", { action: "review" });
    router.push("/approvals");
  }

  function dismissCaughtUp() {
    setSuccessSummary(null);
    setCaughtUpDismissed(true);
    writeCaughtUpDismissed(true);
  }

  if (loading && chores.length === 0) {
    return null;
  }

  if (summary.total === 0) {
    // The positive state is dismissible and stays hidden until new approvals
    // arrive (the re-arm effect clears the flag), so a caught-up parent isn't
    // nagged by a standing banner.
    if (caughtUpDismissed) {
      return null;
    }
    const dismissButton = (
      <Button
        type="button"
        className="approval-card-dismiss"
        aria-label={t("approvals.actions.dismiss")}
        title={t("approvals.actions.dismiss")}
        onClick={dismissCaughtUp}>
        ✕
      </Button>
    );
    if (successSummary) {
      return (
        <section className="approval-card approval-card-success" aria-live="polite">
          <div className="approval-card-body">
            <p className="approval-card-title">
              🎉 {tc("approvals.card.approvedTitle", successSummary.count)}
            </p>
            <ul className="approval-card-children">
              {successSummary.perChild.map((child) => (
                <li key={child.name} className="approval-card-child-line">
                  {t("approvals.card.childEarned", { name: child.name })}
                  <span className="approval-card-coins">
                    <CoinIcon size={14} /> {child.coins}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {dismissButton}
        </section>
      );
    }
    return (
      <section className="approval-card approval-card-empty" aria-live="polite">
        <div className="approval-card-body">
          <p className="approval-card-title">✅ {t("approvals.card.emptyTitle")}</p>
          <p className="approval-card-subtitle">{t("approvals.card.emptyBody")}</p>
        </div>
        {dismissButton}
      </section>
    );
  }

  return (
    <section className="approval-card approval-card-pending" aria-live="polite">
      <div className="approval-card-body">
        <p className="approval-card-title">
          🎉 {tc("approvals.card.pendingTitle", summary.total)}
        </p>
        <ul className="approval-card-children">
          {summary.perChild.map((child) => (
            <li key={child.key} className="approval-card-child-line">
              {tc("approvals.card.childCompleted", child.count, { name: child.name })}
            </li>
          ))}
        </ul>
      </div>
      <div className="approval-card-actions">
        <Button type="button" className="btn btn-secondary" onClick={onReview}>
          {t("approvals.actions.review")}
        </Button>
        <Button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void onApproveAll()}>
          {busy ? t("approvals.actions.approving") : t("approvals.actions.approveAll")}
        </Button>
      </div>
    </section>
  );
}
