import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  responsibilityPillarLabel,
  responsibilityPillarSelectOptions,
  type ResponsibilityPillar,
} from "@packages/core";
import {
  createMobileRoutine,
  deleteMobileRoutine,
  fetchMobileRoutines,
  updateMobileRoutine,
  type MobileRoutine,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/ui";

type EditorState = { mode: "create" } | { mode: "edit"; routine: MobileRoutine } | null;

// Routines tab for the mobile dashboard. The web app exposes routine templates
// on its own /routines page; mobile previously had no way to create one at all,
// so parents had to leave the app.
export function MobileRoutinesPanel() {
  const { t } = useMobileLocale();
  const [routines, setRoutines] = useState<MobileRoutine[]>([]);
  const [viewerRole, setViewerRole] = useState<"admin" | "player">("player");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [editor, setEditor] = useState<EditorState>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pillar, setPillar] = useState<ResponsibilityPillar | "">("");
  // Steps are entered one per line, matching the web editor's steps textarea.
  const [stepsText, setStepsText] = useState("");
  const [bonusCoins, setBonusCoins] = useState("0");
  const [editorError, setEditorError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<MobileRoutine | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const state = await fetchMobileRoutines();
      setRoutines(state.items);
      setViewerRole(state.viewerRole);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "routines_unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isAdmin = viewerRole === "admin";
  const pillarOptions = useMemo(() => responsibilityPillarSelectOptions(t), [t]);
  const visibleRoutines = useMemo(
    () => routines.filter((routine) => isAdmin || routine.active),
    [routines, isAdmin],
  );

  function openCreate() {
    setName("");
    setDescription("");
    setPillar("");
    setStepsText("");
    setBonusCoins("0");
    setEditorError("");
    setEditor({ mode: "create" });
  }

  function openEdit(routine: MobileRoutine) {
    setName(routine.name);
    setDescription(routine.description);
    setPillar(routine.pillar);
    setStepsText(routine.steps.map((step) => step.title).join("\n"));
    setBonusCoins(String(routine.completionBonusCoins ?? 0));
    setEditorError("");
    setEditor({ mode: "edit", routine });
  }

  async function submitRoutine() {
    if (busy || !editor) {
      return;
    }
    const trimmedName = name.trim();
    const existingSteps = editor.mode === "edit" ? editor.routine.steps : [];
    const titles = stepsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!trimmedName || titles.length === 0) {
      setEditorError(t("responsibility.routines.editorValidation"));
      return;
    }
    // Reuse the existing step id when the title is unchanged at that position so
    // in-flight assignments stay matched to their steps.
    const steps = titles.map((title, index) => {
      const existing = existingSteps[index];
      return existing && existing.title === title
        ? { id: existing.id, title, ...(existing.coinValue !== undefined ? { coinValue: existing.coinValue } : {}), ...(existing.requireApproval !== undefined ? { requireApproval: existing.requireApproval } : {}) }
        : { title };
    });
    const parsedCoins = Number(bonusCoins);
    const completionBonusCoins =
      Number.isFinite(parsedCoins) && parsedCoins >= 0 ? Math.trunc(parsedCoins) : 0;

    setBusy(true);
    setEditorError("");
    try {
      const payload = {
        name: trimmedName,
        description: description.trim(),
        pillar,
        steps,
        completionBonusCoins,
      };
      if (editor.mode === "edit") {
        await updateMobileRoutine(editor.routine.id, payload);
      } else {
        await createMobileRoutine(payload);
      }
      setEditor(null);
      await load(true);
    } catch (saveError) {
      setEditorError(saveError instanceof Error ? saveError.message : "save_routine_failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    const routine = pendingDelete;
    setPendingDelete(null);
    if (!routine || busy) {
      return;
    }
    setBusy(true);
    try {
      await deleteMobileRoutine(routine.id);
      await load(true);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "delete_routine_failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <LoadingState label={t("common.actions.loading")} />;
  }
  if (error && routines.length === 0) {
    return <ErrorState message={t("responsibility.routines.loadError")} />;
  }

  return (
    <Card>
      <SectionHeader title={t("responsibility.routines.heading")} />
      <Text style={styles.subheading}>{t("responsibility.routines.subheading")}</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {isAdmin ? (
        <Button label={t("responsibility.routines.addRoutineAction")} onPress={openCreate} disabled={busy} />
      ) : null}

      {visibleRoutines.length === 0 ? (
        <EmptyState message={t("responsibility.routines.empty")} />
      ) : null}

      <View style={styles.list}>
        {visibleRoutines.map((routine) => (
          <View key={routine.id} style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle}>{routine.name}</Text>
              {!routine.active && isAdmin ? (
                <Badge label={t("responsibility.routines.inactive")} />
              ) : null}
            </View>
            {routine.description ? <Text style={styles.rowMeta}>{routine.description}</Text> : null}
            <View style={styles.rowBadges}>
              {routine.pillar ? <Badge label={responsibilityPillarLabel(routine.pillar, t)} /> : null}
              <Badge
                label={`${routine.steps.length} ${t("responsibility.routines.columnSteps")}`}
              />
            </View>
            <Text style={styles.rowSteps} numberOfLines={3}>
              {routine.steps.map((step) => step.title).join(" • ")}
            </Text>
            {isAdmin ? (
              <View style={styles.rowActions}>
                <Button
                  label={t("common.actions.edit")}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => openEdit(routine)}
                />
                <Button
                  label={t("common.actions.delete")}
                  variant="danger"
                  disabled={busy}
                  onPress={() => setPendingDelete(routine)}
                />
              </View>
            ) : null}
          </View>
        ))}
      </View>

      <Modal
        visible={Boolean(editor)}
        transparent
        animationType="slide"
        onRequestClose={() => setEditor(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {editor?.mode === "edit"
                ? t("responsibility.routines.editRoutine")
                : t("responsibility.routines.createRoutine")}
            </Text>
            {editorError ? <Text style={styles.errorText}>{editorError}</Text> : null}
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
              <View style={styles.field}>
                <Text style={styles.label}>{t("responsibility.routines.nameLabel")}</Text>
                <TextInput value={name} onChangeText={setName} style={styles.input} />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("responsibility.routines.descriptionLabel")}</Text>
                <TextInput value={description} onChangeText={setDescription} style={styles.input} />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("responsibility.choreDialog.label")}</Text>
                <View style={styles.chipRow}>
                  {pillarOptions.map((option) => {
                    const active = pillar === option.value;
                    return (
                      <Pressable
                        key={option.value || "none"}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        onPress={() => setPillar(option.value)}
                        style={[styles.chip, active ? styles.chipActive : null]}>
                        <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("responsibility.routines.stepsLabel")}</Text>
                <TextInput
                  value={stepsText}
                  onChangeText={setStepsText}
                  placeholder={t("responsibility.routines.stepsPlaceholder")}
                  style={[styles.input, styles.textArea]}
                  multiline
                  textAlignVertical="top"
                />
                <Text style={styles.helperText}>{t("responsibility.routines.stepsHint")}</Text>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("responsibility.routines.bonusCoinsLabel")}</Text>
                <TextInput
                  value={bonusCoins}
                  onChangeText={setBonusCoins}
                  keyboardType="number-pad"
                  style={styles.input}
                />
              </View>
            </ScrollView>
            <View style={styles.sheetActions}>
              <Button
                label={t("common.actions.cancel")}
                variant="secondary"
                disabled={busy}
                onPress={() => setEditor(null)}
              />
              <Button
                label={busy ? t("common.actions.saving") : t("common.actions.save")}
                disabled={busy}
                onPress={() => void submitRoutine()}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(pendingDelete)}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingDelete(null)}>
        <View style={styles.backdrop}>
          <View style={styles.confirmSheet}>
            <Text style={styles.sheetTitle}>{pendingDelete?.name ?? ""}</Text>
            <Text style={styles.confirmText}>{t("responsibility.routines.deleteConfirm")}</Text>
            <View style={styles.sheetActions}>
              <Button
                label={t("common.actions.cancel")}
                variant="secondary"
                onPress={() => setPendingDelete(null)}
              />
              <Button
                label={t("common.actions.delete")}
                variant="danger"
                onPress={() => void confirmDelete()}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Card>
  );
}

const styles = StyleSheet.create({
  subheading: { color: colors.muted, fontSize: typography.small, fontWeight: "700" },
  list: { gap: spacing.sm },
  row: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    padding: spacing.sm,
  },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" },
  rowTitle: { color: colors.text, fontSize: typography.body, fontWeight: "800" },
  rowMeta: { color: colors.muted, fontSize: typography.small, fontWeight: "600" },
  rowBadges: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  rowSteps: { color: colors.muted, fontSize: typography.tiny, fontWeight: "700" },
  rowActions: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.32)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  sheet: {
    maxHeight: "88%",
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    padding: spacing.md,
    gap: spacing.sm,
  },
  confirmSheet: {
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    padding: spacing.lg,
    gap: spacing.md,
  },
  sheetTitle: { color: colors.text, fontSize: typography.h3, fontWeight: "900" },
  sheetBody: { gap: spacing.md, paddingBottom: spacing.xs },
  sheetActions: { gap: spacing.sm },
  confirmText: { color: colors.text, fontSize: typography.body, fontWeight: "600" },
  field: { gap: spacing.xs },
  label: { color: colors.text, fontSize: typography.small, fontWeight: "800" },
  helperText: { color: colors.muted, fontSize: typography.tiny, fontWeight: "700" },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    color: colors.text,
    backgroundColor: "#fff",
  },
  textArea: { minHeight: 120, paddingTop: spacing.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    minHeight: 38,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  chipActive: { borderColor: colors.brandStrong, backgroundColor: colors.brandStrong },
  chipText: { color: colors.text, fontSize: typography.small, fontWeight: "800" },
  chipTextActive: { color: "#fff" },
  errorText: { color: colors.danger, fontSize: typography.small, fontWeight: "700" },
});
