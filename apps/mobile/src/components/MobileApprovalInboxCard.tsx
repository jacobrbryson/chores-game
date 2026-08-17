import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  groupApprovalsByChild,
  splitForApproveAll,
  summarizeApprovals,
  type ApprovalChore,
} from "@packages/core";
import { useMobileApprovalActions, useMobileApprovalInbox } from "@/lib/approvals";
import { useMobileLocale } from "@/lib/locale";
import {
  loadApprovalCaughtUpDismissed,
  saveApprovalCaughtUpDismissed,
} from "@/lib/mobile-preferences";
import { colors, radius, spacing, typography } from "@/theme";
import { Button, CoinPill } from "@/components/ui";

type Props = {
  viewerKey?: string;
  // Opens the full Approvals screen. `approveAll` is set when the queue contains
  // chores that still need a coin value, which only the full screen can collect.
  onOpenApprovals: (options?: { approveAll?: boolean }) => void;
  onApprovalsChanged?: () => void;
};

type SuccessSummary = {
  count: number;
  perChild: Array<{ name: string; coins: number }>;
};

function buildSuccessSummary(
  approvedIds: string[],
  chores: ApprovalChore[],
  resolveName: (chore: ApprovalChore) => string,
): SuccessSummary {
  const byId = new Map(chores.map((chore) => [chore.id, chore] as const));
  const coinsByChild = new Map<string, { name: string; coins: number }>();
  for (const id of approvedIds) {
    const chore = byId.get(id);
    if (!chore) {
      continue;
    }
    const name = resolveName(chore);
    const entry = coinsByChild.get(name) ?? { name, coins: 0 };
    entry.coins += Math.max(0, Math.trunc(chore.coinValue || 0));
    coinsByChild.set(name, entry);
  }
  return { count: approvedIds.length, perChild: Array.from(coinsByChild.values()) };
}

// High-visibility dashboard card surfacing chores awaiting parent approval, the
// mobile counterpart of web's ApprovalInboxCard. Admin-only; players see nothing.
export function MobileApprovalInboxCard({
  viewerKey = "",
  onOpenApprovals,
  onApprovalsChanged,
}: Props) {
  const { t } = useMobileLocale();
  // Pick a singular/plural key variant since the translator does only simple
  // {token} interpolation (no ICU plurals).
  const tc = useCallback(
    (base: string, count: number, extra?: Record<string, string | number>) =>
      t(`${base}${count === 1 ? "One" : "Other"}`, { count, ...(extra ?? {}) }),
    [t],
  );

  const { chores, directory, viewerRole, loading, reload } = useMobileApprovalInbox();
  const { busy, approveAll } = useMobileApprovalActions();
  const [successSummary, setSuccessSummary] = useState<SuccessSummary | null>(null);
  const [caughtUpPreference, setCaughtUpPreference] = useState<{
    viewerKey: string;
    dismissed: boolean;
  } | null>(null);

  const familyLabel = t("approvals.familyBucket");
  const groups = useMemo(
    () => groupApprovalsByChild(chores, directory, familyLabel),
    [chores, directory, familyLabel],
  );
  const summary = useMemo(() => summarizeApprovals(groups), [groups]);
  const caughtUpPreferenceReady = caughtUpPreference?.viewerKey === viewerKey;
  const caughtUpDismissed = caughtUpPreferenceReady && caughtUpPreference.dismissed;

  // Navigation remounts the dashboard, so keep the dismissal in the same
  // per-viewer preference store used by the rest of the mobile dashboard.
  useEffect(() => {
    let cancelled = false;
    void loadApprovalCaughtUpDismissed(viewerKey).then((dismissed) => {
      if (!cancelled) {
        setCaughtUpPreference({ viewerKey, dismissed });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [viewerKey]);

  // Seeing a new approval re-arms the caught-up message. Once that new queue is
  // reviewed, the parent gets one fresh success state that can be dismissed.
  useEffect(() => {
    if (summary.total > 0 && caughtUpDismissed) {
      setCaughtUpPreference({ viewerKey, dismissed: false });
      void saveApprovalCaughtUpDismissed(viewerKey, false);
    }
  }, [caughtUpDismissed, summary.total, viewerKey]);
  const childNameByKey = useMemo(
    () => new Map(groups.map((group) => [group.key, group.name] as const)),
    [groups],
  );
  const directoryNameByKey = useMemo(
    () => new Map(directory.map((entry) => [entry.id, entry.name] as const)),
    [directory],
  );

  const resolveChildName = useCallback(
    (chore: ApprovalChore) => {
      if (chore.assigneeScope === "family") {
        return familyLabel;
      }
      const key = chore.assigneeId || chore.assigneeIds?.[0] || "";
      return directoryNameByKey.get(key) || childNameByKey.get(key) || chore.assigneeName;
    },
    [childNameByKey, directoryNameByKey, familyLabel],
  );

  // Hide entirely until we know the viewer is a parent, so children never see a
  // flash of the card and there is no layout shift mid-load.
  if (viewerRole !== "admin") {
    return null;
  }

  if (loading && chores.length === 0) {
    return null;
  }

  async function onApproveAll() {
    if (busy) {
      return;
    }
    const { immediate, needsCoins } = splitForApproveAll(chores);
    // Never silently assign zero coins: if any chore still needs a coin value,
    // hand off to the full screen that walks the parent through them.
    if (needsCoins.length > 0) {
      onOpenApprovals({ approveAll: true });
      return;
    }
    const result = await approveAll(immediate.map((chore) => chore.id));
    if (result.succeeded.length > 0) {
      setSuccessSummary(buildSuccessSummary(result.succeeded, chores, resolveChildName));
    }
    await reload({ silent: true });
    onApprovalsChanged?.();
  }

  if (summary.total === 0) {
    if (!caughtUpPreferenceReady) {
      return null;
    }
    if (caughtUpDismissed) {
      return null;
    }
    return (
      <View style={[styles.card, styles.cardCalm]}>
        <View style={styles.body}>
          {successSummary ? (
            <>
              <Text style={styles.title}>
                {tc("approvals.card.approvedTitle", successSummary.count)}
              </Text>
              {successSummary.perChild.map((child) => (
                <View key={child.name} style={styles.childRow}>
                  <Text style={styles.childLine}>
                    {t("approvals.card.childEarned", { name: child.name })}
                  </Text>
                  <CoinPill value={child.coins} />
                </View>
              ))}
            </>
          ) : (
            <>
              <Text style={styles.title}>{t("approvals.card.emptyTitle")}</Text>
              <Text style={styles.subtitle}>{t("approvals.card.emptyBody")}</Text>
            </>
          )}
        </View>
        <Button
          label={t("approvals.actions.dismiss")}
          variant="secondary"
          onPress={() => {
            setSuccessSummary(null);
            setCaughtUpPreference({ viewerKey, dismissed: true });
            void saveApprovalCaughtUpDismissed(viewerKey, true);
          }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.card, styles.cardPending]}>
      <View style={styles.body}>
        <Text style={styles.title}>{tc("approvals.card.pendingTitle", summary.total)}</Text>
        {summary.perChild.map((child) => (
          <Text key={child.key} style={styles.childLine}>
            {tc("approvals.card.childCompleted", child.count, { name: child.name })}
          </Text>
        ))}
      </View>
      <View style={styles.actions}>
        <Button
          label={t("approvals.actions.review")}
          variant="secondary"
          onPress={() => onOpenApprovals()}
        />
        <Button
          label={busy ? t("approvals.actions.approving") : t("approvals.actions.approveAll")}
          disabled={busy}
          onPress={() => void onApproveAll()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardPending: { borderColor: "#fcd34d", backgroundColor: "#fffbeb" },
  cardCalm: { borderColor: "#86efac", backgroundColor: "#f0fdf4" },
  body: { gap: spacing.xs },
  title: { color: colors.text, fontSize: typography.body, fontWeight: "900" },
  subtitle: { color: colors.muted, fontSize: typography.small, fontWeight: "700" },
  childRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  childLine: { color: colors.muted, fontSize: typography.small, fontWeight: "700" },
  actions: { gap: spacing.sm },
});
