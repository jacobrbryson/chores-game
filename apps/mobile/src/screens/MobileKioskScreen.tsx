import React from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { shouldHideChoreCoinValue } from "@packages/core";
import {
  completeMobileChore,
  fetchKioskStatus,
  fetchMobileFamilySummary,
  memberAvatarUrl,
  stopKiosk,
  switchKioskPlayer,
  type MobileFamilyChore,
  type MobileFamilyMember,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { collapseRoutineChores } from "@/lib/routine-chores";
import { connectFamilySocket, type FamilyActivityEvent } from "@/lib/ws";
import { MobileAllDoneCelebration } from "@/components/MobileAllDoneCelebration";
import { CONFETTI_DURATION_MS, MobileConfetti } from "@/components/MobileConfetti";
import { MobileRoutineProgressDialog } from "@/components/MobileRoutineProgressDialog";
import { AvatarBadge, Button, CoinPill } from "@/components/ui";
import { colors, radius, spacing, typography } from "@/theme";

type Props = {
  // The member id of the active kiosk player when the screen mounts. After that
  // the screen owns the active player locally so switching is instant.
  activeMemberId?: string;
  // Called after exiting Kiosk Mode so the host can refresh the session (which
  // clears kioskActive and returns to the signed-in account).
  onExited: () => void;
  // Called after switching the active player so the host session stays in sync.
  onSwitched: () => void;
};

type RosterMember = {
  id: string;
  name: string;
  avatarUrl: string;
  primaryColor: string;
};

function normalizeAlias(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function memberAliases(member: MobileFamilyMember) {
  return [member.id, member.uid, member.email].map(normalizeAlias).filter(Boolean);
}

// Family chores apply to everyone; otherwise match the active member's aliases.
function choreMatchesMember(chore: MobileFamilyChore, member: MobileFamilyMember) {
  if (chore.assigneeScope === "family") {
    return true;
  }
  const aliases = new Set(memberAliases(member));
  return (
    (chore.assigneeIds ?? []).some((id) => aliases.has(normalizeAlias(id))) ||
    Boolean(chore.assigneeId && aliases.has(normalizeAlias(chore.assigneeId)))
  );
}

function normalizePin(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

// Focused shared-tablet checklist — the mobile counterpart of the web
// /kiosk page (apps/web/src/components/kiosk-active-client.tsx). The whole
// family's today-chores are fetched once and filtered client-side so switching
// among the approved roster is instant. Permissions are always player-level
// (the session identity is the active player); this view never exposes parent
// controls and replaces the normal tabbed app while kiosk is active.
export function MobileKioskScreen({ activeMemberId, onExited, onSwitched }: Props) {
  const { t } = useMobileLocale();
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [actionError, setActionError] = React.useState("");
  const [members, setMembers] = React.useState<MobileFamilyMember[]>([]);
  const [roster, setRoster] = React.useState<RosterMember[]>([]);
  const [allChores, setAllChores] = React.useState<MobileFamilyChore[]>([]);
  const [coinsByMember, setCoinsByMember] = React.useState<Record<string, number>>({});
  const [realtime, setRealtime] = React.useState<{ authToken: string; familyId: string } | null>(null);
  const [activeId, setActiveId] = React.useState(activeMemberId ?? "");
  const [pinRequired, setPinRequired] = React.useState(false);
  const [switching, setSwitching] = React.useState(false);
  const [completedIds, setCompletedIds] = React.useState<Record<string, true>>({});
  const [pendingIds, setPendingIds] = React.useState<Record<string, true>>({});
  // Synchronous re-entrancy guard for completions. `pendingIds` is React state
  // and isn't flushed before a fast double-tap re-fires onPress, which would
  // submit the same chore twice (the second hits an already-completed chore and
  // the server returns invalid_status_transition). A ref updates immediately.
  const completingRef = React.useRef<Set<string>>(new Set());

  const [exitOpen, setExitOpen] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [pinPending, setPinPending] = React.useState(false);
  const [pinError, setPinError] = React.useState("");
  const [routineAssignmentId, setRoutineAssignmentId] = React.useState("");
  const [burstKey, setBurstKey] = React.useState(0);
  const [burstLabel, setBurstLabel] = React.useState("");
  const [celebrating, setCelebrating] = React.useState(false);
  const burstTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (burstTimer.current) {
        clearTimeout(burstTimer.current);
      }
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }
    },
    [],
  );

  function celebrate(label = "") {
    setBurstLabel(label);
    setBurstKey((key) => key + 1);
    setCelebrating(true);
    if (burstTimer.current) {
      clearTimeout(burstTimer.current);
    }
    burstTimer.current = setTimeout(() => setCelebrating(false), CONFETTI_DURATION_MS + 100);
  }

  // `background` refreshes (WS activity, the 30s tick, app foreground) update the
  // data silently: they must not toggle the full-screen spinner — that flashes
  // the whole list and, via the all-done effect below, re-fires the celebration
  // every refresh once a player is done.
  const load = React.useCallback(async (options?: { background?: boolean }) => {
    const background = options?.background ?? false;
    if (!background) {
      setLoading(true);
    }
    setLoadError("");
    try {
      const [status, summary] = await Promise.all([
        fetchKioskStatus(),
        fetchMobileFamilySummary(),
      ]);
      setPinRequired(status.pinRequired);
      const byId = new Map(summary.members.map((member) => [member.id, member]));
      const rosterMembers = status.playerIds
        .map((id) => {
          const member = byId.get(id);
          if (!member || member.role !== "player" || member.status !== "active") {
            return null;
          }
          return {
            id,
            name: member.name,
            avatarUrl: memberAvatarUrl(member),
            primaryColor: member.dashboardPrimaryColor ?? "",
          } satisfies RosterMember;
        })
        .filter((entry): entry is RosterMember => entry !== null);
      setMembers(summary.members);
      setRoster(rosterMembers);
      const openChores = summary.choresToday.filter((chore) => chore.status === "Open");
      setAllChores(openChores);
      // Self-heal optimistic completions: once a chore is no longer Open
      // server-side the completion landed, so drop its id. Chores still Open
      // stay hidden to bridge the gap until the next refresh reflects them.
      const openIds = new Set(openChores.map((chore) => chore.id));
      setCompletedIds((current) => {
        let changed = false;
        const next: Record<string, true> = {};
        for (const id of Object.keys(current)) {
          if (openIds.has(id)) {
            next[id] = true;
          } else {
            changed = true;
          }
        }
        return changed ? next : current;
      });
      setCoinsByMember(
        Object.fromEntries(summary.members.map((m) => [m.id, m.stats?.currentCoins ?? 0])),
      );
      const authToken = summary.wsAuthToken?.trim() ?? "";
      const familyId = summary.family?.id ?? "";
      if (authToken && familyId) {
        setRealtime((current) =>
          current?.authToken === authToken && current.familyId === familyId
            ? current
            : { authToken, familyId },
        );
      }
      const viewerMember = summary.members.find(
        (m) => m.uid === summary.viewerUid || m.id === summary.viewerUid,
      );
      setActiveId((current) => current || viewerMember?.id || rosterMembers[0]?.id || "");
    } catch (error) {
      // A failed background refresh keeps the cached kiosk state silently; only
      // the initial load surfaces an error.
      if (!background) {
        setLoadError(error instanceof Error ? error.message : "kiosk_chores_unavailable");
      }
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const scheduleRefresh = React.useCallback(() => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
    }
    refreshTimer.current = setTimeout(() => {
      void load({ background: true }).catch(() => {
        // Keep the cached kiosk state if a background refresh fails.
      });
    }, 120);
  }, [load]);

  React.useEffect(() => {
    if (!realtime) {
      return;
    }
    const socket = connectFamilySocket({ authToken: realtime.authToken });
    if (!socket) {
      return;
    }

    const onFamilyActivity = (event: FamilyActivityEvent) => {
      if (event.familyId !== realtime.familyId) {
        return;
      }
      scheduleRefresh();
    };
    const onConnect = () => {
      scheduleRefresh();
    };

    socket.on("family:activity", onFamilyActivity);
    socket.on("connect", onConnect);
    return () => {
      socket.off("family:activity", onFamilyActivity);
      socket.off("connect", onConnect);
    };
  }, [realtime, scheduleRefresh]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        scheduleRefresh();
      }
    });
    const interval = setInterval(() => {
      scheduleRefresh();
    }, 30000);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [scheduleRefresh]);

  const activeMember = members.find((m) => m.id === activeId) ?? null;
  // Routine assignments surface only their next incomplete step, same as the
  // web kiosk and the main dashboard, so a routine walks one step at a time.
  const activeChores = collapseRoutineChores(
    allChores.filter(
      (chore) =>
        !completedIds[chore.id] && (activeMember ? choreMatchesMember(chore, activeMember) : false),
    ),
  );
  const activeName = activeMember?.name ?? "";
  const activeCoins = activeId ? coinsByMember[activeId] ?? 0 : 0;

  // Celebrate when a player lands on an empty (all-done) list: fire confetti
  // once, re-arming when they next have chores so finishing again re-triggers.
  const allDoneMemberRef = React.useRef("");
  const allDone = !loading && Boolean(activeMember) && activeChores.length === 0;
  React.useEffect(() => {
    if (allDone) {
      if (allDoneMemberRef.current !== activeId) {
        allDoneMemberRef.current = activeId;
        celebrate(t("kiosk.allDoneTitle"));
      }
    } else if (allDoneMemberRef.current === activeId) {
      allDoneMemberRef.current = "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone, activeId]);

  // Switching is instant on the client (re-filter cached chores); the network
  // call rotates the session cookie so completions attribute to the new player.
  // Completes are blocked until that resolves to keep attribution correct.
  async function onSelectPlayer(memberId: string) {
    if (switching || memberId === activeId) {
      return;
    }
    const previousId = activeId;
    setActiveId(memberId);
    setSwitching(true);
    setActionError("");
    try {
      await switchKioskPlayer(memberId);
      onSwitched();
    } catch (error) {
      setActiveId(previousId);
      setActionError(
        t("kiosk.switchError", {
          error: error instanceof Error ? error.message : "kiosk_switch_failed",
        }),
      );
    } finally {
      setSwitching(false);
    }
  }

  async function onComplete(chore: MobileFamilyChore) {
    if (completingRef.current.has(chore.id) || switching) {
      return;
    }
    completingRef.current.add(chore.id);
    setActionError("");
    setPendingIds((current) => ({ ...current, [chore.id]: true }));
    setCompletedIds((current) => ({ ...current, [chore.id]: true }));
    celebrate();
    try {
      await completeMobileChore(chore.id);
      const coinValue = chore.coinValue ?? 0;
      if (coinValue > 0 && activeId) {
        setCoinsByMember((current) => ({
          ...current,
          [activeId]: (current[activeId] ?? 0) + coinValue,
        }));
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "complete_chore_failed";
      // A stale or duplicate tap can race the server: the chore is already
      // completed, so the transition is rejected. That's effectively success —
      // keep it hidden rather than reverting and showing a confusing error.
      if (code !== "invalid_status_transition") {
        // Revert the optimistic removal.
        setCompletedIds((current) => {
          const next = { ...current };
          delete next[chore.id];
          return next;
        });
        setActionError(t("kiosk.completeError", { error: code }));
      }
    } finally {
      completingRef.current.delete(chore.id);
      setPendingIds((current) => {
        const next = { ...current };
        delete next[chore.id];
        return next;
      });
    }
  }

  function onExitPressed() {
    if (pinRequired) {
      setPin("");
      setPinError("");
      setExitOpen(true);
    } else {
      void onExit();
    }
  }

  async function onExit() {
    if (pinPending) {
      return;
    }
    setPinPending(true);
    setPinError("");
    try {
      await stopKiosk(pin);
      setExitOpen(false);
      onExited();
    } catch (error) {
      setPinError(
        t("kiosk.exitError", {
          error: error instanceof Error ? error.message : "kiosk_stop_failed",
        }),
      );
    } finally {
      setPinPending(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <Text style={styles.badge}>{t("kiosk.badge")}</Text>
        <View style={styles.exitSlot}>
          <Button label={t("kiosk.exit")} variant="danger" onPress={onExitPressed} />
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.loadingText}>{t("kiosk.loadingChores")}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {roster.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.roster}>
              {roster.map((member) => {
                const active = member.id === activeId;
                return (
                  <Pressable
                    key={member.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: switching && !active }}
                    disabled={switching && !active}
                    onPress={() => void onSelectPlayer(member.id)}
                    style={[styles.rosterCard, active && styles.rosterCardActive]}>
                    <AvatarBadge
                      name={member.name}
                      imageUrl={member.avatarUrl}
                      color={member.primaryColor || colors.brand}
                      size={active ? 64 : 48}
                    />
                    <Text style={[styles.rosterName, active && styles.rosterNameActive]} numberOfLines={1}>
                      {member.name}
                    </Text>
                    {active ? <CoinPill value={activeCoins} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {loadError ? <Text style={styles.error}>{t("kiosk.loadError", { error: loadError })}</Text> : null}
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}

          {activeChores.length === 0 ? (
            <MobileAllDoneCelebration
              title={t("kiosk.allDoneTitle")}
              body={t("kiosk.allDoneBody", { name: activeName })}
            />
          ) : (
            activeChores.map((chore) => {
              const showCoins = (chore.coinValue ?? 0) > 0 && !shouldHideChoreCoinValue(chore);
              return (
                <View key={chore.id} style={styles.choreCard}>
                  <View style={styles.choreMain}>
                    <Text style={styles.choreTitle}>{chore.title}</Text>
                    {chore.routineAssignmentId ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setRoutineAssignmentId(chore.routineAssignmentId ?? "")}
                        style={styles.routineBadge}>
                        <Text style={styles.routineBadgeIcon}>📋</Text>
                        <Text style={styles.routineBadgeText} numberOfLines={1}>
                          {chore.routineName}
                        </Text>
                        {chore.routineStepOrder && chore.routineStepCount ? (
                          <Text style={styles.routineBadgeSteps}>
                            {chore.routineStepOrder}/{chore.routineStepCount}
                          </Text>
                        ) : null}
                      </Pressable>
                    ) : null}
                    {chore.details ? (
                      <Text style={styles.choreDetails} numberOfLines={2}>
                        {chore.details}
                      </Text>
                    ) : null}
                    {showCoins ? (
                      <View style={styles.coinSlot}>
                        <CoinPill value={chore.coinValue ?? 0} />
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.choreAction}>
                    <Button
                      label={pendingIds[chore.id] ? t("kiosk.completing") : t("kiosk.complete")}
                      variant="success"
                      disabled={Boolean(pendingIds[chore.id]) || switching}
                      onPress={() => void onComplete(chore)}
                    />
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <Modal visible={exitOpen} transparent animationType="fade" onRequestClose={() => setExitOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setExitOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>{t("kiosk.exitTitle")}</Text>
            <Text style={styles.sheetBody}>{t("kiosk.exitBody")}</Text>
            <Text style={styles.label}>{t("kiosk.pinLabel")}</Text>
            <TextInput
              value={pin}
              onChangeText={(value) => setPin(normalizePin(value))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              autoFocus
              placeholder="••••"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            {pinError ? <Text style={styles.error}>{pinError}</Text> : null}
            <View style={styles.sheetActions}>
              <View style={styles.sheetActionButton}>
                <Button
                  label={t("common.actions.close")}
                  variant="secondary"
                  disabled={pinPending}
                  onPress={() => setExitOpen(false)}
                />
              </View>
              <View style={styles.sheetActionButton}>
                <Button
                  label={pinPending ? t("kiosk.checking") : t("kiosk.exit")}
                  variant="danger"
                  disabled={pinPending || pin.length < 4}
                  onPress={() => void onExit()}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <MobileRoutineProgressDialog
        assignmentId={routineAssignmentId}
        visible={Boolean(routineAssignmentId)}
        onClose={() => setRoutineAssignmentId("")}
        onChanged={() => void load()}
      />

      {celebrating ? <MobileConfetti key={burstKey} label={burstLabel || undefined} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  badge: {
    fontSize: typography.small,
    fontWeight: "900",
    color: colors.brandStrong,
    backgroundColor: colors.accentSoft,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    overflow: "hidden",
  },
  exitSlot: { minWidth: 140 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  loadingText: { color: colors.muted, fontSize: typography.small },
  body: { padding: spacing.lg, gap: spacing.md },
  roster: { gap: spacing.md, paddingVertical: spacing.xs, paddingRight: spacing.md },
  rosterCard: {
    width: 104,
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "transparent",
    opacity: 0.6,
  },
  rosterCardActive: {
    opacity: 1,
    backgroundColor: colors.surface,
    borderColor: colors.line,
  },
  rosterName: { fontSize: typography.small, fontWeight: "700", color: colors.muted, maxWidth: 96 },
  rosterNameActive: { color: colors.text, fontWeight: "800" },
  error: { color: colors.danger, fontSize: typography.small, fontWeight: "700" },
  choreCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  choreMain: { flex: 1, gap: spacing.xs, alignItems: "flex-start" },
  choreTitle: { fontSize: typography.body, fontWeight: "800", color: colors.text },
  choreDetails: { fontSize: typography.small, color: colors.muted },
  coinSlot: { alignSelf: "flex-start" },
  routineBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    maxWidth: "100%",
    borderRadius: radius.pill,
    backgroundColor: "#e0f2fe",
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  routineBadgeIcon: { fontSize: typography.tiny },
  routineBadgeText: { flexShrink: 1, fontSize: typography.tiny, fontWeight: "800", color: "#0369a1" },
  routineBadgeSteps: { fontSize: typography.tiny, fontWeight: "800", color: "#0369a1" },
  choreAction: { minWidth: 110 },
  backdrop: { flex: 1, backgroundColor: "rgba(11,18,32,0.45)", justifyContent: "center", padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  sheetTitle: { fontSize: typography.h3, fontWeight: "800", color: colors.text },
  sheetBody: { fontSize: typography.body, color: colors.muted },
  label: { fontSize: typography.small, fontWeight: "700", color: colors.text, marginTop: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.h3,
    letterSpacing: 8,
    textAlign: "center",
    color: colors.text,
    backgroundColor: colors.background,
  },
  sheetActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  sheetActionButton: { flex: 1 },
});
