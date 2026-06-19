import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { MobileChoreDetail, MobileFamilyCategory, MobileFamilyMember } from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { loadChoreEditorPreferences, saveChoreEditorPreferences } from "@/lib/mobile-preferences";
import { colors, radius, spacing, typography } from "@/theme";
import { Badge, Button } from "@/components/ui";

type ChoreRecurrenceType = "none" | "daily" | "weekly" | "monthly" | "custom";
type RecurrenceUnit = "day" | "week" | "month";
type RecurrenceWeekday = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

const RECURRENCE_WEEKDAYS: RecurrenceWeekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

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
  recurrenceDays?: RecurrenceWeekday[];
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
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateInput(value: string) {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : todayIsoDate();
}

function recurrenceSummary(
  intervalValue: string,
  unit: RecurrenceUnit,
  days: RecurrenceWeekday[],
  t: (key: string, params?: Record<string, string>) => string,
) {
  const parsed = Number(intervalValue);
  const interval = Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 1;
  const selectedDays = normalizeRecurrenceDays(days);
  if (unit === "week" && selectedDays.length > 0) {
    const dayLabel = selectedDays.map((day) => t(`chores.recurrence.weekdays.${day}`)).join(", ");
    return interval === 1
      ? t("chores.recurrence.everyWeekdaySummary", { days: dayLabel })
      : t("chores.recurrence.everyIntervalWeeksOnSummary", {
          count: String(interval),
          days: dayLabel,
        });
  }
  if (interval === 1) {
    return unit === "day"
      ? t("chores.recurrence.daily")
      : unit === "week"
        ? t("chores.recurrence.weekly")
        : t("chores.recurrence.monthly");
  }
  const unitLabel =
    unit === "day"
      ? t("chores.recurrence.unitDays").toLowerCase()
      : unit === "week"
        ? t("chores.recurrence.unitWeeks").toLowerCase()
        : t("chores.recurrence.unitMonths").toLowerCase();
  return t("chores.recurrence.everySummary", {
    count: String(interval),
    unit: unitLabel,
  });
}

function normalizeRecurrenceDays(days: RecurrenceWeekday[]) {
  const selected = new Set(days);
  return RECURRENCE_WEEKDAYS.filter((day) => selected.has(day));
}

function normalizeRecurrenceIntervalInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) {
    return "1";
  }
  return String(Math.max(1, Math.min(365, Math.trunc(parsed))));
}

function isSingularRecurrenceInterval(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.trunc(parsed) === 1;
}

function recurrenceUnitOptionLabel(
  unit: RecurrenceUnit,
  intervalValue: string,
  t: (key: string, params?: Record<string, string>) => string,
) {
  const singular = isSingularRecurrenceInterval(intervalValue);
  if (unit === "day") {
    return t(singular ? "chores.recurrence.unitDay" : "chores.recurrence.unitDays");
  }
  if (unit === "week") {
    return t(singular ? "chores.recurrence.unitWeek" : "chores.recurrence.unitWeeks");
  }
  return t(singular ? "chores.recurrence.unitMonth" : "chores.recurrence.unitMonths");
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
  const [recurrenceDays, setRecurrenceDays] = useState<RecurrenceWeekday[]>([]);
  const [customRecurrenceOpen, setCustomRecurrenceOpen] = useState(false);
  const [draftRecurrenceInterval, setDraftRecurrenceInterval] = useState("1");
  const [draftRecurrenceUnit, setDraftRecurrenceUnit] = useState<RecurrenceUnit>("day");
  const [draftRecurrenceDays, setDraftRecurrenceDays] = useState<RecurrenceWeekday[]>(["mon"]);
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
    setRecurrenceDays(
      Array.isArray(chore?.recurrenceDays)
        ? normalizeRecurrenceDays(chore.recurrenceDays as RecurrenceWeekday[])
        : [],
    );
    setCustomRecurrenceOpen(false);
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

  function selectRecurrence(value: ChoreRecurrenceType) {
    setRecurrenceType(value);
    if (value === "custom") {
      const isAlreadyCustom = recurrenceType === "custom";
      setDraftRecurrenceInterval(isAlreadyCustom ? recurrenceInterval : "1");
      setDraftRecurrenceUnit(isAlreadyCustom ? recurrenceUnit : "week");
      setDraftRecurrenceDays(recurrenceDays.length ? recurrenceDays : ["mon"]);
      setCustomRecurrenceOpen(true);
    }
  }

  function saveCustomRecurrence() {
    const parsed = Number(draftRecurrenceInterval);
    const normalized = Number.isFinite(parsed) ? Math.max(1, Math.min(365, Math.trunc(parsed))) : 1;
    setRecurrenceType("custom");
    setRecurrenceInterval(String(normalized));
    setRecurrenceUnit(draftRecurrenceUnit);
    setRecurrenceDays(draftRecurrenceUnit === "week" ? draftRecurrenceDays : []);
    setCustomRecurrenceOpen(false);
  }

  function toggleDraftRecurrenceDay(day: RecurrenceWeekday) {
    setDraftRecurrenceDays((current) => {
      if (current.includes(day)) {
        return current.length === 1 ? current : current.filter((entry) => entry !== day);
      }
      return normalizeRecurrenceDays([...current, day]);
    });
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
      recurrenceDays: recurrenceType === "custom" && recurrenceUnit === "week" ? recurrenceDays : [],
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
                          <Pressable key={value} onPress={() => selectRecurrence(value)} style={[styles.chip, recurrenceType === value ? styles.chipActive : null]}>
                            <Text style={[styles.chipText, recurrenceType === value ? styles.chipTextActive : null]}>
                              {value === "none"
                                ? t("choreDialog.recurrence.none")
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
                        <View style={styles.customRecurrenceSummary}>
                          <Text style={styles.helperText}>
                            {recurrenceSummary(recurrenceInterval, recurrenceUnit, recurrenceDays, t)}
                          </Text>
                          <Button label={t("chores.recurrence.editCustom")} variant="secondary" onPress={() => selectRecurrence("custom")} />
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
      <Modal visible={customRecurrenceOpen} transparent animationType="fade" onRequestClose={() => setCustomRecurrenceOpen(false)}>
        <View style={styles.customBackdrop}>
          <View style={styles.customSheet}>
            <Text style={styles.title}>{t("chores.recurrence.customTitle")}</Text>
            <View style={styles.field}>
              <Text style={styles.label}>{t("chores.recurrence.repeatEvery")}</Text>
              <View style={styles.inlineFields}>
                <TextInput
                  value={draftRecurrenceInterval}
                  onBlur={() => {
                    if (!draftRecurrenceInterval) {
                      setDraftRecurrenceInterval("1");
                    }
                  }}
                  onChangeText={(value) => setDraftRecurrenceInterval(normalizeRecurrenceIntervalInput(value))}
                  placeholder="1"
                  keyboardType="number-pad"
                  style={[styles.input, styles.inlineInput]}
                />
                <View style={styles.chipRow}>
                  {(["day", "week", "month"] as RecurrenceUnit[]).map((value) => (
                    <Pressable key={value} onPress={() => setDraftRecurrenceUnit(value)} style={[styles.chip, draftRecurrenceUnit === value ? styles.chipActive : null]}>
                      <Text style={[styles.chipText, draftRecurrenceUnit === value ? styles.chipTextActive : null]}>
                        {recurrenceUnitOptionLabel(value, draftRecurrenceInterval, t)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {draftRecurrenceUnit === "week" ? (
                <View style={styles.field}>
                  <Text style={styles.label}>{t("chores.recurrence.repeatOn")}</Text>
                  <View style={styles.chipRow}>
                    {RECURRENCE_WEEKDAYS.map((day) => {
                      const selected = draftRecurrenceDays.includes(day);
                      return (
                        <Pressable key={day} onPress={() => toggleDraftRecurrenceDay(day)} style={[styles.dayChip, selected ? styles.chipActive : null]}>
                          <Text style={[styles.chipText, selected ? styles.chipTextActive : null]}>
                            {t(`chores.recurrence.weekdaysShort.${day}`)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}
              <Text style={styles.helperText}>
                {recurrenceSummary(draftRecurrenceInterval, draftRecurrenceUnit, draftRecurrenceDays, t)}
              </Text>
            </View>
            <View style={styles.actions}>
              <Button label={t("common.actions.cancel")} variant="secondary" onPress={() => setCustomRecurrenceOpen(false)} />
              <Button label={t("common.actions.done")} onPress={saveCustomRecurrence} />
            </View>
          </View>
        </View>
      </Modal>
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
  dayChip: { width: 38, height: 38, borderWidth: 1, borderColor: colors.line, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  chipActive: { borderColor: colors.brandStrong, backgroundColor: colors.brandStrong },
  chipText: { color: colors.text, fontSize: typography.small, fontWeight: "800" },
  chipTextActive: { color: "#fff" },
  inlineFields: { gap: spacing.sm },
  inlineInput: { maxWidth: 96 },
  customRecurrenceSummary: { gap: spacing.xs, alignItems: "flex-start" },
  customBackdrop: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.38)", justifyContent: "center", padding: spacing.lg },
  customSheet: { borderRadius: radius.lg, backgroundColor: "#fff", padding: spacing.lg, gap: spacing.md },
  actions: { gap: spacing.sm },
  errorText: { color: colors.danger, fontSize: typography.small, fontWeight: "700" },
  loadingState: { minHeight: 120, alignItems: "center", justifyContent: "center" },
  loadingText: { color: colors.muted, fontSize: typography.body, fontWeight: "700" },
});
