"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/alert";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { CoinIcon } from "@/components/coin-icon";
import { KioskPinModal } from "@/components/kiosk-pin-modal";
import { useLocale } from "@/components/locale-provider";
import {
  buildAllDoneProgressPayload,
  IdentityTitleCelebration,
  type IdentityTitleCelebrationData,
} from "@/components/identity-title-celebration";
import {
  RoutineBadgeIcon,
  RoutineProgressDialog,
} from "@/components/routine-progress-dialog";
import { collapseRoutineChores } from "@/lib/responsibility/routine-chores";
import { triggerPartyConfetti } from "@/lib/confetti/party";
import { connectFamilySocket, type FamilyActivityEvent } from "@/lib/ws";
import type { FamilySnapshotChore, FamilySummaryResponse } from "@/lib/family/types";

type KioskActiveClientProps = {
  playerName: string;
  playerEmail: string;
  playerInitial: string;
};

type KioskPlayer = FamilySummaryResponse["members"][number];

const CHORE_EXIT_ANIMATION_MS = 200;

function normalizeAlias(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function memberAliasSet(member: KioskPlayer): Set<string> {
  return new Set([member.id, member.uid, member.email].map(normalizeAlias).filter(Boolean));
}

// Whether an open chore is assigned to the given player. Family chores apply to
// everyone; otherwise match the member's assignee aliases.
function choreMatchesMember(chore: FamilySnapshotChore, aliases: Set<string>) {
  if (chore.assigneeScope === "family") {
    return true;
  }
  if (chore.assigneeId && aliases.has(normalizeAlias(chore.assigneeId))) {
    return true;
  }
  return (chore.assigneeIds ?? []).some((id) => aliases.has(normalizeAlias(id)));
}

// Focused shared-tablet checklist. The whole family's today-chores are fetched
// once and cached, so switching between the pre-approved roster is instant
// (client-side filter) — the websocket keeps the cache fresh when chores are
// added/removed. Permissions are always player-level, even when the selected
// profile is a parent; this view never exposes parent/admin/support controls.
export function KioskActiveClient({
  playerName,
  playerEmail,
  playerInitial,
}: KioskActiveClientProps) {
  const { t } = useLocale();
  const [members, setMembers] = useState<KioskPlayer[]>([]);
  const [allChores, setAllChores] = useState<FamilySnapshotChore[]>([]);
  const [rosterIds, setRosterIds] = useState<string[]>([]);
  const [activeMemberId, setActiveMemberId] = useState("");
  const [realtime, setRealtime] = useState<{ authToken: string; familyId: string } | null>(null);
  const [coinsByMember, setCoinsByMember] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pendingCompleteIds, setPendingCompleteIds] = useState<Record<string, true>>({});
  const [exitingIds, setExitingIds] = useState<Record<string, true>>({});
  const [completedIds, setCompletedIds] = useState<Record<string, true>>({});
  const [switching, setSwitching] = useState(false);
  const [pinRequired, setPinRequired] = useState(false);

  const [exitOpen, setExitOpen] = useState(false);
  const [routineDialogAssignmentId, setRoutineDialogAssignmentId] = useState("");
  const [pin, setPin] = useState("");
  const [pinPending, setPinPending] = useState(false);
  const [pinError, setPinError] = useState("");
  const [identityCelebration, setIdentityCelebration] =
    useState<IdentityTitleCelebrationData | null>(null);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const identityCelebrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch the family snapshot once (whole-family today chores + members + ws
  // token). Used on mount and for silent background reconciliation.
  const fetchSnapshot = useCallback(async () => {
    const response = await fetch("/api/family/summary", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`FAMILY_SUMMARY_HTTP_${response.status}`);
    }
    const summary = (await response.json()) as FamilySummaryResponse;
    const nextMembers = Array.isArray(summary.members) ? summary.members : [];
    setMembers(nextMembers);
    setAllChores(
      (Array.isArray(summary.choresToday) ? summary.choresToday : []).filter(
        (chore) => chore.status === "Open",
      ),
    );
    setCoinsByMember(
      Object.fromEntries(nextMembers.map((member) => [member.id, member.stats?.currentCoins ?? 0])),
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
    return summary;
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      void fetchSnapshot().catch(() => {
        // Silent background reconciliation; keep the cached view on failure.
      });
    }, 120);
  }, [fetchSnapshot]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        let roster: string[] = [];
        const statusResponse = await fetch("/api/kiosk", { cache: "no-store" });
        if (statusResponse.ok) {
          const status = (await statusResponse.json()) as {
            pinRequired?: boolean;
            playerIds?: string[];
          };
          if (!cancelled) {
            setPinRequired(status.pinRequired === true);
            roster = Array.isArray(status.playerIds) ? status.playerIds : [];
            setRosterIds(roster);
          }
        }
        const summary = await fetchSnapshot();
        if (cancelled) {
          return;
        }
        const viewerMember = (summary.members ?? []).find(
          (member) => member.uid === summary.viewerUid || member.id === summary.viewerUid,
        );
        setActiveMemberId(viewerMember?.id ?? roster[0] ?? "");
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "kiosk_chores_unavailable");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [fetchSnapshot]);

  // Live updates: refresh the cached snapshot when chores change anywhere in the
  // family (added/removed/completed), so switching never needs its own fetch.
  // We also re-sync on every (re)connect so a dropped socket can't leave the
  // tablet stale, and surface connection problems on the console.
  useEffect(() => {
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
      // Catch up on anything missed while disconnected.
      scheduleRefresh();
    };
    const onAuthOk = () => {
      console.info("[kiosk] realtime connected");
    };
    const onConnectError = (error: unknown) => {
      console.warn("[kiosk] realtime connect error", error);
    };
    socket.on("family:activity", onFamilyActivity);
    socket.on("connect", onConnect);
    socket.on("auth:ok", onAuthOk);
    socket.on("connect_error", onConnectError);
    return () => {
      socket.off("family:activity", onFamilyActivity);
      socket.off("connect", onConnect);
      socket.off("auth:ok", onAuthOk);
      socket.off("connect_error", onConnectError);
    };
  }, [realtime, scheduleRefresh]);

  // Safety net so a shared tablet left open for hours never goes stale even if a
  // websocket event is missed: re-sync when the tab regains focus/visibility and
  // on a slow background interval (only while visible).
  useEffect(() => {
    function onVisible() {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        scheduleRefresh();
      }
    }
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        scheduleRefresh();
      }
    }, 30000);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [scheduleRefresh]);

  useEffect(() => {
    const timers = exitTimersRef.current;
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      if (identityCelebrationTimerRef.current) {
        clearTimeout(identityCelebrationTimerRef.current);
      }
      for (const timer of Object.values(timers)) {
        clearTimeout(timer);
      }
    };
  }, []);

  const rosterPlayers = members.filter(
    (member) =>
      member.status === "active" &&
      (rosterIds.length === 0 || rosterIds.includes(member.id)),
  );
  const activeMember = members.find((member) => member.id === activeMemberId) ?? null;
  const activeAliases = activeMember ? memberAliasSet(activeMember) : new Set<string>();
  // Routine assignments surface only their next incomplete step, same as the
  // main dashboard, so kiosk players walk a routine one step at a time.
  const activeChores = collapseRoutineChores(
    allChores.filter(
      (chore) =>
        !completedIds[chore.id] && (activeMember ? choreMatchesMember(chore, activeAliases) : false),
    ),
  );
  const activeName = activeMember?.name || playerName;
  const activeCoins = activeMemberId ? coinsByMember[activeMemberId] ?? 0 : 0;

  // Switching is instant on the client (re-filter cached chores); the network
  // call only rotates the session cookie so completions attribute to the new
  // player. Completes are blocked until that resolves to keep attribution correct.
  async function onSelectPlayer(member: KioskPlayer) {
    if (switching || member.id === activeMemberId) {
      return;
    }
    const previousId = activeMemberId;
    setActiveMemberId(member.id);
    setSwitching(true);
    setActionError("");
    try {
      const response = await fetch("/api/kiosk/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: member.id }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `KIOSK_SWITCH_HTTP_${response.status}`);
      }
    } catch (error) {
      setActiveMemberId(previousId);
      setActionError(t("kiosk.switchError", { error: error instanceof Error ? error.message : "kiosk_switch_failed" }));
    } finally {
      setSwitching(false);
    }
  }

  async function onComplete(chore: FamilySnapshotChore, event: { clientX: number; clientY: number }) {
    if (pendingCompleteIds[chore.id] || switching) {
      return;
    }
    setActionError("");
    setPendingCompleteIds((current) => ({ ...current, [chore.id]: true }));
    setExitingIds((current) => ({ ...current, [chore.id]: true }));
    // Remove from the list once the exit animation has played.
    exitTimersRef.current[chore.id] = setTimeout(() => {
      setCompletedIds((current) => ({ ...current, [chore.id]: true }));
      setExitingIds((current) => {
        const next = { ...current };
        delete next[chore.id];
        return next;
      });
      delete exitTimersRef.current[chore.id];
    }, CHORE_EXIT_ANIMATION_MS);
    try {
      const response = await fetch(`/api/chores/${chore.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `COMPLETE_CHORE_HTTP_${response.status}`);
      }
      const completePayload = (await response.json().catch(() => null)) as
        | {
            responsibilityXp?: {
              choreXpAwarded?: number;
              newSkillXpAwarded?: number;
              title?: Omit<IdentityTitleCelebrationData, "xpAwarded">;
            };
            routineProgress?: {
              completionBonusXpAwarded?: number;
            };
          }
        | null;
      const titlePayload = completePayload?.responsibilityXp?.title;
      const xpAwarded =
        (completePayload?.responsibilityXp?.choreXpAwarded ?? 0) +
        (completePayload?.responsibilityXp?.newSkillXpAwarded ?? 0) +
        (completePayload?.routineProgress?.completionBonusXpAwarded ?? 0);
      const identityData = titlePayload ? { ...titlePayload, xpAwarded } : null;
      triggerPartyConfetti({
        intensity: 1.3,
        sourceClientX: event.clientX,
        sourceClientY: event.clientY,
        showAllDone: true,
        ...(identityData
          ? { allDoneProgress: buildAllDoneProgressPayload(identityData, t) }
          : {}),
      });
      if (identityData) {
        setIdentityCelebration(identityData);
        if (identityCelebrationTimerRef.current) {
          clearTimeout(identityCelebrationTimerRef.current);
        }
        identityCelebrationTimerRef.current = setTimeout(
          () => {
            setIdentityCelebration(null);
            identityCelebrationTimerRef.current = null;
          },
          identityData.unlocked ? 5500 : 4000,
        );
      }
      // Optimistic coin bump for the active player; reconciled by the refresh.
      if (chore.coinValue > 0 && activeMemberId) {
        setCoinsByMember((current) => ({
          ...current,
          [activeMemberId]: (current[activeMemberId] ?? 0) + chore.coinValue,
        }));
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("wallet:refresh"));
        window.dispatchEvent(new Event("notifications:refresh"));
      }
      scheduleRefresh();
    } catch (error) {
      // Revert the optimistic removal.
      const timer = exitTimersRef.current[chore.id];
      if (timer) {
        clearTimeout(timer);
        delete exitTimersRef.current[chore.id];
      }
      setExitingIds((current) => {
        const next = { ...current };
        delete next[chore.id];
        return next;
      });
      setCompletedIds((current) => {
        const next = { ...current };
        delete next[chore.id];
        return next;
      });
      setActionError(t("kiosk.completeError", { error: error instanceof Error ? error.message : "complete_chore_failed" }));
    } finally {
      setPendingCompleteIds((current) => {
        const next = { ...current };
        delete next[chore.id];
        return next;
      });
    }
  }

  async function onExit() {
    if (pinPending) {
      return;
    }
    setPinPending(true);
    setPinError("");
    try {
      const response = await fetch("/api/kiosk/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `KIOSK_STOP_HTTP_${response.status}`);
      }
      if (typeof window !== "undefined") {
        window.location.assign("/");
      }
    } catch (error) {
      setPinError(t("kiosk.exitError", { error: error instanceof Error ? error.message : "kiosk_stop_failed" }));
    } finally {
      setPinPending(false);
    }
  }

  return (
    <div className="kiosk-active">
      <header className="kiosk-active-bar">
        <span className="kiosk-badge">{t("kiosk.badge")}</span>
        <Button
          type="button"
          className="btn btn-primary kiosk-exit-button"
          onClick={() => {
            setPin("");
            setPinError("");
            setExitOpen(true);
          }}>
          {t("kiosk.exit")}
        </Button>
      </header>

      {loading ? (
        <div className="kiosk-roster kiosk-roster-skeleton" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <div key={index} className={`kiosk-roster-card kiosk-skeleton-card${index === 0 ? " is-active" : " is-dim"}`}>
              <span className="kiosk-skeleton-avatar kiosk-skeleton" />
              <span className="kiosk-skeleton-line kiosk-skeleton" />
            </div>
          ))}
        </div>
      ) : (
        <div className="kiosk-roster" role="group" aria-label={t("kiosk.switchPlayer")}>
          {rosterPlayers.map((member) => {
            const active = member.id === activeMemberId;
            return (
              <button
                key={member.id}
                type="button"
                className={`kiosk-roster-card${active ? " is-active" : " is-dim"}`}
                aria-current={active ? "true" : undefined}
                disabled={switching && !active}
                onClick={() => void onSelectPlayer(member)}>
                <Avatar
                  size={active ? 76 : 52}
                  name={member.name}
                  initial={(member.name || playerInitial || "?").trim().charAt(0).toUpperCase()}
                  avatarId={member.avatarId}
                  photoUrl={member.avatarPhotoUrl}
                  primaryColor={member.dashboardPrimaryColor}
                  referrerPolicy="no-referrer"
                />
                <span className="kiosk-roster-card-name">{member.name}</span>
                {active ? (
                  <span className="kiosk-roster-card-coins">
                    <CoinIcon size={16} /> {activeCoins}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {loadError ? <Alert tone="warning">{t("kiosk.loadError", { error: loadError })}</Alert> : null}
      {actionError ? <Alert tone="warning">{actionError}</Alert> : null}
      {identityCelebration ? (
        <IdentityTitleCelebration data={identityCelebration} />
      ) : null}

      {loading ? (
        <ul className="kiosk-chore-list" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <li key={index} className="kiosk-chore-card kiosk-skeleton-row">
              <span className="kiosk-skeleton-line kiosk-skeleton" style={{ width: `${60 - index * 8}%` }} />
              <span className="kiosk-skeleton-pill kiosk-skeleton" />
            </li>
          ))}
        </ul>
      ) : activeChores.length === 0 ? (
        <div className="kiosk-empty">
          <p className="kiosk-empty-title">{t("kiosk.allDoneTitle")}</p>
          <p className="small">{t("kiosk.allDoneBody", { name: activeName || playerEmail })}</p>
        </div>
      ) : (
        <ul className="kiosk-chore-list">
          {activeChores.map((chore) => (
            <li
              key={chore.id}
              className={`kiosk-chore-card${exitingIds[chore.id] ? " is-exiting" : ""}`}>
              <div className="kiosk-chore-main">
                <span className="kiosk-chore-title">{chore.title}</span>
                {chore.routineAssignmentId ? (
                  <button
                    type="button"
                    className="inline-flex w-fit items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-700"
                    title={t("responsibility.routineBadgeTooltip", {
                      name: chore.routineName ?? "",
                    })}
                    onClick={() => setRoutineDialogAssignmentId(chore.routineAssignmentId ?? "")}>
                    <RoutineBadgeIcon size={13} />
                    <span>{chore.routineName}</span>
                    {chore.routineStepOrder && chore.routineStepCount ? (
                      <span>
                        {chore.routineStepOrder}/{chore.routineStepCount}
                      </span>
                    ) : null}
                  </button>
                ) : null}
                {chore.details ? <span className="small kiosk-chore-details">{chore.details}</span> : null}
                {chore.coinValue > 0 ? (
                  <span className="kiosk-chore-coins">
                    <CoinIcon size={14} /> {chore.coinValue}
                  </span>
                ) : null}
              </div>
              <Button
                type="button"
                className="btn btn-primary kiosk-chore-complete"
                disabled={Boolean(pendingCompleteIds[chore.id]) || switching}
                onClick={(event) => void onComplete(chore, { clientX: event.clientX, clientY: event.clientY })}>
                {pendingCompleteIds[chore.id] ? t("kiosk.completing") : t("kiosk.complete")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {routineDialogAssignmentId ? (
        <RoutineProgressDialog
          assignmentId={routineDialogAssignmentId}
          open
          onRequestClose={() => setRoutineDialogAssignmentId("")}
          onChanged={scheduleRefresh}
        />
      ) : null}

      <KioskPinModal
        open={exitOpen}
        title={t("kiosk.exitTitle")}
        body={t("kiosk.exitBody")}
        pin={pin}
        onPinChange={setPin}
        pending={pinPending}
        error={pinError}
        confirmLabel={t("kiosk.exit")}
        pinRequired={pinRequired}
        onRequestClose={() => {
          setExitOpen(false);
          setPinError("");
        }}
        onConfirm={() => void onExit()}
      />
    </div>
  );
}
