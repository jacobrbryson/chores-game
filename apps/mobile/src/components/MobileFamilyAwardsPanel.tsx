import React, { useCallback, useEffect, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import {
  FAMILY_REWARD_IMAGE_OPTIONS,
  MAX_FAMILY_REWARD_DESCRIPTION_LENGTH,
  findFamilyRewardImageOption,
  isValidFamilyRewardCoinCost,
  isValidFamilyRewardLimit,
  normalizeFamilyRewardCoinCost,
  normalizeFamilyRewardDescription,
  normalizeFamilyRewardImageId,
  normalizeFamilyRewardLimit,
  type FamilyReward,
} from "@packages/core";
import {
  createMobileFamilyReward,
  deleteMobileFamilyReward,
  fetchMobileFamilyRewards,
  toAppAssetUrl,
  updateMobileFamilyReward,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";
import { MobileCommunityAwardsLibrary } from "@/components/MobileCommunityAwardsLibrary";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/ui";

type EditorState = {
  mode: "create" | "edit";
  rewardId: string;
  imageId: string;
  description: string;
  coinCost: string;
  individualLimit: string;
  familyLimit: string;
  submitToCommunityAwards: boolean;
};

function emptyEditor(): EditorState {
  return {
    mode: "create",
    rewardId: "",
    imageId: FAMILY_REWARD_IMAGE_OPTIONS[0]?.id ?? "screen_time",
    description: "",
    coinCost: "",
    individualLimit: "",
    familyLimit: "",
    submitToCommunityAwards: false,
  };
}

function editorFromReward(reward: FamilyReward): EditorState {
  return {
    mode: "edit",
    rewardId: reward.id,
    imageId: normalizeFamilyRewardImageId(reward.imageId),
    description: reward.description,
    coinCost: String(reward.coinCost),
    individualLimit: reward.individualLimit ? String(reward.individualLimit) : "",
    familyLimit: reward.familyLimit ? String(reward.familyLimit) : "",
    submitToCommunityAwards: reward.submitToCommunityAwards === true,
  };
}

function rewardImageUrl(imageId: string) {
  const option = findFamilyRewardImageOption(normalizeFamilyRewardImageId(imageId));
  return toAppAssetUrl(option?.imagePath ?? "/rewards/screens.png");
}

// Family Awards management for the mobile Manage Family screen — the counterpart
// of the web /family awards tab. Parents create the custom prizes kids redeem
// with coins, and can disable an award (hiding it from the store while keeping
// its redemption history) or delete it outright.
export function MobileFamilyAwardsPanel({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useMobileLocale();
  const [rewards, setRewards] = useState<FamilyReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDisable, setPendingDisable] = useState<FamilyReward | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FamilyReward | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const state = await fetchMobileFamilyRewards();
      setRewards(state.items);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "family_rewards_unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitEditor() {
    if (!editor || busy) {
      return;
    }
    const description = normalizeFamilyRewardDescription(editor.description).slice(
      0,
      MAX_FAMILY_REWARD_DESCRIPTION_LENGTH,
    );
    const coinCost = normalizeFamilyRewardCoinCost(editor.coinCost);
    const individualLimit = normalizeFamilyRewardLimit(editor.individualLimit);
    const familyLimit = normalizeFamilyRewardLimit(editor.familyLimit);

    if (!description) {
      setActionError("description_required");
      return;
    }
    if (!isValidFamilyRewardCoinCost(coinCost)) {
      setActionError("invalid_coin_cost");
      return;
    }
    if (!isValidFamilyRewardLimit(individualLimit)) {
      setActionError("invalid_individual_limit");
      return;
    }
    if (!isValidFamilyRewardLimit(familyLimit)) {
      setActionError("invalid_family_limit");
      return;
    }

    setBusy(true);
    setActionError("");
    try {
      const body = {
        description,
        coinCost,
        imageId: normalizeFamilyRewardImageId(editor.imageId),
        individualLimit,
        familyLimit,
        submitToCommunityAwards: editor.submitToCommunityAwards,
      };
      if (editor.mode === "edit") {
        await updateMobileFamilyReward(editor.rewardId, body);
      } else {
        await createMobileFamilyReward(body);
      }
      setEditor(null);
      await load(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "save_reward_failed");
    } finally {
      setBusy(false);
    }
  }

  async function setRewardDisabled(reward: FamilyReward, disabled: boolean) {
    if (busy) {
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      await updateMobileFamilyReward(reward.id, { disabled });
      await load(true);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : disabled ? "disable_reward_failed" : "enable_reward_failed",
      );
    } finally {
      setBusy(false);
      setPendingDisable(null);
    }
  }

  async function confirmDelete() {
    const reward = pendingDelete;
    setPendingDelete(null);
    if (!reward || busy) {
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      await deleteMobileFamilyReward(reward.id);
      await load(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "delete_reward_failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <LoadingState label={t("common.actions.loading")} />;
  }

  return (
    <>
      <Card>
        <SectionHeader title={t("family.awards.title")} />
        <Text style={styles.intro}>{t("family.awards.intro")}</Text>
        {loadError ? <ErrorState message={t("family.awards.loadError", { error: loadError })} /> : null}
        {actionError ? <ErrorState message={t("family.awards.updateError", { error: actionError })} /> : null}
        {isAdmin ? (
          <Button label={t("family.awards.addAward")} onPress={() => setEditor(emptyEditor())} />
        ) : null}
        {rewards.length === 0 && !loadError ? <EmptyState message={t("family.awards.empty")} /> : null}
        <View style={styles.list}>
          {rewards.map((reward) => (
            <View key={reward.id} style={[styles.row, reward.disabled ? styles.rowDisabled : null]}>
              <Image source={{ uri: rewardImageUrl(reward.imageId) }} style={styles.rowImage} />
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{reward.description}</Text>
                <Text style={styles.rowMeta}>{t("family.awards.coinCost", { coins: reward.coinCost })}</Text>
                <Text style={styles.rowMeta}>
                  {t("family.awards.limitsSummary", {
                    individual: reward.individualLimit || t("family.awards.limitUnlimited"),
                    family: reward.familyLimit || t("family.awards.limitUnlimited"),
                  })}
                </Text>
                <View style={styles.rowBadges}>
                  {reward.disabled ? <Badge label={t("family.awards.disabledBadge")} tone="warning" /> : null}
                  {reward.submitToCommunityAwards ? (
                    <Badge
                      label={t("family.awards.communityStatus", {
                        status: t(
                          `family.awards.communityStatuses.${reward.communityAwardSubmissionStatus || "not_submitted"}`,
                        ),
                      })}
                    />
                  ) : null}
                </View>
                {reward.communityAwardSubmissionStatus === "rejected" && reward.communityAwardRejectionReason ? (
                  <Text style={styles.rowMeta}>
                    {t("family.awards.communityRejection", { reason: reward.communityAwardRejectionReason })}
                  </Text>
                ) : null}
              </View>
              {isAdmin ? (
                <View style={styles.rowActions}>
                  <Button
                    label={t("common.actions.edit")}
                    variant="secondary"
                    disabled={busy}
                    onPress={() => setEditor(editorFromReward(reward))}
                  />
                  {reward.disabled ? (
                    <Button
                      label={t(busy ? "family.awards.enablingAction" : "family.awards.enableAction")}
                      variant="secondary"
                      disabled={busy}
                      onPress={() => void setRewardDisabled(reward, false)}
                    />
                  ) : (
                    <Button
                      label={t("family.awards.disableAction")}
                      variant="secondary"
                      disabled={busy}
                      onPress={() => setPendingDisable(reward)}
                    />
                  )}
                  <Button
                    label={t("common.actions.delete")}
                    variant="danger"
                    disabled={busy}
                    onPress={() => setPendingDelete(reward)}
                  />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </Card>

      {isAdmin ? <MobileCommunityAwardsLibrary onAwardCopied={() => void load(true)} /> : null}

      {/* Award add / edit sheet */}
      <Modal visible={Boolean(editor)} transparent animationType="slide" onRequestClose={() => setEditor(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {t(editor?.mode === "edit" ? "family.awards.editTitle" : "family.awards.addTitle")}
            </Text>
            {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
              <View style={styles.field}>
                <Text style={styles.label}>{t("family.awards.imageLabel")}</Text>
                <View style={styles.imageGrid}>
                  {FAMILY_REWARD_IMAGE_OPTIONS.map((option) => {
                    const selected = editor?.imageId === option.id;
                    return (
                      <Pressable
                        key={option.id}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={option.label}
                        onPress={() =>
                          setEditor((current) => (current ? { ...current, imageId: option.id } : current))
                        }
                        style={[styles.imageOption, selected ? styles.imageOptionSelected : null]}>
                        <Image source={{ uri: toAppAssetUrl(option.imagePath) }} style={styles.imageOptionImg} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("family.awards.descriptionLabel")}</Text>
                <TextInput
                  value={editor?.description ?? ""}
                  onChangeText={(value) =>
                    setEditor((current) => (current ? { ...current, description: value } : current))
                  }
                  maxLength={MAX_FAMILY_REWARD_DESCRIPTION_LENGTH}
                  placeholder={t("family.awards.descriptionPlaceholder")}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("family.awards.coinCostLabel")}</Text>
                <TextInput
                  value={editor?.coinCost ?? ""}
                  onChangeText={(value) =>
                    setEditor((current) =>
                      current ? { ...current, coinCost: value.replace(/[^0-9]/g, "") } : current,
                    )
                  }
                  keyboardType="number-pad"
                  style={styles.input}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("family.awards.individualLimitLabel")}</Text>
                <TextInput
                  value={editor?.individualLimit ?? ""}
                  onChangeText={(value) =>
                    setEditor((current) =>
                      current ? { ...current, individualLimit: value.replace(/[^0-9]/g, "") } : current,
                    )
                  }
                  keyboardType="number-pad"
                  placeholder={t("family.awards.limitUnlimited")}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
                <Text style={styles.helperText}>{t("family.awards.limitHint")}</Text>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("family.awards.familyLimitLabel")}</Text>
                <TextInput
                  value={editor?.familyLimit ?? ""}
                  onChangeText={(value) =>
                    setEditor((current) =>
                      current ? { ...current, familyLimit: value.replace(/[^0-9]/g, "") } : current,
                    )
                  }
                  keyboardType="number-pad"
                  placeholder={t("family.awards.limitUnlimited")}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
                <Text style={styles.helperText}>{t("family.awards.limitHint")}</Text>
              </View>

              <View style={styles.toggleRow}>
                <View style={styles.toggleCopy}>
                  <Text style={styles.label}>{t("family.awards.submitToCommunity")}</Text>
                  <Text style={styles.helperText}>{t("family.awards.submitToCommunityHelp")}</Text>
                </View>
                <Switch
                  value={editor?.submitToCommunityAwards ?? false}
                  onValueChange={(value) =>
                    setEditor((current) => (current ? { ...current, submitToCommunityAwards: value } : current))
                  }
                  trackColor={{ false: "#cbd5e1", true: "#93c5fd" }}
                  thumbColor={editor?.submitToCommunityAwards ? colors.brand : "#ffffff"}
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
                label={t(busy ? "common.actions.saving" : "common.actions.save")}
                disabled={busy}
                onPress={() => void submitEditor()}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(pendingDisable)}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingDisable(null)}>
        <View style={styles.backdrop}>
          <View style={styles.confirmSheet}>
            <Text style={styles.sheetTitle}>{t("family.awards.disableTitle")}</Text>
            <Text style={styles.confirmText}>
              {t("family.awards.disablePrompt", { name: pendingDisable?.description ?? "" })}
            </Text>
            <View style={styles.sheetActions}>
              <Button
                label={t("common.actions.cancel")}
                variant="secondary"
                onPress={() => setPendingDisable(null)}
              />
              <Button
                label={t(busy ? "family.awards.disablingAction" : "family.awards.disableAction")}
                variant="danger"
                disabled={busy}
                onPress={() => {
                  if (pendingDisable) {
                    void setRewardDisabled(pendingDisable, true);
                  }
                }}
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
            <Text style={styles.sheetTitle}>{t("family.awards.deleteTitle")}</Text>
            <Text style={styles.confirmText}>
              {t("family.awards.deletePrompt", { name: pendingDelete?.description ?? "" })}
            </Text>
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
    </>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.muted, fontSize: typography.small, fontWeight: "700" },
  list: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    padding: spacing.sm,
    flexWrap: "wrap",
  },
  rowDisabled: { opacity: 0.68, backgroundColor: "#f8fafc" },
  rowImage: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    resizeMode: "contain",
  },
  rowCopy: { flex: 1, minWidth: 140, gap: 2 },
  rowTitle: { color: colors.text, fontSize: typography.body, fontWeight: "800" },
  rowMeta: { color: colors.muted, fontSize: typography.tiny, fontWeight: "700" },
  rowBadges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: 2 },
  rowActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
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
  imageGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  imageOption: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  imageOptionSelected: { borderColor: colors.brandStrong },
  imageOptionImg: { width: "100%", height: "100%", resizeMode: "contain" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: "#f8fafc",
    padding: spacing.sm,
  },
  toggleCopy: { flex: 1, gap: 2 },
  errorText: { color: colors.danger, fontSize: typography.small, fontWeight: "700" },
});
