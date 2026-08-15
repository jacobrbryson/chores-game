import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  APPROVAL_COIN_QUICK_VALUES,
  RESPONSIBILITY_PILLAR_EMOJI,
  approvalAssigneeIds,
  defaultCoinsByAssignee,
  groupApprovalsByChild,
  isCoinValueHidden,
  needsCoinAssignment,
  resolveApprovalChoreType,
  splitForApproveAll,
  summarizeApprovals,
  type ApprovalChore,
  type ApprovalGroup,
} from "@packages/core";
import { appBaseUrl } from "@/lib/api";
import { useMobileApprovalActions, useMobileApprovalInbox } from "@/lib/approvals";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";
import {
  AppScreen,
  AvatarBadge,
  Badge,
  Button,
  Card,
  CoinPill,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui";

type Props = {
  right?: React.ReactNode;
  onGoDashboard?: () => void;
  // Set when arriving from the dashboard card's "Approve All", which hands the
  // remaining needs-a-coin-value chores to this screen's review queue.
  autoApproveAll?: boolean;
  onApprovalsChanged?: () => void;
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

type SuccessSummary = {
  count: number;
  perChild: Array<{ name: string; coins: number }>;
};

function avatarUrl(avatarId?: string, avatarPhotoUrl?: string) {
  if (avatarPhotoUrl) return avatarPhotoUrl;
  if (!avatarId) return "";
  return `${appBaseUrl}/avatars/default/${encodeURIComponent(avatarId)}`;
}

// Hermes ships Intl on both platforms, but RelativeTimeFormat is the piece most
// likely to be missing on an older engine — fall back to the "just now" copy
// rather than crashing the queue.
function formatRelativeTime(value: string | undefined, locale: string, fallback: string) {
  if (!value || typeof Intl?.RelativeTimeFormat !== "function") {
    return fallback;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const divisions: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
    { amount: 60, unit: "second" },
    { amount: 60, unit: "minute" },
    { amount: 24, unit: "hour" },
    { amount: 7, unit: "day" },
    { amount: 4.34524, unit: "week" },
    { amount: 12, unit: "month" },
    { amount: Number.POSITIVE_INFINITY, unit: "year" },
  ];
  let duration = (parsed - Date.now()) / 1000;
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return fallback;
}

export function ApprovalsScreen({ right, onGoDashboard, autoApproveAll, onApprovalsChanged }: Props) {
  const { locale, t } = useMobileLocale();
  // Singular/plural key selector (the translator has no ICU plural support).
  const tc = useCallback(
    (base: string, count: number, extra?: Record<string, string | number>) =>
      t(`${base}${count === 1 ? "One" : "Other"}`, { count, ...(extra ?? {}) }),
    [t],
  );

  const { chores, directory, viewerRole, loading, error: loadError, reload } = useMobileApprovalInbox();
  const { busy, error: actionError, setError, approveImmediate, approveWithPayouts, approveAll, reject } =
    useMobileApprovalActions();

  const [successSummary, setSuccessSummary] = useState<SuccessSummary | null>(null);
  const [pendingRejectChore, setPendingRejectChore] = useState<ApprovalChore | null>(null);
  const [rejectFeedback, setRejectFeedback] = useState("");

  // Coin-review queue: chores that need a coin value entered before approval. The
  // front item is shown in the modal; approving pops it. A queue can be a single
  // chore (manual Approve) or the full needs-coins set from Approve All.
  const [coinQueue, setCoinQueue] = useState<ApprovalChore[]>([]);
  const [coinsByAssignee, setCoinsByAssignee] = useState<Record<string, number>>({});
  const coinQueueIsApproveAll = useRef(false);
  const approveAllBaseRef = useRef<{ earned: Map<string, number>; count: number } | null>(null);
  const queueEarnedRef = useRef<Map<string, number>>(new Map());
  const queueApprovedCountRef = useRef(0);
  const autoApproveAllTriggered = useRef(false);

  const familyLabel = t("approvals.familyBucket");
  const groups = useMemo(
    () => groupApprovalsByChild(chores, directory, familyLabel),
    [chores, directory, familyLabel],
  );
  const summary = useMemo(() => summarizeApprovals(groups), [groups]);
  const choreById = useMemo(() => new Map(chores.map((chore) => [chore.id, chore] as const)), [chores]);
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

  const currentCoinChore = coinQueue[0] ?? null;

  // Reset the per-assignee coin inputs whenever the front of the coin queue changes.
  useEffect(() => {
    if (currentCoinChore) {
      setCoinsByAssignee(defaultCoinsByAssignee(currentCoinChore));
    }
  }, [currentCoinChore]);

  // Players never see this screen; send them back once the role resolves, the
  // same guard the web /approvals page applies.
  useEffect(() => {
    if (viewerRole === "player") {
      onGoDashboard?.();
    }
  }, [viewerRole, onGoDashboard]);

  function addEarned(target: Map<string, number>, name: string, coins: number) {
    target.set(name, (target.get(name) ?? 0) + Math.max(0, Math.trunc(coins || 0)));
  }

  function buildSummary(earned: Map<string, number>, count: number): SuccessSummary {
    return {
      count,
      perChild: Array.from(earned.entries()).map(([name, coins]) => ({ name, coins })),
    };
  }

  const handleApproveOne = useCallback(
    async (chore: ApprovalChore) => {
      if (busy) {
        return;
      }
      setSuccessSummary(null);
      if (needsCoinAssignment(chore)) {
        coinQueueIsApproveAll.current = false;
        approveAllBaseRef.current = null;
        queueEarnedRef.current = new Map();
        queueApprovedCountRef.current = 0;
        setCoinQueue([chore]);
        return;
      }
      const ok = await approveImmediate(chore.id);
      if (ok) {
        setSuccessSummary(buildSummary(new Map([[resolveChildName(chore), chore.coinValue]]), 1));
        await reload({ silent: true });
        onApprovalsChanged?.();
      }
    },
    [busy, approveImmediate, onApprovalsChanged, reload, resolveChildName],
  );

  const handleApproveAll = useCallback(async () => {
    if (busy) {
      return;
    }
    setSuccessSummary(null);
    const { immediate, needsCoins } = splitForApproveAll(chores);
    const earned = new Map<string, number>();
    let count = 0;
    if (immediate.length > 0) {
      const result = await approveAll(immediate.map((chore) => chore.id));
      for (const id of result.succeeded) {
        const chore = choreById.get(id);
        if (!chore) continue;
        addEarned(earned, resolveChildName(chore), chore.coinValue);
        count += 1;
      }
    }
    if (needsCoins.length > 0) {
      // Hand the remaining chores to the coin-review queue; the summary is shown
      // once the queue drains so no chore is approved with a silent zero value.
      coinQueueIsApproveAll.current = true;
      approveAllBaseRef.current = { earned, count };
      queueEarnedRef.current = new Map();
      queueApprovedCountRef.current = 0;
      setCoinQueue(needsCoins);
      return;
    }
    if (count > 0) {
      setSuccessSummary(buildSummary(earned, count));
    }
    await reload({ silent: true });
    onApprovalsChanged?.();
  }, [busy, chores, approveAll, choreById, onApprovalsChanged, reload, resolveChildName]);

  // Auto-start Approve All when arriving from the dashboard card's "Approve All".
  useEffect(() => {
    if (autoApproveAll && !autoApproveAllTriggered.current && !loading && viewerRole === "admin" && chores.length > 0) {
      autoApproveAllTriggered.current = true;
      void handleApproveAll();
    }
  }, [autoApproveAll, loading, viewerRole, chores.length, handleApproveAll]);

  async function onConfirmCoinApproval() {
    if (!currentCoinChore || busy) {
      return;
    }
    const payouts = approvalAssigneeIds(currentCoinChore).map((assigneeId) => ({
      assigneeId,
      coinValue: Math.max(0, Math.trunc(Number(coinsByAssignee[assigneeId]) || 0)),
    }));
    const ok = await approveWithPayouts(currentCoinChore.id, payouts);
    if (!ok) {
      return;
    }
    const total = payouts.reduce((sum, payout) => sum + payout.coinValue, 0);
    addEarned(queueEarnedRef.current, resolveChildName(currentCoinChore), total);
    queueApprovedCountRef.current += 1;
    const rest = coinQueue.slice(1);
    setCoinQueue(rest);
    if (rest.length === 0) {
      if (coinQueueIsApproveAll.current) {
        // Merge the immediate-batch totals with the coins entered during the queue.
        const base = approveAllBaseRef.current ?? { earned: new Map<string, number>(), count: 0 };
        const merged = new Map(base.earned);
        for (const [name, coins] of queueEarnedRef.current.entries()) {
          addEarned(merged, name, coins);
        }
        setSuccessSummary(buildSummary(merged, base.count + queueApprovedCountRef.current));
      } else {
        setSuccessSummary(buildSummary(queueEarnedRef.current, queueApprovedCountRef.current));
      }
      coinQueueIsApproveAll.current = false;
      approveAllBaseRef.current = null;
      await reload({ silent: true });
      onApprovalsChanged?.();
    }
  }

  function onCancelCoinApproval() {
    setCoinQueue([]);
    coinQueueIsApproveAll.current = false;
    approveAllBaseRef.current = null;
    queueEarnedRef.current = new Map();
  }

  async function onConfirmReject() {
    if (!pendingRejectChore || busy) {
      return;
    }
    const ok = await reject(pendingRejectChore.id, rejectFeedback.trim());
    if (ok) {
      setPendingRejectChore(null);
      setRejectFeedback("");
      await reload({ silent: true });
      onApprovalsChanged?.();
    }
  }

  const headerError = actionError || loadError;

  return (
    <AppScreen
      title={t("approvals.page.title")}
      subtitle={tc("approvals.page.waiting", summary.total)}
      right={right}
      onPressBreadcrumbRoot={onGoDashboard}>
      {summary.total > 0 ? (
        <Card>
          <Button
            label={busy ? t("approvals.actions.approving") : t("approvals.actions.approveAll")}
            disabled={busy}
            onPress={() => void handleApproveAll()}
          />
        </Card>
      ) : null}

      {headerError ? <ErrorState message={t("approvals.errors.generic")} /> : null}

      {successSummary ? (
        <Card style={styles.successCard}>
          <Text style={styles.successTitle}>
            {tc("approvals.card.approvedTitle", successSummary.count)}
          </Text>
          {successSummary.perChild.map((child) => (
            <View key={child.name} style={styles.successRow}>
              <Text style={styles.successName}>
                {t("approvals.card.childEarned", { name: child.name })}
              </Text>
              <CoinPill value={child.coins} />
            </View>
          ))}
        </Card>
      ) : null}

      {loading && chores.length === 0 ? (
        <LoadingState label={t("approvals.page.loading")} />
      ) : summary.total === 0 ? (
        <Card>
          <EmptyState message={`${t("approvals.empty.title")} ${t("approvals.empty.body")}`} />
        </Card>
      ) : (
        groups.map((group) => (
          <ApprovalGroupSection
            key={group.key}
            group={group}
            locale={locale}
            t={t}
            busy={busy}
            onApprove={(chore) => void handleApproveOne(chore)}
            onReject={(chore) => {
              setPendingRejectChore(chore);
              setRejectFeedback("");
              setError("");
            }}
          />
        ))
      )}

      {/* Coin-selection modal (See & Do / multi-assignee chores). */}
      <Modal
        visible={Boolean(currentCoinChore)}
        transparent
        animationType="fade"
        onRequestClose={onCancelCoinApproval}>
        {currentCoinChore ? (
          <View style={styles.backdrop}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>{t("approvals.coinModal.title")}</Text>
              <Text style={styles.sheetBody}>
                {t("approvals.coinModal.completedBy", { name: resolveChildName(currentCoinChore) })}
              </Text>
              <Text style={styles.sheetChoreTitle}>{currentCoinChore.title}</Text>
              {coinQueue.length > 1 ? (
                <Text style={styles.sheetMeta}>
                  {t("approvals.coinModal.remaining", { count: coinQueue.length })}
                </Text>
              ) : null}
              <Text style={styles.sheetBody}>{t("approvals.coinModal.prompt")}</Text>
              <View style={styles.quickRow}>
                {APPROVAL_COIN_QUICK_VALUES.map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    onPress={() =>
                      setCoinsByAssignee((current) => {
                        const next: Record<string, number> = { ...current };
                        for (const id of approvalAssigneeIds(currentCoinChore)) {
                          next[id] = value;
                        }
                        return next;
                      })
                    }
                    style={({ pressed }) => [styles.quickChip, pressed ? styles.pressed : null]}>
                    <Text style={styles.quickChipText}>{value}</Text>
                  </Pressable>
                ))}
              </View>
              <ScrollView style={styles.payoutList} keyboardShouldPersistTaps="handled">
                {approvalAssigneeIds(currentCoinChore).map((assigneeId) => (
                  <View key={assigneeId} style={styles.payoutRow}>
                    <Text style={styles.payoutName} numberOfLines={1}>
                      {directoryNameByKey.get(assigneeId) || assigneeId}
                    </Text>
                    <TextInput
                      value={String(coinsByAssignee[assigneeId] ?? 0)}
                      onChangeText={(next) =>
                        setCoinsByAssignee((current) => ({
                          ...current,
                          [assigneeId]: Math.max(0, Math.trunc(Number(next.replace(/[^0-9]/g, "")) || 0)),
                        }))
                      }
                      keyboardType="number-pad"
                      style={styles.payoutInput}
                    />
                  </View>
                ))}
              </ScrollView>
              <Button label={t("common.actions.cancel")} variant="secondary" disabled={busy} onPress={onCancelCoinApproval} />
              <Button
                label={busy ? t("approvals.actions.approving") : t("approvals.actions.approve")}
                disabled={busy}
                onPress={() => void onConfirmCoinApproval()}
              />
            </View>
          </View>
        ) : null}
      </Modal>

      {/* Reject modal. */}
      <Modal
        visible={Boolean(pendingRejectChore)}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingRejectChore(null)}>
        {pendingRejectChore ? (
          <View style={styles.backdrop}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>{t("approvals.rejectModal.title")}</Text>
              <Text style={styles.sheetBody}>
                {t("approvals.rejectModal.prompt", { title: pendingRejectChore.title })}
              </Text>
              <Text style={styles.fieldLabel}>{t("approvals.rejectModal.feedback")}</Text>
              <TextInput
                value={rejectFeedback}
                onChangeText={setRejectFeedback}
                placeholder={t("approvals.rejectModal.feedbackPlaceholder")}
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                style={styles.feedbackInput}
              />
              <Button
                label={t("common.actions.cancel")}
                variant="secondary"
                disabled={busy}
                onPress={() => setPendingRejectChore(null)}
              />
              <Button
                label={busy ? t("approvals.actions.rejecting") : t("approvals.actions.reject")}
                variant="danger"
                disabled={busy}
                onPress={() => void onConfirmReject()}
              />
            </View>
          </View>
        ) : null}
      </Modal>
    </AppScreen>
  );
}

function ApprovalGroupSection({
  group,
  locale,
  t,
  busy,
  onApprove,
  onReject,
}: {
  group: ApprovalGroup;
  locale: string;
  t: Translate;
  busy: boolean;
  onApprove: (chore: ApprovalChore) => void;
  onReject: (chore: ApprovalChore) => void;
}) {
  return (
    <Card style={styles.groupCard}>
      <View style={styles.groupHeader}>
        <AvatarBadge
          name={group.name}
          imageUrl={avatarUrl(group.avatarId, group.avatarPhotoUrl)}
          color={group.primaryColor}
          size={36}
        />
        <Text style={styles.groupName} numberOfLines={1}>{group.name}</Text>
        <Badge
          label={t(`approvals.group.count${group.chores.length === 1 ? "One" : "Other"}`, {
            count: group.chores.length,
          })}
          tone="warning"
        />
      </View>
      <View style={styles.reviewList}>
        {group.chores.map((chore) => (
          <View key={chore.id} style={styles.reviewCard}>
            <Text style={styles.reviewTitle}>{chore.title}</Text>
            <Text style={styles.reviewMeta}>
              {formatRelativeTime(chore.completedAt, locale, t("approvals.review.justNow"))}
              {" · "}
              {t(`approvals.choreType.${resolveApprovalChoreType(chore)}`)}
            </Text>
            <View style={styles.reviewTags}>
              {chore.responsibilityPillar ? (
                <Text style={styles.reviewPillar}>
                  {`${RESPONSIBILITY_PILLAR_EMOJI[chore.responsibilityPillar]} ${t(
                    `responsibility.pillars.${chore.responsibilityPillar}`,
                  )}`}
                </Text>
              ) : null}
              {isCoinValueHidden(chore) ? (
                <Text style={styles.reviewMeta}>—</Text>
              ) : (
                <CoinPill value={chore.coinValue} />
              )}
            </View>
            <View style={styles.reviewActions}>
              <Button
                label={
                  needsCoinAssignment(chore)
                    ? t("approvals.actions.approveWithEllipsis")
                    : t("approvals.actions.approve")
                }
                disabled={busy}
                variant="success"
                onPress={() => onApprove(chore)}
              />
              <Button
                label={t("approvals.actions.reject")}
                disabled={busy}
                variant="secondary"
                onPress={() => onReject(chore)}
              />
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  successCard: { gap: spacing.xs, borderColor: "#86efac", backgroundColor: "#f0fdf4" },
  successTitle: { color: colors.text, fontSize: typography.body, fontWeight: "900" },
  successRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  successName: { flex: 1, color: colors.muted, fontSize: typography.small, fontWeight: "700" },
  groupCard: { gap: spacing.md },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  groupName: { flex: 1, color: colors.text, fontSize: typography.h3, fontWeight: "900" },
  reviewList: { gap: spacing.sm },
  reviewCard: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: "#fcd34d",
    borderRadius: radius.lg,
    backgroundColor: "#fffbeb",
    padding: spacing.sm,
  },
  reviewTitle: { color: colors.text, fontSize: typography.body, fontWeight: "800" },
  reviewMeta: { color: colors.muted, fontSize: typography.tiny, fontWeight: "700" },
  reviewTags: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  reviewPillar: { color: colors.brandStrong, fontSize: typography.tiny, fontWeight: "800" },
  reviewActions: { marginTop: spacing.xs, gap: spacing.sm },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.3)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  sheet: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sheetTitle: { color: colors.text, fontSize: typography.h3, fontWeight: "900" },
  sheetChoreTitle: { color: colors.text, fontSize: typography.body, fontWeight: "800" },
  sheetBody: { color: colors.muted, fontSize: typography.small, fontWeight: "700" },
  sheetMeta: { color: colors.muted, fontSize: typography.tiny, fontWeight: "700" },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  quickChip: {
    minWidth: 52,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  quickChipText: { color: colors.brandStrong, fontSize: typography.small, fontWeight: "900" },
  pressed: { opacity: 0.76 },
  payoutList: { maxHeight: 200 },
  payoutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  payoutName: { flex: 1, color: colors.text, fontSize: typography.small, fontWeight: "700" },
  payoutInput: {
    width: 92,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    paddingHorizontal: spacing.sm,
    textAlign: "right",
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "800",
  },
  fieldLabel: { color: colors.text, fontSize: typography.small, fontWeight: "800" },
  feedbackInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "700",
  },
});
