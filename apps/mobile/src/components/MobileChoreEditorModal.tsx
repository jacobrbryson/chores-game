import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  filterChoreCategoriesByQuery,
  responsibilityPillarSelectOptions,
  visibleChoreCategories,
  type ResponsibilityPillar,
} from "@packages/core";
import type { MobileChoreDetail, MobileFamilyCategory, MobileFamilyMember } from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { loadChoreEditorPreferences, saveChoreEditorPreferences } from "@/lib/mobile-preferences";
import { colors, radius, spacing, typography } from "@/theme";
import { Badge, Button } from "@/components/ui";
import { MobileMemberMultiSelect } from "@/components/MobileMemberMultiSelect";

// Above this many categories the picker gains a search box and collapses to a
// capped preview, so a family with a large catalog does not get an unbounded
// wall of chips inside the sheet.
const CATEGORY_SEARCH_THRESHOLD = 8;
const CATEGORY_COLLAPSED_LIMIT = 12;

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
  newSkillEnabled: boolean;
  responsibilityPillar: ResponsibilityPillar | "";
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

function MobileChoreEditorModalComponent({
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
  // `details` has no input of its own (the web dialog dropped the field too),
  // but it is still hydrated and submitted so editing a chore never wipes
  // details captured elsewhere.
  const [details, setDetails] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [coinValue, setCoinValue] = useState("5");
  const [requireApproval, setRequireApproval] = useState(false);
  const [newSkillEnabled, setNewSkillEnabled] = useState(false);
  const [responsibilityPillar, setResponsibilityPillar] = useState<ResponsibilityPillar | "">("");
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

  // Hydration reads these through refs so that a parent re-render handing us a
  // new array/object identity cannot retrigger the reset effect below. Before
  // this, `defaultAssigneeIds={[member.id]}` allocated a fresh array on every
  // dashboard render, which re-ran hydration and wiped whatever the user was
  // part-way through typing.
  const hydrationInputsRef = useRef({ chore, defaultAssigneeIds, activeMembers, mode });
  hydrationInputsRef.current = { chore, defaultAssigneeIds, activeMembers, mode };

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

  // Hydrate when the sheet opens, and again when the chore being edited
  // resolves (edit mode opens before the detail fetch returns). Keyed on the
  // chore *id*, never on object identity.
  const choreId = chore?.id ?? "";
  useEffect(() => {
    if (!open) {
      return;
    }
    const {
      chore: currentChore,
      defaultAssigneeIds: currentDefaults,
      activeMembers: currentMembers,
      mode: currentMode,
    } = hydrationInputsRef.current;
    const preferredAssigneeIds =
      currentMode === "create"
        ? (currentDefaults ?? []).filter((value) => currentMembers.some((member) => member.id === value))
        : [];
    setDescription(currentChore?.title ?? "");
    setSelectedAssigneeIds(
      currentChore?.assigneeScope === "family"
        ? currentMembers.map((member) => member.id)
        : currentChore?.assigneeIds?.length
          ? currentChore.assigneeIds
          : currentChore?.assigneeId
            ? [currentChore.assigneeId]
            : preferredAssigneeIds,
    );
    setDueDate(currentChore?.dueDate || todayIsoDate());
    setDetails(currentChore?.details ?? "");
    setSelectedCategoryIds(currentChore?.categoryIds ?? []);
    setCategoryQuery("");
    setShowAllCategories(false);
    setCoinValue(String(currentChore?.coinValue ?? 5));
    setRequireApproval(Boolean(currentChore?.requireApproval));
    // Matches the web dialog: existing chores default the bonus on, brand-new
    // ones start off so a parent opts in deliberately.
    setNewSkillEnabled(currentChore ? currentChore.newSkillEnabled ?? true : false);
    setResponsibilityPillar(currentChore?.responsibilityPillar ?? "");
    setRecurrenceType((currentChore?.recurrenceType as ChoreRecurrenceType | undefined) ?? "none");
    setRecurrenceInterval(String(currentChore?.recurrenceInterval ?? 1));
    setRecurrenceUnit((currentChore?.recurrenceUnit as RecurrenceUnit | undefined) ?? "day");
    setRecurrenceDays(
      Array.isArray(currentChore?.recurrenceDays)
        ? normalizeRecurrenceDays(currentChore.recurrenceDays as RecurrenceWeekday[])
        : [],
    );
    setCustomRecurrenceOpen(false);
    setError("");
  }, [open, choreId, mode]);

  const toggleAdditionalOptions = useCallback(() => {
    setShowAdditionalOptions((current) => {
      const next = !current;
      void saveChoreEditorPreferences(viewerKey, { additionalOptionsExpanded: next });
      return next;
    });
  }, [viewerKey]);

  const toggleCategory = useCallback((categoryId: string) => {
    setSelectedCategoryIds((current) =>
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId],
    );
  }, []);

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

  // Same visibility rule as the web dialog (shared in @packages/core): only
  // family-wide categories plus those scoped to a selected assignee, and never
  // hide something already selected on this chore.
  const availableCategories = useMemo(
    () =>
      visibleChoreCategories({
        categories,
        familyMemberIds: activeMembers.map((member) => member.id),
        selectedAssigneeIds,
        selectedCategoryIds,
      }),
    [categories, activeMembers, selectedAssigneeIds, selectedCategoryIds],
  );
  const searchableCategories = availableCategories.length > CATEGORY_SEARCH_THRESHOLD;
  const matchingCategories = useMemo(
    () => filterChoreCategoriesByQuery(availableCategories, categoryQuery),
    [availableCategories, categoryQuery],
  );
  // Selected chips always stay rendered so a collapsed list never hides a
  // choice the parent already made.
  const renderedCategories = useMemo(() => {
    if (showAllCategories || matchingCategories.length <= CATEGORY_COLLAPSED_LIMIT) {
      return matchingCategories;
    }
    const selected = matchingCategories.filter((category) => selectedCategoryIds.includes(category.id));
    const unselected = matchingCategories.filter((category) => !selectedCategoryIds.includes(category.id));
    return [...selected, ...unselected].slice(0, Math.max(CATEGORY_COLLAPSED_LIMIT, selected.length));
  }, [matchingCategories, selectedCategoryIds, showAllCategories]);
  const hiddenCategoryCount = matchingCategories.length - renderedCategories.length;

  const pillarOptions = useMemo(() => responsibilityPillarSelectOptions(t), [t]);

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
      newSkillEnabled,
      responsibilityPillar,
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
              <Text style={styles.loadingText}>{t("choreDialog.loadingChoreDetails")}</Text>
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
                  <MobileMemberMultiSelect
                    label={t("choreDialog.assigneeLabel")}
                    helperText={t("choreDialog.assigneePlaceholder")}
                    members={activeMembers}
                    selectedIds={selectedAssigneeIds}
                    onChange={setSelectedAssigneeIds}
                  />
                  {isFamilySelection ? <Badge label={t("choreDialog.assignedToEveryone")} /> : null}
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
                      <Text style={styles.label}>{t("responsibility.choreDialog.label")}</Text>
                      <View style={styles.chipRow}>
                        {pillarOptions.map((option) => {
                          const active = responsibilityPillar === option.value;
                          return (
                            <Pressable
                              key={option.value || "none"}
                              accessibilityRole="radio"
                              accessibilityState={{ selected: active }}
                              onPress={() => setResponsibilityPillar(option.value)}
                              style={[styles.chip, active ? styles.chipActive : null]}>
                              <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                                {option.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <Text style={styles.helperText}>{t("responsibility.choreDialog.hint")}</Text>
                    </View>

                    <View style={styles.field}>
                      <Text style={styles.label}>{t("choreDialog.categoriesLabel")}</Text>
                      {searchableCategories ? (
                        <TextInput
                          value={categoryQuery}
                          onChangeText={setCategoryQuery}
                          placeholder={t("choreDialog.categoriesPlaceholder")}
                          style={styles.input}
                          autoCorrect={false}
                        />
                      ) : null}
                      <View style={styles.chipRow}>
                        {availableCategories.length === 0 ? <Badge label={t("choreDialog.noCategories")} /> : null}
                        {renderedCategories.map((category) => {
                          const active = selectedCategoryIds.includes(category.id);
                          return (
                            <Pressable
                              key={category.id}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: active }}
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
                      {hiddenCategoryCount > 0 ? (
                        <Pressable onPress={() => setShowAllCategories(true)} style={styles.linkButton}>
                          <Text style={styles.linkButtonText}>
                            {t("common.actions.showMore")} ({hiddenCategoryCount})
                          </Text>
                        </Pressable>
                      ) : null}
                      {categoryQuery.trim() && matchingCategories.length === 0 ? (
                        <Text style={styles.helperText}>{t("choreDialog.noCategories")}</Text>
                      ) : null}
                    </View>

                    <CheckboxRow
                      label={t("choreDialog.requireApprovalLabel")}
                      hint={
                        hasMultipleAssignees
                          ? t("choreDialog.requireApprovalMultiHint")
                          : t("choreDialog.requireApprovalHint")
                      }
                      checked={hasMultipleAssignees ? true : requireApproval}
                      disabled={hasMultipleAssignees}
                      onToggle={() => setRequireApproval((current) => !current)}
                    />

                    <CheckboxRow
                      label={t("choreDialog.newSkillLabel")}
                      hint={t("choreDialog.newSkillHint")}
                      checked={newSkillEnabled}
                      onToggle={() => setNewSkillEnabled((current) => !current)}
                    />

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

// Checkbox + label + hint, matching the web dialog's Require Approval / New
// Skill Bonus rows so the two editors read the same way.
function CheckboxRow({
  label,
  hint,
  checked,
  disabled = false,
  onToggle,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={[styles.checkboxRow, disabled ? styles.checkboxRowDisabled : null]}>
      <View style={[styles.checkboxBox, checked ? styles.checkboxBoxChecked : null]}>
        {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
      </View>
      <View style={styles.checkboxCopy}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.helperText}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

// Memoized: the dashboard re-renders on every chore mutation and WebSocket
// activity event, and this sheet is expensive to re-render while open.
export const MobileChoreEditorModal = React.memo(MobileChoreEditorModalComponent);

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
  linkButton: { alignSelf: "flex-start", minHeight: 36, justifyContent: "center" },
  linkButtonText: { color: colors.brandStrong, fontSize: typography.small, fontWeight: "800" },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: "#f8fafc",
    padding: spacing.sm,
  },
  checkboxRowDisabled: { opacity: 0.6 },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxBoxChecked: { borderColor: colors.brandStrong, backgroundColor: colors.brandStrong },
  checkboxMark: { color: "#fff", fontSize: 13, fontWeight: "900", lineHeight: 16 },
  checkboxCopy: { flex: 1, gap: 2 },
});
