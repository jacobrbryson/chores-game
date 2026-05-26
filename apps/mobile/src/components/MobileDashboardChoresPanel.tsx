import React, { useEffect, useMemo, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  getDashboardChorePage,
  sortDashboardChores,
  type DashboardSortDirection,
  type DashboardSortKey,
} from "@packages/core/src/chore-dashboard";
import {
  apiClient,
  deleteMobileChore,
  fetchMobileFamilySummary,
  patchMobileChore,
  reorderMobileChores,
  type MobileFamilyChore,
  type MobileFamilyMember,
} from "@/lib/api";
import { colors, radius, spacing, typography } from "@/theme";
import { Badge, Button, Card, CoinPill, EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/ui";

const PAGE_SIZE = 10;

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

export function MobileDashboardChoresPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [members, setMembers] = useState<MobileFamilyMember[]>([]);
  const [chores, setChores] = useState<MobileFamilyChore[]>([]);
  const [viewerRole, setViewerRole] = useState<"admin" | "player">("player");
  const [viewerAliases, setViewerAliases] = useState<string[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [sortKey, setSortKey] = useState<DashboardSortKey>("manual");
  const [sortDirection, setSortDirection] = useState<DashboardSortDirection>("asc");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newChoreTitle, setNewChoreTitle] = useState("");
  const [busyId, setBusyId] = useState("");
  const [celebrating, setCelebrating] = useState(false);

  async function load() {
    setError("");
    setLoading(true);
    try {
      const summary = await fetchMobileFamilySummary();
      const activeMembers = summary.members.filter((member) => member.status === "active");
      const viewer =
        activeMembers.find((member) => member.uid === summary.viewerUid || member.id === summary.viewerUid) ??
        activeMembers[0] ??
        null;
      setMembers(activeMembers);
      setChores(summary.choresToday.filter((chore) => chore.status === "Open"));
      setViewerRole(viewer?.role ?? "player");
      setViewerAliases(summary.viewerAssigneeAliases?.length ? summary.viewerAssigneeAliases : viewer ? memberAliases(viewer) : []);
      setSelectedMemberId((current) => current || viewer?.id || "family");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "family_summary_unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

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

  async function completeChore(chore: MobileFamilyChore) {
    if (busyId) return;
    setBusyId(chore.id);
    setCelebrating(true);
    setTimeout(() => setCelebrating(false), 900);
    setChores((current) => current.filter((item) => item.id !== chore.id));
    try {
      await patchMobileChore(chore.id, { action: "complete" });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "complete_chore_failed");
      await load();
    } finally {
      setBusyId("");
    }
  }

  async function addChore() {
    const title = newChoreTitle.trim();
    if (!title) return;
    setError("");
    try {
      await apiClient.chores.create({ description: title });
      setNewChoreTitle("");
      setAddOpen(false);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "create_chore_failed");
    }
  }

  async function deleteChore(chore: MobileFamilyChore) {
    setError("");
    setChores((current) => current.filter((item) => item.id !== chore.id));
    try {
      await deleteMobileChore(chore.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "delete_chore_failed");
      await load();
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

  if (loading) return <LoadingState label="Loading dashboard..." />;
  if (error && chores.length === 0) return <ErrorState message={`Could not load chores: ${error}`} />;

  return (
    <Card>
      <View style={styles.toolbar}>
        <Pressable style={styles.scopeButton} onPress={() => setScopeOpen(true)}>
          {selectedMember ? (
            <Avatar
              name={selectedMember.name}
              imageUrl={avatarUrl(selectedMember.avatarId, selectedMember.avatarPhotoUrl)}
              color={selectedMember.dashboardPrimaryColor}
            />
          ) : null}
          <Text style={styles.scopeText} numberOfLines={1}>{selectedMember?.name ?? "Family"}</Text>
          {selectedMember?.stats?.currentCoins !== undefined ? <CoinPill value={selectedMember.stats.currentCoins} /> : null}
        </Pressable>
        <View style={styles.actions}>
          <Button label="Sort" variant="secondary" onPress={() => setSortOpen(true)} />
          <Button label="+" onPress={() => setAddOpen(true)} />
        </View>
      </View>
      <SectionHeader title="Dashboard Chores" />
      {error ? <ErrorState message={error} /> : null}
      {chorePage.visibleItems.length === 0 ? (
        <EmptyState message={selectedMember ? `No chores assigned to ${selectedMember.name} right now.` : "No open chores right now."} />
      ) : (
        <View style={styles.list}>
          {chorePage.visibleItems.map((chore, index) => {
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
                  <CoinPill value={chore.choreType === "see_and_do" ? "-" : chore.coinValue ?? 0} />
                </View>
                <View style={styles.cardActions}>
                  <Button label={busyId === chore.id ? "Marking..." : "Mark as Complete"} disabled={!canComplete || busyId === chore.id} onPress={() => void completeChore(chore)} />
                  {viewerRole === "admin" ? (
                    <View style={styles.adminActions}>
                      <Button label="Up" variant="secondary" disabled={sortKey !== "manual" || index === 0} onPress={() => void moveChore(chore, -1)} />
                      <Button label="Down" variant="secondary" disabled={sortKey !== "manual" || index === filteredChores.length - 1} onPress={() => void moveChore(chore, 1)} />
                      <Button label="Delete" variant="danger" onPress={() => void deleteChore(chore)} />
                    </View>
                  ) : null}
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
            <Button label="Family" variant="secondary" onPress={() => { setSelectedMemberId("family"); setScopeOpen(false); }} />
            {members.map((member) => (
              <Button key={member.id} label={member.name} variant="secondary" onPress={() => { setSelectedMemberId(member.id); setScopeOpen(false); }} />
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
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Add Chore</Text>
            <TextInput
              value={newChoreTitle}
              onChangeText={setNewChoreTitle}
              placeholder="Description"
              style={styles.input}
            />
            <Button label="Add Chore" onPress={() => void addChore()} />
            <Button label="Cancel" variant="secondary" onPress={() => setAddOpen(false)} />
          </View>
        </View>
      </Modal>
    </Card>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  scopeButton: { minHeight: 48, flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: spacing.sm, backgroundColor: "#fff" },
  scopeText: { flex: 1, color: colors.text, fontSize: typography.body, fontWeight: "800" },
  actions: { flexDirection: "row", gap: spacing.xs },
  list: { gap: spacing.sm },
  choreCard: { gap: spacing.sm, borderWidth: 1, borderLeftWidth: 5, borderColor: colors.line, borderLeftColor: colors.brand, borderRadius: radius.lg, padding: spacing.sm, backgroundColor: "#fff" },
  choreTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  choreCopy: { flex: 1, gap: 3 },
  choreTitle: { color: colors.text, fontSize: typography.body, fontWeight: "900" },
  choreAssignee: { color: colors.muted, fontSize: typography.small, fontWeight: "700" },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  cardActions: { gap: spacing.xs },
  adminActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  avatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImage: { width: "100%", height: "100%" },
  avatarText: { color: "#fff", fontWeight: "900", fontSize: typography.small },
  backdrop: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.28)", justifyContent: "center", padding: spacing.lg },
  sheet: { gap: spacing.sm, borderRadius: radius.lg, backgroundColor: "#fff", padding: spacing.md },
  sheetTitle: { color: colors.text, fontSize: typography.h3, fontWeight: "900" },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: spacing.sm, color: colors.text, backgroundColor: "#fff" },
  celebration: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255, 255, 255, 0.55)" },
  celebrationText: { color: colors.brandStrong, fontSize: 32, fontWeight: "900" },
});
