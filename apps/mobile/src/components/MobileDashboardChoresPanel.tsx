import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  choreNeedsCoinAssignmentPrompt,
  shouldHideChoreCoinValue,
  createApprovalAssigneeSelections,
  getDashboardChorePage,
  listApprovalPayouts,
  sortDashboardChores,
  toggleApprovalAssigneeSelection,
  updateApprovalAssigneeCoins,
  type ApprovalAssigneeSelectionMap,
  type DashboardSortDirection,
  type DashboardSortKey,
} from "@packages/core";
import {
  completeMobileChore,
  createMobileChore,
  deleteMobileChore,
  editMobileChore,
  fetchMobileChore,
  fetchMobileFamilySummary,
  type MobileChoreDetail,
  type MobileFamilyCategory,
  patchMobileChore,
  reorderMobileChores,
  type MobileFamilyChore,
  type MobileFamilyMember,
} from "@/lib/api";
import { MobileChoreEditorModal, type MobileChoreEditorSubmitPayload } from "@/components/MobileChoreEditorModal";
import { MobileGhostChores } from "@/components/MobileGhostChores";
import { loadDashboardChorePreferences, saveDashboardChorePreferences } from "@/lib/mobile-preferences";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";
import { Badge, Button, Card, CoinPill, EmptyState, ErrorState, LoadingState } from "@/components/ui";

const PAGE_SIZE = 100;

type MobileDashboardChoresPanelProps = {
  onOpenAllChores?: () => void;
};

function normalizeAlias(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function memberAliases(member: MobileFamilyMember) {
  return [member.id, member.uid, member.email].map(normalizeAlias).filter(Boolean);
}

function choreMatchesMember(chore: MobileFamilyChore, member: MobileFamilyMember) {
  if (chore.assigneeScope === "family") return true;
  const aliases = new Set(memberAliases(member));
  return (
    (chore.assigneeIds ?? []).some((id) => aliases.has(normalizeAlias(id))) ||
    Boolean(chore.assigneeId && aliases.has(normalizeAlias(chore.assigneeId)))
  );
}

function getApprovalAssigneeIds(chore: MobileFamilyChore, members: MobileFamilyMember[]) {
  if (chore.assigneeScope === "family") {
    return members.filter((member) => member.status === "active").map((member) => member.id);
  }
  if (chore.assigneeIds && chore.assigneeIds.length > 0) {
    return chore.assigneeIds;
  }
  return chore.assigneeId ? [chore.assigneeId] : [];
}

function avatarUrl(avatarId?: string, avatarPhotoUrl?: string) {
  if (avatarPhotoUrl) return avatarPhotoUrl;
  if (!avatarId) return "";
  return `${process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/api\/v1\/?$/, "") ?? "http://localhost:3000"}/avatars/default/${encodeURIComponent(avatarId)}`;
}

function Avatar({ name, imageUrl, color }: { name: string; imageUrl?: string; color?: string }) {
  const initial = (name || "U").trim().charAt(0).toUpperCase();
  return (
    <View style={[styles.avatar, color ? { borderColor: color, backgroundColor: color } : null]}>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>{initial}</Text>}
    </View>
  );
}

function FamilyAvatar() {
  return (
    <View style={styles.familyAvatar}>
      <View style={styles.familyAvatarHeadLeft} />
      <View style={styles.familyAvatarHeadRight} />
      <View style={styles.familyAvatarBodyLeft} />
      <View style={styles.familyAvatarBodyRight} />
    </View>
  );
}

function PlusIcon({ color = "#fff" }: { color?: string }) {
  return (
    <View style={styles.plusIcon}>
      <View style={[styles.plusIconStroke, styles.plusIconHorizontal, { backgroundColor: color }]} />
      <View style={[styles.plusIconStroke, styles.plusIconVertical, { backgroundColor: color }]} />
    </View>
  );
}

function HamburgerIcon({ color = colors.brandStrong }: { color?: string }) {
  return (
    <View style={styles.hamburgerIcon}>
      <View style={[styles.hamburgerIconBar, { backgroundColor: color }]} />
      <View style={[styles.hamburgerIconBar, styles.hamburgerIconBarMedium, { backgroundColor: color }]} />
      <View style={[styles.hamburgerIconBar, styles.hamburgerIconBarShort, { backgroundColor: color }]} />
    </View>
  );
}

function SortIcon({ color = colors.brandStrong }: { color?: string }) {
  return (
    <View style={styles.sortIcon}>
      <View style={[styles.sortIconBar, { backgroundColor: color }]} />
      <View style={[styles.sortIconBar, styles.sortIconBarMedium, { backgroundColor: color }]} />
      <View style={[styles.sortIconBar, styles.sortIconBarShort, { backgroundColor: color }]} />
    </View>
  );
}

function TableIcon({ color = colors.brandStrong }: { color?: string }) {
  return (
    <View style={styles.tableIcon}>
      <View style={[styles.tableIconFrame, { borderColor: color }]}>
        <View style={[styles.tableIconColumn, { backgroundColor: color }]} />
        <View style={[styles.tableIconColumn, { backgroundColor: color }]} />
        <View style={[styles.tableIconColumn, { backgroundColor: color }]} />
      </View>
      <View style={[styles.tableIconRow, { backgroundColor: color }]} />
      <View style={[styles.tableIconRow, styles.tableIconRowBottom, { backgroundColor: color }]} />
    </View>
  );
}

export function MobileDashboardChoresPanel({ onOpenAllChores }: MobileDashboardChoresPanelProps) {
  const { t } = useMobileLocale();
  const preferencesViewerKeyRef = useRef("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [members, setMembers] = useState<MobileFamilyMember[]>([]);
  const [categories, setCategories] = useState<MobileFamilyCategory[]>([]);
  const [chores, setChores] = useState<MobileFamilyChore[]>([]);
  const [viewerRole, setViewerRole] = useState<"admin" | "player">("player");
  const [viewerAliases, setViewerAliases] = useState<string[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [sortKey, setSortKey] = useState<DashboardSortKey>("manual");
  const [sortDirection, setSortDirection] = useState<DashboardSortDirection>("asc");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [celebrating, setCelebrating] = useState(false);
  const [menuChoreId, setMenuChoreId] = useState("");
  const [pendingDeleteChore, setPendingDeleteChore] = useState<MobileFamilyChore | null>(null);
  const [pendingApproveChore, setPendingApproveChore] = useState<MobileFamilyChore | null>(null);
  const [approvalSelectionsByAssignee, setApprovalSelectionsByAssignee] = useState<ApprovalAssigneeSelectionMap>({});
  const [editOpen, setEditOpen] = useState(false);
  const [editingChore, setEditingChore] = useState<MobileChoreDetail | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);

  async function load(options?: { silent?: boolean }) {
    setError("");
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const summary = await fetchMobileFamilySummary();
      const activeMembers = summary.members.filter((member) => member.status === "active");
      const viewer =
        activeMembers.find((member) => member.uid === summary.viewerUid || member.id === summary.viewerUid) ??
        activeMembers[0] ??
        null;
      const viewerKey = summary.viewerUid || viewer?.uid || viewer?.id || "default";
      const isFirstLoadForViewer = preferencesViewerKeyRef.current !== viewerKey;
      const preferences = isFirstLoadForViewer
        ? await loadDashboardChorePreferences(viewerKey)
        : null;
      setMembers(activeMembers);
      setCategories(summary.categories ?? []);
      setChores(summary.choresToday.filter((chore) => chore.status === "Open"));
      setViewerRole(viewer?.role ?? "player");
      setViewerAliases(summary.viewerAssigneeAliases?.length ? summary.viewerAssigneeAliases : viewer ? memberAliases(viewer) : []);
      if (isFirstLoadForViewer) {
        preferencesViewerKeyRef.current = viewerKey;
        setSortKey(preferences?.sortKey ?? "manual");
        setSortDirection(preferences?.sortDirection ?? "asc");
        const preferredMemberId = preferences?.selectedMemberId || viewer?.id || "family";
        const validPreferredMemberId =
          preferredMemberId === "family" || activeMembers.some((member) => member.id === preferredMemberId)
            ? preferredMemberId
            : viewer?.id || "family";
        setSelectedMemberId(validPreferredMemberId);
      } else {
        setSelectedMemberId((current) =>
          current === "family" || activeMembers.some((member) => member.id === current)
            ? current
            : viewer?.id || "family",
        );
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "family_summary_unavailable");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      } else {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!preferencesViewerKeyRef.current) {
      return;
    }
    void saveDashboardChorePreferences(preferencesViewerKeyRef.current, {
      selectedMemberId,
      sortKey,
      sortDirection,
    });
  }, [selectedMemberId, sortDirection, sortKey]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [selectedMemberId, sortKey, sortDirection, chores]);

  const selectedMember = members.find((member) => member.id === selectedMemberId) ?? null;
  const filteredChores = useMemo(() => {
    const scoped =
      selectedMemberId === "family" || !selectedMember
        ? chores
        : chores.filter((chore) => choreMatchesMember(chore, selectedMember));
    return sortDashboardChores(scoped, sortKey, sortDirection);
  }, [chores, selectedMember, selectedMemberId, sortDirection, sortKey]);
  const chorePage = getDashboardChorePage(filteredChores, visibleCount);
  const viewerAliasSet = useMemo(() => new Set(viewerAliases.map(normalizeAlias)), [viewerAliases]);

  function closeApproveModal() {
    setPendingApproveChore(null);
    setApprovalSelectionsByAssignee({});
  }

  async function completeChore(chore: MobileFamilyChore) {
    if (busyId) return;
    const needsApprovalCoinPrompt = choreNeedsCoinAssignmentPrompt(chore);
    if (viewerRole === "admin" && needsApprovalCoinPrompt) {
      const assigneeIds = getApprovalAssigneeIds(chore, members);
      setApprovalSelectionsByAssignee(createApprovalAssigneeSelections(assigneeIds, chore.coinValue ?? 0));
      setPendingApproveChore(chore);
      return;
    }
    setBusyId(chore.id);
    setCelebrating(true);
    setTimeout(() => setCelebrating(false), 900);
    try {
      await completeMobileChore(chore.id);
      await load({ silent: true });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "complete_chore_failed");
      await load();
    } finally {
      setBusyId("");
    }
  }

  async function completeAndApproveChore() {
    if (!pendingApproveChore || busyId) {
      return;
    }
    const assigneeIds = getApprovalAssigneeIds(pendingApproveChore, members);
    setBusyId(pendingApproveChore.id);
    setError("");
    try {
      await completeMobileChore(
        pendingApproveChore.id,
        { approvalPayouts: listApprovalPayouts(approvalSelectionsByAssignee, assigneeIds) },
      );
      closeApproveModal();
      await load({ silent: true });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "complete_and_approve_failed");
    } finally {
      setBusyId("");
    }
  }

  async function addChore(payload: MobileChoreEditorSubmitPayload) {
    setError("");
    setCreateSaving(true);
    try {
      await createMobileChore(payload);
      setAddOpen(false);
      await load();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "create_chore_failed";
      setError(message);
      throw nextError instanceof Error ? nextError : new Error(message);
    } finally {
      setCreateSaving(false);
    }
  }

  async function deleteChore(chore: MobileFamilyChore) {
    if (busyId) return;
    setError("");
    setBusyId(chore.id);
    setChores((current) => current.filter((item) => item.id !== chore.id));
    try {
      await deleteMobileChore(chore.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "delete_chore_failed");
      await load();
    } finally {
      setBusyId("");
    }
  }

  async function moveChore(chore: MobileFamilyChore, direction: -1 | 1) {
    const currentIds = filteredChores.map((item) => item.id);
    const index = currentIds.indexOf(chore.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= currentIds.length) return;
    const nextIds = [...currentIds];
    nextIds.splice(index, 1);
    nextIds.splice(nextIndex, 0, chore.id);
    setChores((current) =>
      current.map((item) => {
        const orderIndex = nextIds.indexOf(item.id);
        return orderIndex >= 0 ? { ...item, sortOrder: orderIndex } : item;
      }),
    );
    try {
      await reorderMobileChores(nextIds);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "reorder_chores_failed");
      await load();
    }
  }

  function closeEditModal() {
    setEditOpen(false);
    setEditingChore(null);
    setEditLoading(false);
    setEditSaving(false);
  }

  async function openEditModal(choreId: string) {
    setMenuChoreId("");
    setEditLoading(true);
    setEditOpen(true);
    setError("");
    try {
      const detail = await fetchMobileChore(choreId);
      setEditingChore(detail);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "fetch_chore_failed");
      closeEditModal();
    } finally {
      setEditLoading(false);
    }
  }

  async function saveEditedChore(payload: MobileChoreEditorSubmitPayload) {
    if (!editingChore || editSaving) return;
    setEditSaving(true);
    setError("");
    try {
      await editMobileChore(editingChore.id, {
        action: "edit",
        ...payload,
      });
      closeEditModal();
      await load();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "update_chore_failed";
      setError(message);
      throw nextError instanceof Error ? nextError : new Error(message);
    } finally {
      setEditSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading dashboard..." />;
  if (error && chores.length === 0) return <ErrorState message={`Could not load chores: ${error}`} />;

  const selectedMenuChore = chorePage.visibleItems.find((chore) => chore.id === menuChoreId) ?? null;
  const selectedMenuIndex = selectedMenuChore
    ? filteredChores.findIndex((chore) => chore.id === selectedMenuChore.id)
    : -1;
  const canMoveMenuChore =
    viewerRole === "admin" && sortKey === "manual" && !busyId && selectedMenuIndex >= 0;

  return (
    <Card>
      <View style={styles.toolbar}>
        <View style={styles.filterRow}>
          <View style={styles.scopeGroup}>
            <Pressable style={styles.scopeButton} onPress={() => setScopeOpen(true)}>
              {selectedMember ? (
                <Avatar
                  name={selectedMember.name}
                  imageUrl={avatarUrl(selectedMember.avatarId, selectedMember.avatarPhotoUrl)}
                  color={selectedMember.dashboardPrimaryColor}
                />
              ) : (
                <FamilyAvatar />
              )}
              <Text style={styles.scopeText} numberOfLines={1}>{selectedMember?.name ?? "Family"}</Text>
              {selectedMember?.stats?.currentCoins !== undefined ? <CoinPill value={selectedMember.stats.currentCoins} /> : null}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dashboard options"
              onPress={() => setOptionsOpen(true)}
              style={({ pressed }) => [styles.scopeMenuButton, pressed ? styles.actionPressed : null]}>
              <HamburgerIcon />
            </Pressable>
          </View>
        </View>
        <Button label="Add Chore" variant="success" leadingIcon={<PlusIcon />} onPress={() => setAddOpen(true)} />
        <View style={styles.toolbarDivider} />
      </View>
      {error ? <ErrorState message={error} /> : null}
      {chorePage.visibleItems.length === 0 ? (
        <>
          <EmptyState message={selectedMember ? `No chores assigned to ${selectedMember.name} right now.` : "No open chores right now."} />
          <MobileGhostChores
            assigneeId={selectedMember?.id}
            assigneeName={selectedMember?.name}
            onAdded={() => load({ silent: true })}
          />
        </>
      ) : (
        <View style={styles.list}>
          {chorePage.visibleItems.map((chore) => {
            const canComplete =
              viewerRole === "admin" ||
              (chore.assigneeIds ?? []).some((id) => viewerAliasSet.has(normalizeAlias(id))) ||
              Boolean(chore.assigneeId && viewerAliasSet.has(normalizeAlias(chore.assigneeId)));
            const imageUrl = avatarUrl(chore.assigneeAvatarId, chore.assigneeAvatarPhotoUrl);
            return (
              <View key={chore.id} style={[styles.choreCard, chore.assigneePrimaryColor ? { borderLeftColor: chore.assigneePrimaryColor } : null]}>
                <View style={styles.choreTop}>
                  <Avatar name={chore.assigneeName || "Family member"} imageUrl={imageUrl} color={chore.assigneePrimaryColor} />
                  <View style={styles.choreCopy}>
                    <Text style={styles.choreTitle}>{chore.title}</Text>
                    <Text style={styles.choreAssignee}>{chore.assigneeName || "Unassigned"}</Text>
                    <View style={styles.categoryRow}>
                      {(chore.categories ?? []).slice(0, 2).map((category) => <Badge key={category.id} label={category.name} />)}
                    </View>
                  </View>
                  <CoinPill value={shouldHideChoreCoinValue(chore) ? "-" : chore.coinValue ?? 0} />
                </View>
                <View style={styles.cardActions}>
                  <View style={styles.actionGroup}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={!canComplete || Boolean(busyId)}
                      onPress={() => void completeChore(chore)}
                      style={({ pressed }) => [
                        styles.completeButton,
                        viewerRole === "admin" ? styles.completeButtonGrouped : null,
                        (!canComplete || Boolean(busyId)) && styles.actionDisabled,
                        pressed && canComplete && !busyId ? styles.actionPressed : null,
                      ]}>
                      <Text style={styles.completeButtonText}>
                        {busyId === chore.id ? "Saving..." : busyId ? "Please wait..." : "Mark as Complete"}
                      </Text>
                    </Pressable>
                    {viewerRole === "admin" ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Chore options"
                        disabled={Boolean(busyId)}
                        onPress={() => setMenuChoreId(chore.id)}
                        style={({ pressed }) => [
                          styles.menuButton,
                          Boolean(busyId) && styles.actionDisabled,
                          pressed && !busyId ? styles.actionPressed : null,
                        ]}>
                        <Text style={styles.menuButtonText}>☰</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
      {chorePage.hasMore ? <Button label="Load More" variant="secondary" onPress={() => setVisibleCount((current) => current + PAGE_SIZE)} /> : null}
      {celebrating ? (
        <View pointerEvents="none" style={styles.celebration}>
          <Text style={styles.celebrationText}>All Done!</Text>
        </View>
      ) : null}
      <Modal visible={scopeOpen} transparent animationType="fade" onRequestClose={() => setScopeOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setScopeOpen(false)}>
          <View style={styles.sheet}>
            <Pressable
              accessibilityRole="button"
              onPress={() => { setSelectedMemberId("family"); setScopeOpen(false); }}
              style={({ pressed }) => [styles.scopeOption, pressed ? styles.actionPressed : null]}>
              <FamilyAvatar />
              <Text style={styles.scopeOptionText}>Family</Text>
            </Pressable>
            {members.map((member) => (
              <Pressable
                key={member.id}
                accessibilityRole="button"
                onPress={() => { setSelectedMemberId(member.id); setScopeOpen(false); }}
                style={({ pressed }) => [styles.scopeOption, pressed ? styles.actionPressed : null]}>
                <Avatar
                  name={member.name}
                  imageUrl={avatarUrl(member.avatarId, member.avatarPhotoUrl)}
                  color={member.dashboardPrimaryColor}
                />
                <Text style={styles.scopeOptionText}>{member.name}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
      <Modal visible={sortOpen} transparent animationType="fade" onRequestClose={() => setSortOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSortOpen(false)}>
          <View style={styles.sheet}>
            {(["manual", "coin_value", "frequency", "alphabetical"] as DashboardSortKey[]).map((key) => (
              <Button
                key={key}
                label={`${key.replace(/_/g, " ")}${sortKey === key ? ` (${sortDirection})` : ""}`}
                variant="secondary"
                onPress={() => {
                  if (sortKey === key && key !== "manual") {
                    setSortDirection((current) => current === "asc" ? "desc" : "asc");
                  } else {
                    setSortKey(key);
                    setSortDirection(key === "alphabetical" || key === "manual" ? "asc" : "desc");
                  }
                  setSortOpen(false);
                }}
              />
            ))}
          </View>
        </Pressable>
      </Modal>
      <Modal visible={optionsOpen} transparent animationType="fade" onRequestClose={() => setOptionsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOptionsOpen(false)}>
          <View style={styles.sheet}>
            <Button
              label="Sort"
              variant="secondary"
              leadingIcon={<SortIcon />}
              onPress={() => {
                setOptionsOpen(false);
                setSortOpen(true);
              }}
            />
            <Button
              label="View All Chores"
              variant="secondary"
              leadingIcon={<TableIcon />}
              onPress={() => {
                setOptionsOpen(false);
                onOpenAllChores?.();
              }}
            />
          </View>
        </Pressable>
      </Modal>
      <Modal visible={Boolean(selectedMenuChore)} transparent animationType="fade" onRequestClose={() => setMenuChoreId("")}>
        <Pressable style={styles.backdrop} onPress={() => setMenuChoreId("")}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{selectedMenuChore?.title ?? "Chore options"}</Text>
            <Button label="Edit" variant="secondary" onPress={() => void openEditModal(menuChoreId)} />
            <Button
              label={busyId === selectedMenuChore?.id ? "Deleting..." : "Delete"}
              variant="danger"
              disabled={busyId === selectedMenuChore?.id}
              onPress={() => {
                const chore = selectedMenuChore;
                setMenuChoreId("");
                if (chore) {
                  setPendingDeleteChore(chore);
                }
              }}
            />
            <View style={styles.sheetDivider} />
            <Button
              label="Move Up"
              variant="secondary"
              disabled={!canMoveMenuChore || selectedMenuIndex === 0}
              onPress={() => {
                const chore = selectedMenuChore;
                setMenuChoreId("");
                if (chore) {
                  void moveChore(chore, -1);
                }
              }}
            />
            <Button
              label="Move Down"
              variant="secondary"
              disabled={!canMoveMenuChore || selectedMenuIndex === filteredChores.length - 1}
              onPress={() => {
                const chore = selectedMenuChore;
                setMenuChoreId("");
                if (chore) {
                  void moveChore(chore, 1);
                }
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={Boolean(pendingDeleteChore)} transparent animationType="fade" onRequestClose={() => setPendingDeleteChore(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPendingDeleteChore(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Delete Chore</Text>
            <Text style={styles.confirmText}>
              Delete <Text style={styles.confirmTextStrong}>{pendingDeleteChore?.title ?? "this chore"}</Text>?
            </Text>
            <Button label="Cancel" variant="secondary" onPress={() => setPendingDeleteChore(null)} />
            <Button
              label={busyId === pendingDeleteChore?.id ? "Deleting..." : "Delete"}
              variant="danger"
              disabled={busyId === pendingDeleteChore?.id}
              onPress={() => {
                const chore = pendingDeleteChore;
                setPendingDeleteChore(null);
                if (chore) {
                  void deleteChore(chore);
                }
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={Boolean(pendingApproveChore)} transparent animationType="fade" onRequestClose={closeApproveModal}>
        <Pressable style={styles.backdrop} onPress={closeApproveModal}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {pendingApproveChore ? (
              <>
                {(() => {
                  const assigneeIds = getApprovalAssigneeIds(pendingApproveChore, members);
                  return (
                    <>
                      <Text style={styles.sheetTitle}>{t("dashboard.completeApproveTitle")}</Text>
                      <Text style={styles.confirmText}>
                        <Text style={styles.confirmTextStrong}>{pendingApproveChore.title}</Text> {t("dashboard.totalCoins")}{" "}
                        <Text style={styles.confirmTextStrong}>{pendingApproveChore.coinValue ?? 0}</Text>
                      </Text>
                      <ScrollView style={styles.approvalList} contentContainerStyle={styles.approvalListContent}>
                        {assigneeIds.map((assigneeId) => {
                          const member = members.find((entry) => memberAliases(entry).includes(normalizeAlias(assigneeId)));
                          const selection = approvalSelectionsByAssignee[assigneeId] ?? { enabled: true, coinValue: 0 };
                          return (
                            <Pressable
                              key={assigneeId}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: selection.enabled }}
                              onPress={() =>
                                setApprovalSelectionsByAssignee((current) =>
                                  toggleApprovalAssigneeSelection(
                                    current,
                                    assigneeIds,
                                    assigneeId,
                                    pendingApproveChore.coinValue ?? 0,
                                  ),
                                )
                              }
                              style={({ pressed }) => [
                                styles.approvalRow,
                                !selection.enabled ? styles.approvalRowDisabled : null,
                                pressed ? styles.actionPressed : null,
                              ]}>
                              <View style={styles.approvalIdentity}>
                                <View style={[styles.approvalCheckbox, selection.enabled ? styles.approvalCheckboxChecked : null]}>
                                  {selection.enabled ? <Text style={styles.approvalCheckboxMark}>✓</Text> : null}
                                </View>
                                <View style={!selection.enabled ? styles.approvalAvatarDisabled : null}>
                                  <Avatar
                                    name={member?.name || assigneeId}
                                    imageUrl={member ? avatarUrl(member.avatarId, member.avatarPhotoUrl) : ""}
                                    color={member?.dashboardPrimaryColor}
                                  />
                                </View>
                                <Text style={[styles.approvalName, !selection.enabled ? styles.approvalNameDisabled : null]} numberOfLines={1}>
                                  {member?.name || assigneeId}
                                </Text>
                              </View>
                              <View style={styles.approvalAmountWrap}>
                                <Text style={styles.approvalCoinPrefix}>$</Text>
                                <TextInput
                                  value={String(selection.enabled ? selection.coinValue : 0)}
                                  editable={selection.enabled}
                                  keyboardType="number-pad"
                                  style={[styles.approvalAmountInput, !selection.enabled ? styles.approvalAmountInputDisabled : null]}
                                  onChangeText={(value) =>
                                    setApprovalSelectionsByAssignee((current) =>
                                      updateApprovalAssigneeCoins(current, assigneeId, Number(value) || 0),
                                    )
                                  }
                                />
                              </View>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                      <View style={styles.modalActions}>
                        <Button label={t("common.actions.cancel")} variant="secondary" onPress={closeApproveModal} disabled={Boolean(busyId)} />
                        <Button
                          label={busyId === pendingApproveChore.id ? t("common.actions.loading") : t("dashboard.completeAndApprove")}
                          onPress={() => void completeAndApproveChore()}
                          disabled={Boolean(busyId)}
                        />
                      </View>
                    </>
                  );
                })()}
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
      <MobileChoreEditorModal
        open={addOpen}
        mode="create"
        members={members}
        categories={categories}
        defaultAssigneeIds={selectedMember ? [selectedMember.id] : undefined}
        saving={createSaving}
        onClose={() => setAddOpen(false)}
        onSubmit={addChore}
        viewerKey={preferencesViewerKeyRef.current || "default"}
      />
      <MobileChoreEditorModal
        open={editOpen}
        mode="edit"
        members={members}
        categories={categories}
        chore={editingChore}
        loading={editLoading}
        saving={editSaving}
        onClose={closeEditModal}
        onSubmit={saveEditedChore}
        viewerKey={preferencesViewerKeyRef.current || "default"}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  toolbar: { gap: spacing.sm },
  filterRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  toolbarDivider: { height: 1, backgroundColor: colors.line },
  scopeGroup: { flex: 1, flexDirection: "row", alignItems: "stretch" },
  scopeButton: { minHeight: 48, flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: 1, borderColor: colors.line, borderTopLeftRadius: radius.md, borderBottomLeftRadius: radius.md, paddingHorizontal: spacing.sm, backgroundColor: "#fff" },
  scopeMenuButton: {
    width: 48,
    minHeight: 48,
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: colors.line,
    borderTopRightRadius: radius.md,
    borderBottomRightRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  scopeText: { flex: 1, color: colors.text, fontSize: typography.body, fontWeight: "800" },
  plusIcon: { width: 12, height: 12, position: "relative" },
  plusIconStroke: { position: "absolute", borderRadius: 999 },
  plusIconHorizontal: { left: 0, right: 0, top: 5, height: 2 },
  plusIconVertical: { top: 0, bottom: 0, left: 5, width: 2 },
  hamburgerIcon: { width: 18, gap: 3 },
  hamburgerIconBar: { height: 2, width: 18, borderRadius: 999 },
  hamburgerIconBarMedium: { width: 14 },
  hamburgerIconBarShort: { width: 10 },
  sortIcon: { width: 18, gap: 3 },
  sortIconBar: { height: 2, width: 18, borderRadius: 999 },
  sortIconBarMedium: { width: 14 },
  sortIconBarShort: { width: 10 },
  tableIcon: { width: 16, height: 16, position: "relative", alignItems: "center", justifyContent: "center" },
  tableIconFrame: {
    position: "absolute",
    inset: 1,
    borderWidth: 1.5,
    borderRadius: 3,
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "stretch",
    overflow: "hidden",
  },
  tableIconColumn: { width: 1, opacity: 0.45 },
  tableIconRow: { position: "absolute", left: 3, right: 3, top: 6, height: 1.5, opacity: 0.45 },
  tableIconRowBottom: { top: 10 },
  list: { gap: spacing.sm },
  choreCard: { gap: spacing.sm, borderWidth: 1, borderLeftWidth: 5, borderColor: colors.line, borderLeftColor: colors.brand, borderRadius: radius.lg, padding: spacing.sm, backgroundColor: "#fff" },
  choreTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  choreCopy: { flex: 1, gap: 3 },
  choreTitle: { color: colors.text, fontSize: typography.body, fontWeight: "900" },
  choreAssignee: { color: colors.muted, fontSize: typography.small, fontWeight: "700" },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  cardActions: { gap: spacing.xs },
  actionGroup: { flexDirection: "row", alignItems: "stretch" },
  completeButton: {
    minHeight: 44,
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  completeButtonGrouped: {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  completeButtonText: { color: "#fff", fontWeight: "800", fontSize: typography.body },
  menuButton: {
    minWidth: 46,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderTopRightRadius: radius.md,
    borderBottomRightRadius: radius.md,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -1,
  },
  menuButtonText: { color: colors.brandStrong, fontWeight: "900", fontSize: 18 },
  actionPressed: { transform: [{ scale: 0.98 }] },
  actionDisabled: { opacity: 0.6 },
  avatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImage: { width: "100%", height: "100%" },
  avatarText: { color: "#fff", fontWeight: "900", fontSize: typography.small },
  familyAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.accentSoft,
    position: "relative",
    overflow: "hidden",
  },
  familyAvatarHeadLeft: {
    position: "absolute",
    width: 9,
    height: 9,
    borderRadius: 4.5,
    left: 7,
    top: 7,
    backgroundColor: colors.brandStrong,
  },
  familyAvatarHeadRight: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    right: 7,
    top: 8,
    backgroundColor: colors.brandStrong,
    opacity: 0.9,
  },
  familyAvatarBodyLeft: {
    position: "absolute",
    width: 14,
    height: 8,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    left: 4,
    bottom: 7,
    backgroundColor: colors.brandStrong,
  },
  familyAvatarBodyRight: {
    position: "absolute",
    width: 11,
    height: 7,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    right: 4,
    bottom: 7,
    backgroundColor: colors.brandStrong,
    opacity: 0.9,
  },
  backdrop: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.28)", justifyContent: "center", padding: spacing.lg },
  sheet: { gap: spacing.sm, borderRadius: radius.lg, backgroundColor: "#fff", padding: spacing.md },
  scopeOption: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: "#fff",
  },
  scopeOptionText: { flex: 1, color: colors.text, fontSize: typography.body, fontWeight: "800" },
  sheetDivider: { height: 1, backgroundColor: colors.line, marginVertical: spacing.xs },
  sheetTitle: { color: colors.text, fontSize: typography.h3, fontWeight: "900" },
  confirmText: { color: colors.muted, fontSize: typography.body, fontWeight: "700" },
  confirmTextStrong: { color: colors.text, fontWeight: "900" },
  approvalList: { maxHeight: 320 },
  approvalListContent: { gap: spacing.sm },
  approvalRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  approvalRowDisabled: {
    backgroundColor: "#f8fafc",
    borderColor: "#dbe4ef",
  },
  approvalIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  approvalCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  approvalCheckboxChecked: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  approvalCheckboxMark: { color: "#fff", fontSize: typography.small, fontWeight: "900" },
  approvalAvatarDisabled: { opacity: 0.45 },
  approvalName: { flex: 1, color: colors.text, fontSize: typography.body, fontWeight: "800" },
  approvalNameDisabled: { color: colors.muted, textDecorationLine: "line-through" },
  approvalAmountWrap: { width: 84, position: "relative", justifyContent: "center" },
  approvalCoinPrefix: {
    position: "absolute",
    left: 10,
    zIndex: 1,
    color: "#b45309",
    fontSize: typography.small,
    fontWeight: "900",
  },
  approvalAmountInput: {
    height: 42,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    color: colors.text,
    paddingLeft: 26,
    paddingRight: spacing.sm,
    textAlign: "right",
    fontSize: typography.body,
    fontWeight: "800",
  },
  approvalAmountInputDisabled: {
    backgroundColor: "#e2e8f0",
    color: colors.muted,
  },
  modalActions: { flexDirection: "row", gap: spacing.sm },
  celebration: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255, 255, 255, 0.55)" },
  celebrationText: { color: colors.brandStrong, fontSize: 32, fontWeight: "900" },
});
