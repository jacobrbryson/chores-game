import React from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  assignMobileRoutine,
  copyMobileFriendRoutine,
  fetchMobileFriendRoutinePreview,
  fetchMobileFamilySummary,
  type MobileFamilyMember,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";
import { Button } from "@/components/ui";
import { MobileMemberMultiSelect } from "@/components/MobileMemberMultiSelect";

type Recurrence = "none" | "daily" | "weekly" | "monthly";
type EditableStep = {
  id: string;
  title: string;
  coinValue: number;
  requireApproval: boolean;
};

type Props = {
  visible: boolean;
  sourceFamilyId: string;
  sourceFamilyName: string;
  sourceRoutineId: string;
  routineName: string;
  onClose: () => void;
  onCopied: (assigned: boolean) => void;
};

export function MobileCopyFriendRoutineModal({
  visible,
  sourceFamilyId,
  sourceFamilyName,
  sourceRoutineId,
  routineName,
  onClose,
  onCopied,
}: Props) {
  const { t } = useMobileLocale();
  const [members, setMembers] = React.useState<MobileFamilyMember[]>([]);
  const [assignNow, setAssignNow] = React.useState(true);
  const [assigneeIds, setAssigneeIds] = React.useState<string[]>([]);
  const [assignedIds, setAssignedIds] = React.useState<string[]>([]);
  const [steps, setSteps] = React.useState<EditableStep[]>([]);
  const [newStepTitle, setNewStepTitle] = React.useState("");
  const [loadingPreview, setLoadingPreview] = React.useState(false);
  const [recurrenceType, setRecurrenceType] = React.useState<Recurrence>("none");
  const [copiedRoutineId, setCopiedRoutineId] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!visible) return;
    setAssignNow(true);
    setAssigneeIds([]);
    setAssignedIds([]);
    setSteps([]);
    setNewStepTitle("");
    setLoadingPreview(true);
    setRecurrenceType("none");
    setCopiedRoutineId("");
    setError("");
    let cancelled = false;
    void Promise.all([
      fetchMobileFamilySummary(),
      fetchMobileFriendRoutinePreview(sourceFamilyId, sourceRoutineId, routineName),
    ])
      .then(([summary, preview]) => {
        if (!cancelled) {
          setMembers(summary.members.filter((member) => member.status === "active"));
          setSteps(
            preview.steps.map((step, index) => ({
              id: step.id || `step_${index + 1}`,
              title: step.title,
              coinValue: Math.max(0, Math.trunc(step.coinValue ?? 5)),
              requireApproval: step.requireApproval === true,
            })),
          );
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "family_unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [routineName, sourceFamilyId, sourceRoutineId, visible]);

  function updateStep(index: number, patch: Partial<EditableStep>) {
    setSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...patch } : step,
      ),
    );
  }

  function addStep() {
    const title = newStepTitle.trim();
    if (!title || steps.length >= 20) return;
    setSteps((current) => [
      ...current,
      {
        id: `step_${Date.now()}`,
        title,
        coinValue: 5,
        requireApproval: false,
      },
    ]);
    setNewStepTitle("");
  }

  async function submit() {
    if (saving) return;
    if (steps.length === 0) {
      setError(t("familyFriends.routines.chooseSteps"));
      return;
    }
    if (assignNow && assigneeIds.length === 0) {
      setError(t("familyFriends.routines.chooseAssignees"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      let routineId = copiedRoutineId;
      if (!routineId) {
        const copied = await copyMobileFriendRoutine(
          sourceFamilyId,
          sourceRoutineId,
          routineName,
          steps,
        );
        routineId = copied.routineId;
        setCopiedRoutineId(routineId);
      }
      if (assignNow) {
        for (const assigneeId of assigneeIds) {
          if (assignedIds.includes(assigneeId)) continue;
          await assignMobileRoutine(routineId, { assigneeId, recurrenceType });
          setAssignedIds((current) => [...current, assigneeId]);
        }
      }
      onCopied(assignNow);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "family_friend_routine_copy_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.header}>
            <Text style={styles.title}>{t("familyFriends.routines.dialogTitle")}</Text>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.body}>
            {t("familyFriends.routines.confirmBody", {
              routine: routineName || t("familyFriends.routines.unnamed"),
              family: sourceFamilyName,
            })}
          </Text>
          {error ? <Text style={styles.error}>{t("familyFriends.errors.action", { error })}</Text> : null}

          <View style={styles.preview}>
            <Text style={styles.label}>{t("familyFriends.routines.previewHeading")}</Text>
            {loadingPreview ? <ActivityIndicator color={colors.brand} /> : null}
            {steps.map((step, index) => (
              <View key={`${step.id}_${index}`} style={styles.stepRow}>
                <Text style={styles.stepNumber}>{index + 1}</Text>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <TextInput
                  accessibilityLabel={t("responsibility.assignDialog.coinsPerStepLabel")}
                  keyboardType="number-pad"
                  value={String(step.coinValue)}
                  onChangeText={(value) =>
                    updateStep(index, {
                      coinValue: Math.max(0, Math.min(1000, Math.trunc(Number(value) || 0))),
                    })
                  }
                  style={styles.coinInput}
                />
                <Pressable onPress={() => setSteps((current) => current.filter((_, stepIndex) => stepIndex !== index))} hitSlop={6}>
                  <Text style={styles.removeStep}>{t("responsibility.assignDialog.removeStep")}</Text>
                </Pressable>
              </View>
            ))}
            <View style={styles.addStepRow}>
              <TextInput
                value={newStepTitle}
                onChangeText={setNewStepTitle}
                placeholder={t("responsibility.assignDialog.addStepPlaceholder")}
                style={styles.addStepInput}
                onSubmitEditing={addStep}
              />
              <Button label={t("common.actions.add")} variant="secondary" onPress={addStep} disabled={!newStepTitle.trim() || steps.length >= 20} />
            </View>
          </View>

          <Pressable style={[styles.choice, assignNow ? styles.choiceActive : null]} onPress={() => setAssignNow((current) => !current)}>
            <Text style={[styles.choiceText, assignNow ? styles.choiceTextActive : null]}>
              {t("familyFriends.routines.assignNow")}
            </Text>
          </Pressable>

          {assignNow ? (
            <View style={styles.options}>
              <MobileMemberMultiSelect
                label={t("familyFriends.routines.assigneesLabel")}
                members={members}
                selectedIds={assigneeIds}
                onChange={setAssigneeIds}
              />
              <Text style={styles.label}>{t("responsibility.assignDialog.recurrenceLabel")}</Text>
              <View style={styles.chips}>
                {(["none", "daily", "weekly", "monthly"] as Recurrence[]).map((value) => (
                  <Pressable key={value} style={[styles.chip, recurrenceType === value ? styles.chipActive : null]} onPress={() => setRecurrenceType(value)}>
                    <Text style={[styles.chipText, recurrenceType === value ? styles.chipTextActive : null]}>{t(`chores.recurrence.${value}`)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button label={t("common.actions.cancel")} variant="secondary" onPress={onClose} disabled={saving} />
            <Button label={saving ? t("familyFriends.routines.copying") : assignNow ? t("familyFriends.routines.copyAndAssign") : t("familyFriends.routines.copy")} onPress={() => void submit()} disabled={saving || loadingPreview} />
          </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "center", padding: spacing.lg },
  sheet: { borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.md, maxHeight: "85%" },
  content: { gap: spacing.md },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { flex: 1, fontSize: typography.h3, fontWeight: "800", color: colors.text },
  close: { fontSize: 28, lineHeight: 30, color: colors.muted },
  body: { fontSize: typography.body, color: colors.text },
  error: { color: "#b91c1c", fontSize: typography.small, fontWeight: "700" },
  choice: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: spacing.md },
  choiceActive: { borderColor: colors.brand, backgroundColor: colors.accentSoft },
  choiceText: { color: colors.text, fontWeight: "700" },
  choiceTextActive: { color: colors.brandStrong },
  options: { gap: spacing.sm },
  label: { color: colors.text, fontSize: typography.small, fontWeight: "800", marginTop: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipActive: { borderColor: colors.brand, backgroundColor: colors.accentSoft },
  chipText: { color: colors.text, fontSize: typography.small, fontWeight: "700" },
  chipTextActive: { color: colors.brandStrong },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  preview: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepNumber: { width: 20, color: colors.muted, fontWeight: "800" },
  stepTitle: { flex: 1, color: colors.text, fontSize: typography.small },
  coinInput: { width: 54, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, color: colors.text, textAlign: "right" },
  removeStep: { color: "#b91c1c", fontSize: typography.small, fontWeight: "700" },
  addStepRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  addStepInput: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text },
});
