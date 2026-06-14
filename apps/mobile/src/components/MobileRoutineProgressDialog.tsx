import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  fetchMobileRoutineAssignment,
  patchMobileChore,
  type MobileRoutineAssignment,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { Button, CoinPill } from "@/components/ui";
import { colors, radius, spacing, typography } from "@/theme";

type Props = {
  assignmentId: string;
  visible: boolean;
  onClose: () => void;
  // Called after a step is completed/reverted so the opener can refresh its list.
  onChanged?: () => void;
};

// Mobile counterpart of the web RoutineProgressDialog. Players (and parents) can
// open a routine from its badge to see every step, finish steps out of order,
// or revert a completed/skipped step while the routine is still active.
export function MobileRoutineProgressDialog({ assignmentId, visible, onClose, onChanged }: Props) {
  const { t } = useMobileLocale();
  const [assignment, setAssignment] = React.useState<MobileRoutineAssignment | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const [busyChoreId, setBusyChoreId] = React.useState("");
  const [actionError, setActionError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await fetchMobileRoutineAssignment(assignmentId);
      setAssignment(data);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "assignment_unavailable");
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  React.useEffect(() => {
    if (visible && assignmentId) {
      setAssignment(null);
      setActionError("");
      void load();
    }
  }, [visible, assignmentId, load]);

  async function runStepAction(choreId: string, action: "complete" | "undo_complete" | "unskip") {
    if (busyChoreId) {
      return;
    }
    setBusyChoreId(choreId);
    setActionError("");
    try {
      await patchMobileChore(choreId, { action });
      await load();
      onChanged?.();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "step_action_failed");
    } finally {
      setBusyChoreId("");
    }
  }

  const completed = new Set(assignment?.completedStepIds ?? []);
  const skipped = new Set(assignment?.skippedStepIds ?? []);
  const steps = assignment?.steps ?? [];
  const completedCount = steps.filter((step) => completed.has(step.id)).length;
  const skippedCount = steps.filter((step) => skipped.has(step.id) && !completed.has(step.id)).length;
  const totalCount = steps.length;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const isActive = assignment?.status === "active";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {assignment
                ? t("responsibility.progressDialog.title", { name: assignment.routineName })
                : t("responsibility.progressDialog.loadingTitle")}
            </Text>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          {loadError ? (
            <Text style={styles.error}>{t("responsibility.progressDialog.loadError")}</Text>
          ) : null}
          {actionError ? (
            <Text style={styles.error}>{t("responsibility.progressDialog.completeError")}</Text>
          ) : null}
          {loading && !assignment ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.brand} />
              <Text style={styles.loadingText}>{t("common.actions.loading")}</Text>
            </View>
          ) : null}

          {assignment ? (
            <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
              <View style={styles.metaRow}>
                <Text style={styles.metaStrong}>
                  {t("responsibility.progressDialog.progress", {
                    done: String(completedCount),
                    total: String(totalCount),
                  })}
                </Text>
                {assignment.assigneeName ? (
                  <Text style={styles.metaMuted}>{assignment.assigneeName}</Text>
                ) : null}
                {skippedCount > 0 ? (
                  <Text style={[styles.tag, styles.tagSkipped]}>
                    {t("responsibility.progressDialog.skipped", { count: String(skippedCount) })}
                  </Text>
                ) : null}
                {assignment.status === "completed" ? (
                  <Text style={[styles.tag, styles.tagDone]}>
                    {t("responsibility.progressDialog.completed")}
                  </Text>
                ) : null}
              </View>

              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
              </View>

              <View style={styles.steps}>
                {steps.map((step) => {
                  const done = completed.has(step.id);
                  const isSkipped = !done && skipped.has(step.id);
                  const isResolved = done || isSkipped;
                  const busy = busyChoreId === step.choreId;
                  return (
                    <View key={step.id} style={styles.stepRow}>
                      <View
                        style={[
                          styles.stepBadge,
                          done && styles.stepBadgeDone,
                          isSkipped && styles.stepBadgeSkipped,
                        ]}>
                        <Text
                          style={[
                            styles.stepBadgeText,
                            done && styles.stepBadgeTextDone,
                            isSkipped && styles.stepBadgeTextSkipped,
                          ]}>
                          {isResolved ? "✓" : step.order}
                        </Text>
                      </View>
                      <Text style={[styles.stepTitle, isResolved && styles.stepTitleResolved]} numberOfLines={2}>
                        {step.title}
                      </Text>
                      <View style={styles.stepRight}>
                        {isSkipped ? (
                          <Text style={styles.skippedTag}>
                            {t("responsibility.progressDialog.skippedTag")}
                          </Text>
                        ) : step.coinValue > 0 ? (
                          <CoinPill value={step.coinValue} />
                        ) : null}
                        {isActive && !isResolved ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("responsibility.progressDialog.markDone")}
                            disabled={Boolean(busyChoreId)}
                            onPress={() => void runStepAction(step.choreId, "complete")}
                            style={[styles.stepAction, styles.stepActionDone, busy && styles.stepActionBusy]}>
                            <Text style={styles.stepActionDoneText}>✓</Text>
                          </Pressable>
                        ) : null}
                        {isActive && isResolved ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("responsibility.progressDialog.undo")}
                            disabled={Boolean(busyChoreId)}
                            onPress={() =>
                              void runStepAction(step.choreId, done ? "undo_complete" : "unskip")
                            }
                            style={[styles.stepAction, busy && styles.stepActionBusy]}>
                            <Text style={styles.stepActionUndoText}>↺</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>

              {assignment.pillar || assignment.completionBonusCoins > 0 || assignment.completionBonusXp > 0 ? (
                <View style={styles.footer}>
                  {assignment.pillar ? (
                    <Text style={styles.footerLine}>
                      {t("responsibility.progressDialog.pillar")}{" "}
                      <Text style={styles.footerStrong}>
                        {t(`responsibility.pillars.${assignment.pillar}`)}
                      </Text>
                    </Text>
                  ) : null}
                  {assignment.completionBonusXp > 0 && assignment.pillar ? (
                    <Text style={styles.footerLine}>
                      {t("responsibility.progressDialog.bonusXp", {
                        xp: String(assignment.completionBonusXp),
                      })}
                    </Text>
                  ) : null}
                  {assignment.completionBonusCoins > 0 ? (
                    <Text style={styles.footerLine}>
                      {t("responsibility.progressDialog.bonusCoins", {
                        coins: String(assignment.completionBonusCoins),
                      })}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>
          ) : null}

          <View style={styles.actions}>
            <Button label={t("common.actions.close")} variant="secondary" onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.45)", justifyContent: "center", padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, maxHeight: "85%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { flex: 1, fontSize: typography.h3, fontWeight: "800", color: colors.text },
  close: { fontSize: 26, lineHeight: 26, color: colors.muted, fontWeight: "700" },
  error: { color: colors.danger, fontSize: typography.small, fontWeight: "700" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  loadingText: { color: colors.muted, fontSize: typography.small },
  body: { flexGrow: 0 },
  bodyContent: { gap: spacing.md },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  metaStrong: { fontSize: typography.small, fontWeight: "800", color: colors.text },
  metaMuted: { fontSize: typography.small, color: colors.muted },
  tag: { fontSize: typography.tiny, fontWeight: "800", borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, overflow: "hidden" },
  tagSkipped: { backgroundColor: "#fef3c7", color: "#b45309" },
  tagDone: { backgroundColor: "#d1fae5", color: "#047857" },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: colors.backgroundSoft, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 999, backgroundColor: colors.success },
  steps: { gap: spacing.sm },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBadgeDone: { borderColor: "#6ee7b7", backgroundColor: "#ecfdf5" },
  stepBadgeSkipped: { borderColor: "#fcd34d", backgroundColor: "#fffbeb" },
  stepBadgeText: { fontSize: typography.small, fontWeight: "800", color: colors.muted },
  stepBadgeTextDone: { color: "#047857" },
  stepBadgeTextSkipped: { color: "#b45309" },
  stepTitle: { flex: 1, fontSize: typography.body, color: colors.text },
  stepTitleResolved: { color: colors.muted, textDecorationLine: "line-through" },
  stepRight: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  skippedTag: { fontSize: typography.tiny, fontWeight: "800", color: "#b45309" },
  stepAction: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  stepActionDone: { borderColor: "#6ee7b7", backgroundColor: "#ecfdf5" },
  stepActionBusy: { opacity: 0.5 },
  stepActionDoneText: { color: "#047857", fontSize: typography.body, fontWeight: "900" },
  stepActionUndoText: { color: colors.muted, fontSize: typography.body, fontWeight: "900" },
  footer: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm, gap: 2 },
  footerLine: { fontSize: typography.small, color: colors.muted },
  footerStrong: { fontWeight: "800", color: colors.text },
  actions: { marginTop: spacing.sm },
});
