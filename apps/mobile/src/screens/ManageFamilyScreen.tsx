import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  CATEGORY_COLOR_PALETTE,
  isValidCategoryColor,
  normalizeCategoryColor,
  normalizeCategoryName,
} from "@packages/core";
import {
  addMobileFamilyMember,
  changeMobileFamilyMemberEmail,
  createMobileFamilyCategory,
  deleteMobileFamilyCategory,
  fetchMobileFamilyCategories,
  fetchMobileFamilySummary,
  memberAvatarUrl,
  removeMobileFamilyMember,
  updateMobileFamilyCategory,
  updateMobileFamilyMember,
  type MobileFamilyCategory,
  type MobileFamilyMember,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";
import { MobileFamilyAwardsPanel } from "@/components/MobileFamilyAwardsPanel";
import { MobileFamilyFriendsManager } from "@/components/MobileFamilyFriendsManager";
import { MobileFamilyPrivacyPanel } from "@/components/MobileFamilyPrivacyPanel";
import {
  AppScreen,
  AvatarBadge,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeader,
} from "@/components/ui";

// Same tab set as web's /family (FamilySectionTabs), in the same order. Privacy
// is parent-only there and here.
type TabId = "members" | "awards" | "categories" | "friends" | "privacy";

type Props = {
  right?: React.ReactNode;
  onGoDashboard?: () => void;
};

const DEFAULT_CATEGORY_COLOR = CATEGORY_COLOR_PALETTE[0] ?? "#64748b";

// Native Manage Family screen. The profile menu used to deep-link to the web
// app at /family; this covers the same tab set natively — members, family
// awards, chore categories, Family Friends, and privacy (parent-only).
export function ManageFamilyScreen({ right, onGoDashboard }: Props) {
  const { t } = useMobileLocale();
  const [tab, setTab] = useState<TabId>("members");
  const [members, setMembers] = useState<MobileFamilyMember[]>([]);
  const [categories, setCategories] = useState<MobileFamilyCategory[]>([]);
  const [viewerRole, setViewerRole] = useState<"admin" | "player">("player");
  const [familyName, setFamilyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Member add/edit sheet
  const [memberSheet, setMemberSheet] = useState<{ mode: "create" | "edit"; member?: MobileFamilyMember } | null>(null);
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"admin" | "player">("player");
  const [pendingRemoveMember, setPendingRemoveMember] = useState<MobileFamilyMember | null>(null);
  const [memberEmailNotice, setMemberEmailNotice] = useState("");

  // Category add/edit sheet
  const [categorySheet, setCategorySheet] = useState<{ mode: "create" | "edit"; category?: MobileFamilyCategory } | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryColor, setCategoryColor] = useState(DEFAULT_CATEGORY_COLOR);
  const [categoryMemberIds, setCategoryMemberIds] = useState<string[]>([]);
  const [pendingDeleteCategory, setPendingDeleteCategory] = useState<MobileFamilyCategory | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const [summary, categoryState] = await Promise.all([
        fetchMobileFamilySummary(),
        fetchMobileFamilyCategories().catch(() => ({ items: [], viewerRole: "player" as const })),
      ]);
      const activeMembers = summary.members.filter((member) => member.status !== "invited" || member.email);
      setMembers(activeMembers);
      setCategories(categoryState.items);
      setFamilyName(summary.family?.name ?? "");
      const viewer = summary.members.find(
        (member) => member.uid === summary.viewerUid || member.id === summary.viewerUid,
      );
      setViewerRole(viewer?.role === "admin" ? "admin" : "player");
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "family_unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isAdmin = viewerRole === "admin";
  const activeMembers = useMemo(() => members.filter((member) => member.status === "active"), [members]);
  // Privacy controls are parent-only, matching FamilySectionTabs on web.
  const visibleTabs = useMemo<TabId[]>(
    () =>
      isAdmin
        ? ["members", "awards", "categories", "friends", "privacy"]
        : ["members", "awards", "categories", "friends"],
    [isAdmin],
  );

  // A viewer who loses admin (or loads as a player) must never be left sitting on
  // the privacy tab.
  useEffect(() => {
    if (!visibleTabs.includes(tab)) {
      setTab("members");
    }
  }, [tab, visibleTabs]);

  function openCreateMember() {
    setMemberName("");
    setMemberEmail("");
    setMemberRole("player");
    setError("");
    setMemberSheet({ mode: "create" });
  }

  function openEditMember(member: MobileFamilyMember) {
    setMemberName(member.name);
    setMemberEmail(member.email ?? "");
    setMemberRole(member.role === "admin" ? "admin" : "player");
    setError("");
    setMemberEmailNotice("");
    setMemberSheet({ mode: "edit", member });
  }

  // Only a player's address is editable. Changing another parent's address is
  // the co-parent takeover this must not enable, and the server rejects it too.
  const canEditMemberEmail =
    memberSheet?.mode === "create" ||
    (memberSheet?.mode === "edit" && memberSheet.member?.role === "player");

  // Role is set when the member is added and never changed afterwards — there is
  // no server route for it, and promoting a child to parent is not a silent edit.
  const roleLocked = memberSheet?.mode === "edit";

  async function submitMember() {
    if (busy) {
      return;
    }
    const name = memberName.trim();
    const email = memberEmail.trim().toLowerCase();
    if (name.length < 2) {
      setError("name_must_be_between_2_and_80_chars");
      return;
    }
    if (memberRole === "admin" && !email) {
      setError("email_required_for_admin");
      return;
    }
    setBusy(true);
    setError("");
    setMemberEmailNotice("");
    try {
      if (memberSheet?.mode === "edit" && memberSheet.member) {
        const member = memberSheet.member;
        // Send only what actually changed. The member PATCH rejects a body with
        // no supported field (`nothing_to_update`), which used to abort the save
        // before the email call below ever ran. Role is not editable after the
        // member is created — on either client — so it is never sent.
        if (name !== member.name.trim()) {
          await updateMobileFamilyMember(member.id, { name });
        }
        // The email change is a separate, more guarded call: it can require
        // verification, so it must not be folded into the plain member patch.
        const emailChanged = email !== (member.email ?? "").trim().toLowerCase();
        if (emailChanged && canEditMemberEmail && email) {
          const result = await changeMobileFamilyMemberEmail(member.id, email);
          if (result.mode === "verification_required") {
            setMemberEmailNotice(
              `${t("family.memberEmailVerificationSent", { email: result.pendingEmail })}${
                result.invite?.formattedCode ? ` ${result.invite.formattedCode}` : ""
              }`,
            );
          } else {
            setMemberEmailNotice(
              result.canInviteToSignIn
                ? t("family.memberEmailContactOnlyManaged")
                : t("family.memberEmailContactOnlyLinked"),
            );
          }
          // Keep the sheet open so the parent can read the code / explanation.
          await load(true);
          return;
        }
      } else {
        await addMobileFamilyMember({ name, email: email || undefined, role: memberRole });
      }
      setMemberSheet(null);
      await load(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "member_save_failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoveMember() {
    const member = pendingRemoveMember;
    setPendingRemoveMember(null);
    if (!member || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await removeMobileFamilyMember(member.id);
      await load(true);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "member_remove_failed");
    } finally {
      setBusy(false);
    }
  }

  function openCreateCategory() {
    setCategoryName("");
    setCategoryColor(DEFAULT_CATEGORY_COLOR);
    setCategoryMemberIds([]);
    setError("");
    setCategorySheet({ mode: "create" });
  }

  function openEditCategory(category: MobileFamilyCategory) {
    setCategoryName(category.name);
    setCategoryColor(normalizeCategoryColor(category.color || DEFAULT_CATEGORY_COLOR));
    setCategoryMemberIds(
      category.memberIds && category.memberIds.length > 0
        ? category.memberIds
        : category.memberId
          ? [category.memberId]
          : [],
    );
    setError("");
    setCategorySheet({ mode: "edit", category });
  }

  async function submitCategory() {
    if (busy) {
      return;
    }
    const name = normalizeCategoryName(categoryName);
    const color = normalizeCategoryColor(categoryColor);
    if (!name) {
      setError("name_required");
      return;
    }
    if (!isValidCategoryColor(color)) {
      setError("invalid_color");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (categorySheet?.mode === "edit" && categorySheet.category) {
        await updateMobileFamilyCategory(categorySheet.category.id, {
          name,
          color,
          memberIds: categoryMemberIds,
        });
      } else {
        await createMobileFamilyCategory({ name, color, memberIds: categoryMemberIds });
      }
      setCategorySheet(null);
      await load(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "category_save_failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteCategory() {
    const category = pendingDeleteCategory;
    setPendingDeleteCategory(null);
    if (!category || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await deleteMobileFamilyCategory(category.id);
      await load(true);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "category_delete_failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleCategoryMember(memberId: string) {
    setCategoryMemberIds((current) =>
      current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId],
    );
  }

  if (loading) {
    return (
      <AppScreen title={t("nav.manageFamily")} right={right} onPressBreadcrumbRoot={onGoDashboard}>
        <LoadingState label={t("common.actions.loading")} />
      </AppScreen>
    );
  }

  return (
    <AppScreen
      title={t("nav.manageFamily")}
      subtitle={familyName || undefined}
      right={right}
      onPressBreadcrumbRoot={onGoDashboard}>
      {error && !memberSheet && !categorySheet ? <ErrorState message={error} /> : null}

      {/* Five tabs do not fit a phone width side by side, so the row scrolls
          horizontally instead of squeezing every label to an ellipsis. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}>
        {visibleTabs.map((value) => {
          const active = tab === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(value)}
              style={[styles.tab, active ? styles.tabActive : null]}>
              <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]} numberOfLines={1}>
                {t(`family.tabs.${value}`)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {tab === "awards" ? <MobileFamilyAwardsPanel isAdmin={isAdmin} /> : null}
      {tab === "friends" ? <MobileFamilyFriendsManager /> : null}
      {tab === "privacy" ? <MobileFamilyPrivacyPanel isAdmin={isAdmin} /> : null}

      {tab === "members" ? (
        <Card>
          <SectionHeader title={t("family.membersTitle")} />
          {isAdmin ? (
            <Button label={t("family.addFamilyMember")} onPress={openCreateMember} />
          ) : null}
          {members.length === 0 ? <EmptyState message={t("family.memberEmpty")} /> : null}
          <View style={styles.list}>
            {members.map((member) => (
              <View key={member.id} style={styles.row}>
                <AvatarBadge
                  name={member.name}
                  imageUrl={memberAvatarUrl(member)}
                  color={member.dashboardPrimaryColor || colors.brand}
                  size={36}
                />
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>{member.name}</Text>
                  {member.email ? <Text style={styles.rowMeta}>{member.email}</Text> : null}
                  <View style={styles.rowBadges}>
                    <Badge label={member.role === "admin" ? t("family.roleAdmin") : t("family.rolePlayer")} />
                    {member.status === "invited" ? <Badge label={t("family.statusInvited")} /> : null}
                  </View>
                </View>
                {isAdmin ? (
                  <View style={styles.rowActions}>
                    <Button
                      label={t("common.actions.edit")}
                      variant="secondary"
                      disabled={busy}
                      onPress={() => openEditMember(member)}
                    />
                    <Button
                      label={t("family.remove")}
                      variant="danger"
                      disabled={busy}
                      onPress={() => setPendingRemoveMember(member)}
                    />
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {tab === "categories" ? (
        <Card>
          <SectionHeader title={t("family.tabs.categories")} />
          {isAdmin ? (
            <Button label={t("family.addCategory")} onPress={openCreateCategory} />
          ) : null}
          {categories.length === 0 ? <EmptyState message={t("choreDialog.noCategories")} /> : null}
          <View style={styles.list}>
            {categories.map((category) => {
              const scopedIds =
                category.memberIds && category.memberIds.length > 0
                  ? category.memberIds
                  : category.memberId
                    ? [category.memberId]
                    : [];
              const scopeNames = scopedIds
                .map((id) => members.find((member) => member.id === id)?.name)
                .filter((name): name is string => Boolean(name));
              return (
                <View key={category.id} style={styles.row}>
                  <View style={[styles.colorDot, { backgroundColor: category.color }]} />
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle}>{category.name}</Text>
                    <Text style={styles.rowMeta}>
                      {scopeNames.length > 0 ? scopeNames.join(", ") : t("family.categoryWholeFamily")}
                    </Text>
                  </View>
                  {isAdmin ? (
                    <View style={styles.rowActions}>
                      <Button
                        label={t("common.actions.edit")}
                        variant="secondary"
                        disabled={busy}
                        onPress={() => openEditCategory(category)}
                      />
                      <Button
                        label={t("common.actions.delete")}
                        variant="danger"
                        disabled={busy}
                        onPress={() => setPendingDeleteCategory(category)}
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </Card>
      ) : null}

      {/* Member add / edit sheet */}
      <Modal
        visible={Boolean(memberSheet)}
        transparent
        animationType="slide"
        onRequestClose={() => setMemberSheet(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {memberSheet?.mode === "edit" ? t("family.editMember") : t("family.addFamilyMember")}
            </Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
              <View style={styles.field}>
                <Text style={styles.label}>{t("family.memberNameLabel")}</Text>
                <TextInput value={memberName} onChangeText={setMemberName} style={styles.input} />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>{t("family.memberEmailLabel")}</Text>
                <TextInput
                  value={memberEmail}
                  onChangeText={setMemberEmail}
                  editable={canEditMemberEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={[styles.input, canEditMemberEmail ? null : styles.inputDisabled]}
                />
                {memberSheet?.mode === "edit" && memberSheet.member?.pendingEmail ? (
                  <Text style={styles.rowMeta}>
                    {t("family.memberEmailPending", { email: memberSheet.member.pendingEmail })}
                  </Text>
                ) : null}
                {memberEmailNotice ? <Text style={styles.rowMeta}>{memberEmailNotice}</Text> : null}
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>{t("family.memberRoleLabel")}</Text>
                <View style={styles.chipRow}>
                  {(["player", "admin"] as const).map((value) => {
                    const active = memberRole === value;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active, disabled: roleLocked }}
                        disabled={roleLocked}
                        onPress={() => setMemberRole(value)}
                        style={[
                          styles.chip,
                          active ? styles.chipActive : null,
                          roleLocked && !active ? styles.chipDisabled : null,
                        ]}>
                        <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                          {value === "admin" ? t("family.roleAdmin") : t("family.rolePlayer")}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {roleLocked ? <Text style={styles.rowMeta}>{t("family.memberRoleLocked")}</Text> : null}
              </View>
            </ScrollView>
            <View style={styles.sheetActions}>
              <Button
                label={t("common.actions.cancel")}
                variant="secondary"
                disabled={busy}
                onPress={() => setMemberSheet(null)}
              />
              <Button
                label={busy ? t("common.actions.saving") : t("common.actions.save")}
                disabled={busy}
                onPress={() => void submitMember()}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Category add / edit sheet */}
      <Modal
        visible={Boolean(categorySheet)}
        transparent
        animationType="slide"
        onRequestClose={() => setCategorySheet(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {categorySheet?.mode === "edit" ? t("family.editCategory") : t("family.addCategory")}
            </Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
              <View style={styles.field}>
                <Text style={styles.label}>{t("family.categoryNameLabel")}</Text>
                <TextInput value={categoryName} onChangeText={setCategoryName} style={styles.input} />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>{t("family.categoryColorLabel")}</Text>
                <View style={styles.swatchGrid}>
                  {CATEGORY_COLOR_PALETTE.map((hex) => {
                    const selected = normalizeCategoryColor(categoryColor) === hex;
                    return (
                      <Pressable
                        key={hex}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={hex}
                        onPress={() => setCategoryColor(hex)}
                        style={[
                          styles.swatch,
                          { backgroundColor: hex },
                          selected ? styles.swatchSelected : null,
                        ]}
                      />
                    );
                  })}
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>{t("family.categoryMembersLabel")}</Text>
                <Text style={styles.helperText}>{t("family.categoryWholeFamilyHint")}</Text>
                <View style={styles.chipRow}>
                  {activeMembers.map((member) => {
                    const active = categoryMemberIds.includes(member.id);
                    return (
                      <Pressable
                        key={member.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: active }}
                        onPress={() => toggleCategoryMember(member.id)}
                        style={[styles.chip, active ? styles.chipActive : null]}>
                        <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                          {member.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </ScrollView>
            <View style={styles.sheetActions}>
              <Button
                label={t("common.actions.cancel")}
                variant="secondary"
                disabled={busy}
                onPress={() => setCategorySheet(null)}
              />
              <Button
                label={busy ? t("common.actions.saving") : t("common.actions.save")}
                disabled={busy}
                onPress={() => void submitCategory()}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Destructive confirmations */}
      <Modal
        visible={Boolean(pendingRemoveMember)}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingRemoveMember(null)}>
        <View style={styles.backdrop}>
          <View style={styles.confirmSheet}>
            <Text style={styles.sheetTitle}>{t("family.removeMemberTitle")}</Text>
            <Text style={styles.confirmText}>
              {t("family.removeMemberPrompt", { name: pendingRemoveMember?.name ?? "" })}
            </Text>
            <View style={styles.sheetActions}>
              <Button
                label={t("common.actions.cancel")}
                variant="secondary"
                onPress={() => setPendingRemoveMember(null)}
              />
              <Button
                label={t("family.remove")}
                variant="danger"
                onPress={() => void confirmRemoveMember()}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(pendingDeleteCategory)}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingDeleteCategory(null)}>
        <View style={styles.backdrop}>
          <View style={styles.confirmSheet}>
            <Text style={styles.sheetTitle}>{t("family.deleteCategoryTitle")}</Text>
            <Text style={styles.confirmText}>
              {t("family.deleteCategoryBody", { name: pendingDeleteCategory?.name ?? "" })}
            </Text>
            <View style={styles.sheetActions}>
              <Button
                label={t("common.actions.cancel")}
                variant="secondary"
                onPress={() => setPendingDeleteCategory(null)}
              />
              <Button
                label={t("common.actions.delete")}
                variant="danger"
                onPress={() => void confirmDeleteCategory()}
              />
            </View>
          </View>
        </View>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", gap: spacing.xs, paddingRight: spacing.xs },
  tab: {
    minHeight: 44,
    minWidth: 96,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: "#fff",
  },
  tabActive: { borderColor: colors.brandStrong, backgroundColor: colors.brandStrong },
  tabLabel: { color: colors.text, fontSize: typography.small, fontWeight: "800" },
  tabLabelActive: { color: "#fff" },
  list: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    padding: spacing.sm,
    flexWrap: "wrap",
  },
  rowCopy: { flex: 1, minWidth: 120, gap: 2 },
  rowTitle: { color: colors.text, fontSize: typography.body, fontWeight: "800" },
  rowMeta: { color: colors.muted, fontSize: typography.tiny, fontWeight: "700" },
  rowBadges: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  rowActions: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  colorDot: { width: 28, height: 28, borderRadius: 999, borderWidth: 1, borderColor: "rgba(0,0,0,0.1)" },
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
  inputDisabled: { backgroundColor: "#f1f5f9", color: colors.muted },
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
  chipDisabled: { backgroundColor: "#f1f5f9", opacity: 0.6 },
  chipText: { color: colors.text, fontSize: typography.small, fontWeight: "800" },
  chipTextActive: { color: "#fff" },
  swatchGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchSelected: { borderColor: colors.text },
  errorText: { color: colors.danger, fontSize: typography.small, fontWeight: "700" },
});
