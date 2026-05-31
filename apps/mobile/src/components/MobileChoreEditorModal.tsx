import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { MobileChoreDetail, MobileFamilyCategory, MobileFamilyMember } from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { loadChoreEditorPreferences, saveChoreEditorPreferences } from "@/lib/mobile-preferences";
import { colors, radius, spacing, typography } from "@/theme";
import { Badge, Button } from "@/components/ui";

type ChoreRecurrenceType = "none" | "daily" | "weekly" | "monthly" | "custom";
type RecurrenceUnit = "day" | "week" | "month";

export type MobileChoreEditorSubmitPayload = {
  description: string;
  assigneeId: string;
  assigneeIds: string[];
  assigneeScope: "single" | "multiple" | "family";
  dueDate: string;
  details: string;
  categoryIds: string[];
  coinValue: number;
  requireApproval: boolean;
  recurrenceType: ChoreRecurrenceType;
  recurrenceInterval?: number;
  recurrenceUnit?: RecurrenceUnit;
};

type Props = {
  categories: MobileFamilyCategory[];
  chore?: MobileChoreDetail | null;
  defaultAssigneeIds?: string[];
  loading?: boolean;
  members: MobileFamilyMember[];
  mode: "create" | "edit";
  onClose: () => void;
  onSubmit: (payload: MobileChoreEditorSubmitPayload) => Promise<void> | void;
  open: boolean;
  saving?: boolean;
  viewerKey?: string;
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDateInput(value: string) {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : todayIsoDate();
}

export function MobileChoreEditorModal({
  categories,
  chore,
  defaultAssigneeIds,
  loading = false,
  members,
  mode,
  onClose,
  onSubmit,
  open,
  saving = false,
  viewerKey = "default",
}: Props) {
  const { t } = useMobileLocale();
  const [description, setDescription] = useState("");
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState(todayIsoDate());
  const [details, setDetails] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [coinValue, setCoinValue] = useState("5");
  const [requireApproval, setRequireApproval] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<ChoreRecurrenceType>("none");
  const [recurrenceInterval, setRecurrenceInterval] = useState("1");
  const [recurrenceUnit, setRecurrenceUnit] = useState<RecurrenceUnit>("day");
  const [showAdditionalOptions, setShowAdditionalOptions] = useState(false);
  const [error, setError] = useState("");

  const activeMembers = useMemo(() => members.filter((member) => member.status === "active"), [members]);
  const isFamilySelection = activeMembers.length > 0 && selectedAssigneeIds.length === activeMembers.length;
  const hasMultipleAssignees = isFamilySelection || selectedAssigneeIds.length > 1;

  useEffect(() => {
    let cancelled = false;
    void loadChoreEditorPreferences(viewerKey).then((preferences) => {
      if (!cancelled) {
        setShowAdditionalOptions(preferences.additionalOptionsExpanded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [viewerKey]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const preferredAssigneeIds =
      mode === "create"
        ? (defaultAssigneeIds ?? []).filter((value) => activeMembers.some((member) => member.id === value))
        : [];
    setDescription(chore?.title ?? "");
    setSelectedAssigneeIds(
      chore?.assigneeScope === "family"
        ? activeMembers.map((member) => member.id)
        : chore?.assigneeIds?.length
          ? chore.assigneeIds
          : chore?.assigneeId
            ? [chore.assigneeId]
            : preferredAssigneeIds,
    );
    setDueDate(chore?.dueDate || todayIsoDate());
    setDetails(chore?.details ?? "");
    setSelectedCategoryIds(chore?.categoryIds ?? []);
    setCoinValue(String(chore?.coinValue ?? 5));
    setRequireApproval(Boolean(chore?.requireApproval));
    setRecurrenceType((chore?.recurrenceType as ChoreRecurrenceType | undefined) ?? "none");
    setRecurrenceInterval(String(chore?.recurrenceInterval ?? 1));
    setRecurrenceUnit((chore?.recurrenceUnit as RecurrenceUnit | undefined) ?? "day");
    setError("");
  }, [activeMembers, chore, defaultAssigneeIds, mode, open]);

  function toggleAdditionalOptions() {
    setShowAdditionalOptions((current) => {
      const next = !current;
      void saveChoreEditorPreferences(viewerKey, { additionalOptionsExpanded: next });
      return next;
    });
  }

  function toggleAssignee(memberId: string) {
    setSelectedAssigneeIds((current) => {
      return current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId];
    });
  }

  function toggleCategory(categoryId: string) {
    setSelectedCategoryIds((current) =>
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId],
    );
  }

  async function handleSubmit() {
    const normalizedDescription = description.trim();
    if (!normalizedDescription) {
      setError("Description is required.");
      return;
    }
    if (selectedAssigneeIds.length === 0) {
      setError("Select at least one assignee.");
      return;
    }
    const parsedCoinValue = Number(coinValue);
    if (!Number.isInteger(parsedCoinValue) || parsedCoinValue < 0) {
      setError("Coins must be a whole number.");
      return;
    }
    const parsedRecurrenceInterval = Number(recurrenceInterval);
    if (recurrenceType === "custom" && (!Number.isInteger(parsedRecurrenceInterval) || parsedRecurrenceInterval < 1)) {
      setError("Custom recurrence needs an interval of 1 or more.");
      return;
    }

    const payload: MobileChoreEditorSubmitPayload = {
      description: normalizedDescription,
      assigneeId: selectedAssigneeIds.length === 1 ? selectedAssigneeIds[0] ?? "" : "",
      assigneeIds: isFamilySelection ? [] : selectedAssigneeIds,
      assigneeScope: isFamilySelection ? "family" : selectedAssigneeIds.length > 1 ? "multiple" : "single",
      dueDate: normalizeDateInput(dueDate),
      details: details.trim(),
      categoryIds: selectedCategoryIds,
      coinValue: parsedCoinValue,
      requireApproval: hasMultipleAssignees ? true : requireApproval,
      recurrenceType,
      recurrenceInterval: recurrenceType === "custom" ? parsedRecurrenceInterval : undefined,
      recurrenceUnit: recurrenceType === "custom" ? recurrenceUnit : undefined,
    };

    setError("");
    try {
      await onSubmit(payload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not save chore.");
    }
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{mode === "edit" ? t("choreDialog.editTitle") : t("choreDialog.addTitle")}</Text>
          {loading ? (
            <View style={styles.loadingState}>
              <Text style={styles.loadingText}>Loading chore details...</Text>
            </View>
          ) : (
            <>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
                <View style={styles.field}>
                  <Text style={styles.label}>{t("choreDialog.descriptionLabel")}</Text>
                  <TextInput value={description} onChangeText={setDescription} placeholder={t("choreDialog.descriptionPlaceholder")} style={styles.input} />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>{t("choreDialog.assigneeLabel")}</Text>
                  <Text style={styles.helperText}>Choose one or more people.</Text>
                  <View style={styles.chipRow}>
                    {activeMembers.map((member) => {
                      const active = selectedAssigneeIds.includes(member.id);
                      return (
                        <Pressable key={member.id} onPress={() => toggleAssignee(member.id)} style={[styles.chip, active ? styles.chipActive : null]}>
                          <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{member.name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {isFamilySelection ? <Badge label="Assigned to everyone" /> : null}
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>{t("choreDialog.coinValueLabel")}</Text>
                  <TextInput
                    value={coinValue}
                    onChangeText={setCoinValue}
                    placeholder="0"
                    keyboardType="number-pad"
                    style={styles.input}
                  />
                </View>

                <View style={styles.field}>
                  <Pressable onPress={toggleAdditionalOptions} style={styles.additionalOptionsButton}>
                    <Text style={styles.additionalOptionsIcon}>{showAdditionalOptions ? "-" : "+"}</Text>
                    <Text style={styles.additionalOptionsText}>{t("choreDialog.additionalOptions")}</Text>
                  </Pressable>
                </View>

                {showAdditionalOptions ? (
                  <>
                    <View style={styles.field}>
                      <Text style={styles.label}>{t("choreDialog.dueDateLabel")}</Text>
                      <TextInput value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" style={styles.input} />
                    </View>

                    <View style={styles.field}>
                      <Text style={styles.label}>{t("choreDialog.detailsLabel")}</Text>
                      <TextInput
                        value={details}
                        onChangeText={setDetails}
                        placeholder={t("choreDialog.detailsPlaceholder")}
                        style={[styles.input, styles.textArea]}
                        multiline
                        textAlignVertical="top"
                      />
                    </View>

                    <View style={styles.field}>
                      <Text style={styles.label}>{t("choreDialog.categoriesLabel")}</Text>
                      <View style={styles.chipRow}>
                        {categories.length === 0 ? <Badge label={t("choreDialog.noCategories")} /> : null}
                        {categories.map((category) => {
                          const active = selectedCategoryIds.includes(category.id);
                          return (
                            <Pressable
                              key={category.id}
                              onPress={() => toggleCategory(category.id)}
                              style={[
                                styles.chip,
                                active ? styles.chipActive : null,
                                !active ? { borderColor: category.color } : null,
                                active ? { backgroundColor: category.color } : null,
                              ]}>
                              <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{category.name}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>

                    <View style={styles.field}>
                      <Text style={styles.label}>{t("choreDialog.requireApprovalLabel")}</Text>
                      <Pressable
                        onPress={() => {
                          if (!hasMultipleAssignees) {
                            setRequireApproval((current) => !current);
                          }
                        }}
                        style={[styles.chip, (requireApproval || hasMultipleAssignees) ? styles.chipActive : null]}>
                        <Text style={[styles.chipText, (requireApproval || hasMultipleAssignees) ? styles.chipTextActive : null]}>
                          {hasMultipleAssignees ? t("choreDialog.requireApprovalMultiHint") : requireApproval ? "Approval required" : "Approval optional"}
                        </Text>
                      </Pressable>
                    </View>

                    <View style={styles.field}>
                      <Text style={styles.label}>{t("choreDialog.recurrenceLabel")}</Text>
                      <View style={styles.chipRow}>
                        {(["none", "daily", "weekly", "monthly", "custom"] as ChoreRecurrenceType[]).map((value) => (
                          <Pressable key={value} onPress={() => setRecurrenceType(value)} style={[styles.chip, recurrenceType === value ? styles.chipActive : null]}>
                            <Text style={[styles.chipText, recurrenceType === value ? styles.chipTextActive : null]}>
                              {value === "none"
                                ? t("choreDialog.recurrence.instant")
                                : value === "daily"
                                  ? t("choreDialog.recurrence.daily")
                                  : value === "weekly"
                                    ? t("choreDialog.recurrence.weekly")
                                    : value === "monthly"
                                      ? t("choreDialog.recurrence.monthly")
                                      : t("choreDialog.recurrence.custom")}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      {recurrenceType === "custom" ? (
                        <View style={styles.inlineFields}>
                          <TextInput
                            value={recurrenceInterval}
                            onChangeText={setRecurrenceInterval}
                            placeholder="1"
                            keyboardType="number-pad"
                            style={[styles.input, styles.inlineInput]}
                          />
                          <View style={styles.chipRow}>
                            {(["day", "week", "month"] as RecurrenceUnit[]).map((value) => (
                              <Pressable key={value} onPress={() => setRecurrenceUnit(value)} style={[styles.chip, recurrenceUnit === value ? styles.chipActive : null]}>
                                <Text style={[styles.chipText, recurrenceUnit === value ? styles.chipTextActive : null]}>
                                  {value === "day"
                                    ? t("choreDialog.recurrence.days")
                                    : value === "week"
                                      ? t("choreDialog.recurrence.weeks")
                                      : t("choreDialog.recurrence.months")}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      ) : null}
                    </View>
                  </>
                ) : null}
              </ScrollView>
              <View style={styles.actions}>
                <Button label={t("common.actions.cancel")} variant="secondary" onPress={onClose} />
                <Button
                  label={saving ? t("common.actions.loading") : mode === "edit" ? t("choreDialog.saveChanges") : t("dashboard.addChore")}
                  disabled={saving}
                  onPress={() => void handleSubmit()}
                />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.28)", justifyContent: "center", padding: spacing.lg },
  sheet: { maxHeight: "92%", borderRadius: radius.lg, backgroundColor: "#fff", padding: spacing.md, gap: spacing.sm },
  title: { color: colors.text, fontSize: typography.h3, fontWeight: "900" },
  scroll: { flexGrow: 0 },
  content: { gap: spacing.md, paddingBottom: spacing.xs },
  field: { gap: spacing.xs },
  label: { color: colors.text, fontSize: typography.small, fontWeight: "800" },
  helperText: { color: colors.muted, fontSize: typography.tiny, fontWeight: "700" },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: spacing.sm, color: colors.text, backgroundColor: "#fff" },
  textArea: { minHeight: 92, paddingTop: spacing.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  additionalOptionsButton: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start" },
  additionalOptionsIcon: { color: colors.brandStrong, fontSize: typography.h3, fontWeight: "900", lineHeight: 20 },
  additionalOptionsText: { color: colors.brandStrong, fontSize: typography.small, fontWeight: "800" },
  chip: { minHeight: 38, borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: spacing.sm, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  chipActive: { borderColor: colors.brandStrong, backgroundColor: colors.brandStrong },
  chipText: { color: colors.text, fontSize: typography.small, fontWeight: "800" },
  chipTextActive: { color: "#fff" },
  inlineFields: { gap: spacing.sm },
  inlineInput: { maxWidth: 96 },
  actions: { gap: spacing.sm },
  errorText: { color: colors.danger, fontSize: typography.small, fontWeight: "700" },
  loadingState: { minHeight: 120, alignItems: "center", justifyContent: "center" },
  loadingText: { color: colors.muted, fontSize: typography.body, fontWeight: "700" },
});
