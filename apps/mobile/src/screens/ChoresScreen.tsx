import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  apiFetch,
  appBaseUrl,
  deleteMobileChore,
  editMobileChore,
  fetchMobileChore,
  fetchMobileFamilySummary,
  patchMobileChore,
  type MobileChoreDetail,
  type MobileFamilyCategory,
  type MobileFamilyMember,
} from "@/lib/api";
import { MobileChoreEditorModal, type MobileChoreEditorSubmitPayload } from "@/components/MobileChoreEditorModal";
import { loadAllChoresPreferences, saveAllChoresPreferences } from "@/lib/mobile-preferences";
import { colors, radius, spacing, typography } from "@/theme";
import {
  AppScreen,
  AvatarBadge,
  Badge,
  Button,
  Card,
  ChipOverflowRow,
  CoinPill,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui";

type ChoreCategory = {
  id: string;
  name: string;
  color: string;
};

type ChoreRow = {
  id: string;
  title: string;
  status: string;
  assigneeName?: string;
  assigneePrimaryColor?: string;
  assigneeAvatarId?: string;
  assigneeAvatarPhotoUrl?: string;
  dueDate?: string;
  completedAt?: string;
  coinValue?: number;
  requireApproval?: boolean;
  choreType?: string;
  categories?: ChoreCategory[];
};

type ChoreSortBy = "title" | "status" | "assigneeName" | "dueDate" | "completedAt" | "coinValue";
type StatusFilter = "" | "needs_approval" | "completed";

type ChoresResponse = {
  items?: ChoreRow[];
  chores?: ChoreRow[];
  viewerRole?: "admin" | "player";
  pagination?: {
    page?: number;
    total?: number;
    totalPages?: number;
  };
};

type Props = {
  right?: React.ReactNode;
  onGoDashboard?: () => void;
};

const PAGE_SIZE = 20;

const SORT_OPTIONS: Array<{ value: ChoreSortBy; label: string }> = [
  { value: "completedAt", label: "Completed" },
  { value: "title", label: "Title" },
  { value: "status", label: "Status" },
  { value: "assigneeName", label: "Assignee" },
  { value: "dueDate", label: "Due" },
  { value: "coinValue", label: "Coins" },
];

function avatarUrl(avatarId?: string, avatarPhotoUrl?: string) {
  if (avatarPhotoUrl) return avatarPhotoUrl;
  if (!avatarId) return "";
  return `${appBaseUrl}/avatars/default/${encodeURIComponent(avatarId)}`;
}

function getStatusTone(status: string) {
  if (status === "Submitted") return "warning";
  if (status === "Approved") return "success";
  if (status === "Rejected") return "danger";
  return "default";
}

function getStatusLabel(chore: Pick<ChoreRow, "status" | "requireApproval">) {
  if (chore.status === "Submitted" && chore.requireApproval) return "Awaiting Approval";
  if (chore.status === "Submitted" || chore.status === "Approved") return "Completed";
  return chore.status || "Open";
}

function formatCompletedDate(value?: string) {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "-";
  return new Date(parsed).toLocaleDateString();
}

function getDisplayedCoinValue(chore: Pick<ChoreRow, "choreType" | "status" | "coinValue">) {
  if (chore.choreType === "see_and_do" && chore.status !== "Approved") return "-";
  return String(chore.coinValue ?? 0);
}

function canApproveChore(chore: Pick<ChoreRow, "status" | "requireApproval">) {
  return chore.status === "Submitted" && Boolean(chore.requireApproval);
}

function canUndoCompletion(status: string) {
  return status === "Submitted" || status === "Approved";
}

function sortLabel(activeSortBy: ChoreSortBy, activeSortDir: "asc" | "desc", column: ChoreSortBy, label: string) {
  if (activeSortBy !== column) return label;
  return `${label} ${activeSortDir === "asc" ? "^" : "v"}`;
}

function buildQuery(params: Record<string, string>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) searchParams.set(key, value);
  }
  return searchParams.toString();
}

export function ChoresScreen({ right, onGoDashboard }: Props) {
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesViewerKey, setPreferencesViewerKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionBusyId, setActionBusyId] = useState("");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [items, setItems] = useState<ChoreRow[]>([]);
  const [members, setMembers] = useState<MobileFamilyMember[]>([]);
  const [categories, setCategories] = useState<MobileFamilyCategory[]>([]);
  const [viewerRole, setViewerRole] = useState<"admin" | "player">("player");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [sortBy, setSortBy] = useState<ChoreSortBy>("completedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [expandedChoreId, setExpandedChoreId] = useState("");
  const [menuChoreId, setMenuChoreId] = useState("");
  const [pendingDeleteChore, setPendingDeleteChore] = useState<ChoreRow | null>(null);
  const [pendingRejectChore, setPendingRejectChore] = useState<ChoreRow | null>(null);
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editingChore, setEditingChore] = useState<MobileChoreDetail | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const requestPath = useMemo(() => {
    const trimmedQuery = query.trim();
    const params = buildQuery({
      page: String(page),
      limit: String(PAGE_SIZE),
      sortBy,
      sortDir,
      q: trimmedQuery.length >= 3 ? trimmedQuery : "",
      status: statusFilter,
      tzOffsetMinutes: String(new Date().getTimezoneOffset()),
    });
    return `/chores?${params}`;
  }, [page, query, sortBy, sortDir, statusFilter]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const summary = await fetchMobileFamilySummary();
        const viewerKey = summary.viewerUid || "default";
        const preferences = await loadAllChoresPreferences(viewerKey);
        if (cancelled) {
          return;
        }
        setMembers(Array.isArray(summary.members) ? summary.members : []);
        setCategories(Array.isArray(summary.categories) ? summary.categories : []);
        setPreferencesViewerKey(viewerKey);
        setSearchInput(preferences.searchQuery);
        setQuery(preferences.searchQuery.trim());
        setStatusFilter(preferences.statusFilter);
        setSortBy(preferences.sortBy);
        setSortDir(preferences.sortDir);
        setFiltersExpanded(preferences.filtersExpanded);
      } catch {
        if (cancelled) {
          return;
        }
        setPreferencesViewerKey("default");
      } finally {
        if (!cancelled) {
          setPreferencesReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!preferencesReady) {
      return;
    }
    const timeout = setTimeout(() => {
      setPage(1);
      setQuery(searchInput.trim());
    }, 300);
    return () => clearTimeout(timeout);
  }, [preferencesReady, searchInput]);

  useEffect(() => {
    if (!preferencesReady || !preferencesViewerKey) {
      return;
    }
    void saveAllChoresPreferences(preferencesViewerKey, {
      filtersExpanded,
      searchQuery: searchInput,
      sortBy,
      sortDir,
      statusFilter,
    });
  }, [filtersExpanded, preferencesReady, preferencesViewerKey, searchInput, sortBy, sortDir, statusFilter]);

  useEffect(() => {
    if (!actionError) {
      return;
    }
    const timeout = setTimeout(() => {
      setActionError("");
    }, 5000);
    return () => clearTimeout(timeout);
  }, [actionError]);

  useEffect(() => {
    if (!preferencesReady) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");

    void apiFetch(requestPath)
      .then((response) => {
        if (cancelled) return;
        const typed = response as ChoresResponse;
        const nextItems = Array.isArray(typed.items)
          ? typed.items
          : Array.isArray(typed.chores)
            ? typed.chores
            : [];
        setItems(nextItems);
        setViewerRole(typed.viewerRole === "admin" ? "admin" : "player");
        setTotal(typeof typed.pagination?.total === "number" ? typed.pagination.total : nextItems.length);
        setTotalPages(typeof typed.pagination?.totalPages === "number" ? Math.max(1, typed.pagination.totalPages) : 1);
        setPage(typeof typed.pagination?.page === "number" ? Math.max(1, typed.pagination.page) : page);
      })
      .catch((nextError: unknown) => {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : "Failed to load chores");
        setItems([]);
        setTotal(0);
        setTotalPages(1);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, preferencesReady, requestPath]);

  function onSort(column: ChoreSortBy) {
    setPage(1);
    setSortDir((currentDir) =>
      sortBy === column ? (currentDir === "asc" ? "desc" : "asc") : column === "completedAt" ? "desc" : "asc",
    );
    setSortBy(column);
  }

  function onStatusFilter(nextStatus: StatusFilter) {
    setPage(1);
    setStatusFilter(nextStatus);
  }

  const filterChipItems = useMemo(() => {
    const items = [
      {
        id: "all",
        label: "All",
        active: statusFilter === "",
        onPress: () => onStatusFilter(""),
      },
    ];

    if (viewerRole === "admin") {
      items.push({
        id: "needs_approval",
        label: "Needs Approval",
        active: statusFilter === "needs_approval",
        onPress: () => onStatusFilter("needs_approval"),
      });
    }

    items.push({
      id: "completed",
      label: "Completed",
      active: statusFilter === "completed",
      onPress: () => onStatusFilter("completed"),
    });

    return items;
  }, [statusFilter, viewerRole]);

  const sortChipItems = useMemo(
    () =>
      SORT_OPTIONS.map((option) => ({
        id: option.value,
        label: sortLabel(sortBy, sortDir, option.value, option.label),
        active: sortBy === option.value,
        onPress: () => onSort(option.value),
      })),
    [sortBy, sortDir],
  );

  async function approveChore(choreId: string) {
    if (actionBusyId) return;
    setActionBusyId(choreId);
    setActionError("");
    try {
      await apiFetch(`/chores/${encodeURIComponent(choreId)}/approve`, { method: "POST" });
      const response = (await apiFetch(requestPath)) as ChoresResponse;
      const nextItems = Array.isArray(response.items)
        ? response.items
        : Array.isArray(response.chores)
          ? response.chores
          : [];
      setItems(nextItems);
      setTotal(typeof response.pagination?.total === "number" ? response.pagination.total : nextItems.length);
      setTotalPages(typeof response.pagination?.totalPages === "number" ? Math.max(1, response.pagination.totalPages) : 1);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : "approve_chore_failed");
    } finally {
      setActionBusyId("");
    }
  }

  async function undoCompletion(choreId: string) {
    if (actionBusyId) return;
    setActionBusyId(choreId);
    setActionError("");
    try {
      await patchMobileChore(choreId, { action: "undo_complete" });
      const response = (await apiFetch(requestPath)) as ChoresResponse;
      const nextItems = Array.isArray(response.items)
        ? response.items
        : Array.isArray(response.chores)
          ? response.chores
          : [];
      setItems(nextItems);
      setTotal(typeof response.pagination?.total === "number" ? response.pagination.total : nextItems.length);
      setTotalPages(typeof response.pagination?.totalPages === "number" ? Math.max(1, response.pagination.totalPages) : 1);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : "undo_complete_failed");
    } finally {
      setActionBusyId("");
    }
  }

  async function rejectChore(choreId: string, feedback: string) {
    if (actionBusyId) return false;
    setActionBusyId(choreId);
    setActionError("");
    try {
      await patchMobileChore(choreId, { action: "reject", feedback });
      const response = (await apiFetch(requestPath)) as ChoresResponse;
      const nextItems = Array.isArray(response.items)
        ? response.items
        : Array.isArray(response.chores)
          ? response.chores
          : [];
      setItems(nextItems);
      setTotal(typeof response.pagination?.total === "number" ? response.pagination.total : nextItems.length);
      setTotalPages(typeof response.pagination?.totalPages === "number" ? Math.max(1, response.pagination.totalPages) : 1);
      return true;
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : "reject_chore_failed");
      return false;
    } finally {
      setActionBusyId("");
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
    try {
      const detail = await fetchMobileChore(choreId);
      setEditingChore(detail);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : "fetch_chore_failed");
      closeEditModal();
    } finally {
      setEditLoading(false);
    }
  }

  async function saveEditedChore(payload: MobileChoreEditorSubmitPayload) {
    if (!editingChore || editSaving) {
      return;
    }
    setEditSaving(true);
    setActionError("");
    try {
      await editMobileChore(editingChore.id, { action: "edit", ...payload });
      const response = (await apiFetch(requestPath)) as ChoresResponse;
      const nextItems = Array.isArray(response.items)
        ? response.items
        : Array.isArray(response.chores)
          ? response.chores
          : [];
      setItems(nextItems);
      closeEditModal();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "edit_chore_failed";
      setActionError(message);
      throw nextError instanceof Error ? nextError : new Error(message);
    } finally {
      setEditSaving(false);
    }
  }

  async function removeChore(chore: ChoreRow) {
    if (actionBusyId) {
      return;
    }
    setActionBusyId(chore.id);
    setActionError("");
    try {
      await deleteMobileChore(chore.id);
      const response = (await apiFetch(requestPath)) as ChoresResponse;
      const nextItems = Array.isArray(response.items)
        ? response.items
        : Array.isArray(response.chores)
          ? response.chores
          : [];
      setItems(nextItems);
      setTotal(typeof response.pagination?.total === "number" ? response.pagination.total : nextItems.length);
      setTotalPages(typeof response.pagination?.totalPages === "number" ? Math.max(1, response.pagination.totalPages) : 1);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : "delete_chore_failed");
    } finally {
      setActionBusyId("");
    }
  }

  return (
    <AppScreen title="All Chores" subtitle="Sort, filter, and approve chores" right={right} onPressBreadcrumbRoot={onGoDashboard}>
      <Card style={styles.controlsCard}>
        <View style={styles.searchRow}>
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Search chores (3+ chars)"
            placeholderTextColor={colors.muted}
            style={[styles.searchInput, styles.searchInputExpanded]}
          />
          <Button
            label={filtersExpanded ? "v" : ">"}
            variant="secondary"
            onPress={() => setFiltersExpanded((current) => !current)}
          />
        </View>
        {filtersExpanded ? (
          <>
            <View style={styles.optionRow}>
              <Text style={styles.sectionLabel}>Filters</Text>
              <ChipOverflowRow items={filterChipItems} />
            </View>
            <View style={styles.optionRow}>
              <Text style={styles.sectionLabel}>Sorting</Text>
              <ChipOverflowRow items={sortChipItems} />
            </View>
          </>
        ) : null}
      </Card>

      {loading ? <LoadingState label="Loading chores..." /> : null}
      {error ? <ErrorState message={`Could not load chores: ${error}`} /> : null}
      {actionError ? <ErrorState message={`Chore update failed: ${actionError}`} /> : null}

      {!loading && !error ? (
        <>
          {items.length === 0 ? (
            <Card>
              <EmptyState message="No chores found." />
            </Card>
          ) : (
            <Card style={styles.listCard}>
              <View style={styles.listHeader}>
                <Text style={styles.summaryText}>{total} chore{total === 1 ? "" : "s"}</Text>
                {statusFilter === "needs_approval" ? <Badge label="Approval queue" tone="warning" /> : null}
              </View>
              <View style={styles.list}>
                {items.map((item) => {
                  const needsApproval = item.status === "Submitted" && Boolean(item.requireApproval);
                  const expanded = expandedChoreId === item.id;
                  return (
                    <View key={item.id} style={[styles.choreCard, needsApproval ? styles.approvalCard : null]}>
                      <View style={styles.choreRow}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${expanded ? "Hide" : "Show"} details for ${item.title}`}
                          onPress={() => setExpandedChoreId((current) => (current === item.id ? "" : item.id))}
                          style={({ pressed }) => [styles.choreSummaryButton, pressed ? styles.actionPressed : null]}>
                          <AvatarBadge
                            name={item.assigneeName || "Assignee"}
                            imageUrl={avatarUrl(item.assigneeAvatarId, item.assigneeAvatarPhotoUrl)}
                            color={item.assigneePrimaryColor}
                            size={40}
                          />
                          <View style={styles.choreSummaryCopy}>
                            <View style={styles.choreSummaryTitleRow}>
                              <Text style={styles.titleText} numberOfLines={1}>{item.title}</Text>
                              <Badge label={getStatusLabel(item)} tone={getStatusTone(item.status)} />
                            </View>
                            <View style={styles.choreSummaryMetaRow}>
                              <View style={styles.coinsInline}>
                                {getDisplayedCoinValue(item) === "-" ? <Text style={styles.summaryMetaText}>-</Text> : <CoinPill value={item.coinValue ?? 0} />}
                              </View>
                              <Text style={styles.summaryMetaText}>{expanded ? "Hide details" : "Show details"}</Text>
                            </View>
                          </View>
                          <Text style={styles.chevron}>{expanded ? "v" : ">"}</Text>
                        </Pressable>
                        {viewerRole === "admin" ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Chore options"
                            disabled={Boolean(actionBusyId)}
                            onPress={() => setMenuChoreId(item.id)}
                            style={({ pressed }) => [
                              styles.menuButton,
                              Boolean(actionBusyId) && styles.actionDisabled,
                              pressed && !actionBusyId ? styles.actionPressed : null,
                            ]}>
                            <Text style={styles.menuButtonText}>☰</Text>
                          </Pressable>
                        ) : null}
                      </View>
                      {expanded ? (
                        <View style={styles.expandedSection}>
                          <View style={styles.detailGrid}>
                            <DetailTile label="Assignee" value={item.assigneeName || "-"} />
                            <DetailTile label="Due" value={item.dueDate || "-"} />
                            <DetailTile label="Completed" value={formatCompletedDate(item.completedAt)} />
                            <DetailTile
                              label="Categories"
                              value={(item.categories ?? []).length > 0 ? (item.categories ?? []).map((category) => category.name).join(", ") : "None"}
                            />
                          </View>
                          {viewerRole === "admin" && needsApproval ? (
                            <View style={styles.approvalActions}>
                              <Button
                                label={actionBusyId === item.id ? "Approving..." : "Approve"}
                                disabled={Boolean(actionBusyId)}
                                variant="success"
                                onPress={() => void approveChore(item.id)}
                              />
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
              <View style={styles.pager}>
                <Button label="Previous" variant="secondary" disabled={page <= 1} onPress={() => setPage((current) => Math.max(1, current - 1))} />
                <Text style={styles.pagerText}>Page {page} of {totalPages}</Text>
                <Button label="Next" variant="secondary" disabled={page >= totalPages} onPress={() => setPage((current) => Math.min(totalPages, current + 1))} />
              </View>
            </Card>
          )}
        </>
      ) : null}
      <Modal visible={Boolean(menuChoreId)} transparent animationType="fade" onRequestClose={() => setMenuChoreId("")}>
        <Pressable style={styles.backdrop} onPress={() => setMenuChoreId("")}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{items.find((item) => item.id === menuChoreId)?.title ?? "Chore options"}</Text>
            <Button
              label={actionBusyId === menuChoreId ? "Approving..." : "Approve"}
              variant="success"
              disabled={
                !canApproveChore(items.find((item) => item.id === menuChoreId) ?? { status: "", requireApproval: false }) ||
                actionBusyId === menuChoreId
              }
              onPress={() => {
                const chore = items.find((item) => item.id === menuChoreId);
                setMenuChoreId("");
                if (chore) {
                  void approveChore(chore.id);
                }
              }}
            />
            <Button
              label={actionBusyId === menuChoreId ? "Rejecting..." : "Reject"}
              variant="secondary"
              disabled={
                !canApproveChore(items.find((item) => item.id === menuChoreId) ?? { status: "", requireApproval: false }) ||
                actionBusyId === menuChoreId
              }
              onPress={() => {
                const chore = items.find((item) => item.id === menuChoreId) ?? null;
                setMenuChoreId("");
                setRejectFeedback("");
                setPendingRejectChore(chore);
              }}
            />
            <Button
              label={actionBusyId === menuChoreId ? "Undoing..." : "Undo completion"}
              variant="secondary"
              disabled={!canUndoCompletion(items.find((item) => item.id === menuChoreId)?.status ?? "") || actionBusyId === menuChoreId}
              onPress={() => {
                const chore = items.find((item) => item.id === menuChoreId);
                setMenuChoreId("");
                if (chore) {
                  void undoCompletion(chore.id);
                }
              }}
            />
            <Button label="Edit" variant="secondary" onPress={() => void openEditModal(menuChoreId)} />
            <Button
              label={actionBusyId === menuChoreId ? "Deleting..." : "Delete"}
              variant="danger"
              disabled={actionBusyId === menuChoreId}
              onPress={() => {
                const chore = items.find((item) => item.id === menuChoreId) ?? null;
                setMenuChoreId("");
                if (chore) {
                  setPendingDeleteChore(chore);
                }
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={Boolean(pendingRejectChore)} transparent animationType="fade" onRequestClose={() => setPendingRejectChore(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPendingRejectChore(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Reject Chore</Text>
            <Text style={styles.confirmText}>
              Reject <Text style={styles.confirmTextStrong}>{pendingRejectChore?.title ?? "this chore"}</Text>? Feedback is optional.
            </Text>
            <TextInput
              value={rejectFeedback}
              onChangeText={setRejectFeedback}
              placeholder="Tell them what needs to be fixed..."
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              style={[styles.searchInput, styles.rejectInput]}
            />
            <Button label="Cancel" variant="secondary" onPress={() => setPendingRejectChore(null)} />
            <Button
              label={actionBusyId === pendingRejectChore?.id ? "Rejecting..." : "Reject"}
              variant="danger"
              disabled={actionBusyId === pendingRejectChore?.id}
              onPress={async () => {
                const chore = pendingRejectChore;
                if (!chore) {
                  return;
                }
                const rejected = await rejectChore(chore.id, rejectFeedback);
                if (rejected) {
                  setPendingRejectChore(null);
                  setRejectFeedback("");
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
              label={actionBusyId === pendingDeleteChore?.id ? "Deleting..." : "Delete"}
              variant="danger"
              disabled={actionBusyId === pendingDeleteChore?.id}
              onPress={() => {
                const chore = pendingDeleteChore;
                setPendingDeleteChore(null);
                if (chore) {
                  void removeChore(chore);
                }
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
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
      />
    </AppScreen>
  );
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailTile}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  controlsCard: {
    gap: spacing.md,
    zIndex: 30,
    elevation: 30,
    overflow: "visible",
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  searchInput: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "700",
  },
  searchInputExpanded: { flex: 1 },
  optionRow: { gap: spacing.sm, zIndex: 31, overflow: "visible" },
  sectionLabel: {
    color: colors.muted,
    fontSize: typography.tiny,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  summaryText: { color: colors.muted, fontSize: typography.small, fontWeight: "900" },
  listCard: { gap: spacing.md },
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  list: { gap: spacing.sm },
  choreCard: { gap: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, backgroundColor: "#fff", paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  approvalCard: { borderColor: "#fcd34d", backgroundColor: "#fffbeb" },
  choreRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  choreSummaryButton: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  choreSummaryCopy: { flex: 1, gap: spacing.xs },
  choreSummaryTitleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
  choreSummaryMetaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  titleText: { color: colors.text, fontSize: typography.h3, fontWeight: "900" },
  summaryMetaText: { color: colors.muted, fontSize: typography.small, fontWeight: "700" },
  coinsInline: { minHeight: 24, justifyContent: "center" },
  chevron: { color: colors.muted, fontSize: 18, fontWeight: "900" },
  expandedSection: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm },
  detailGrid: { gap: spacing.sm },
  detailTile: {
    minHeight: 54,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: "center",
  },
  detailLabel: {
    color: colors.muted,
    fontSize: typography.tiny,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  detailValue: { marginTop: 2, color: colors.text, fontSize: typography.small, fontWeight: "800" },
  approvalActions: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#fcd34d",
    backgroundColor: "#fef3c7",
    padding: spacing.sm,
  },
  menuButton: {
    width: 42,
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  menuButtonText: { color: colors.brandStrong, fontWeight: "900", fontSize: 18 },
  actionPressed: { transform: [{ scale: 0.98 }] },
  actionDisabled: { opacity: 0.6 },
  pager: { marginTop: spacing.xs, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  pagerText: { flex: 1, textAlign: "center", color: colors.muted, fontSize: typography.small, fontWeight: "800" },
  backdrop: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.3)", justifyContent: "center", padding: spacing.lg },
  sheet: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: "#fff", padding: spacing.lg, gap: spacing.sm },
  sheetTitle: { color: colors.text, fontSize: typography.h3, fontWeight: "900" },
  confirmText: { color: colors.muted, fontSize: typography.body, fontWeight: "700" },
  confirmTextStrong: { color: colors.text, fontWeight: "900" },
  rejectInput: { minHeight: 110, paddingVertical: spacing.sm },
});
