"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { KioskPinModal } from "@/components/kiosk-pin-modal";
import { useLocale } from "@/components/locale-provider";
import type { FamilySummaryResponse } from "@/lib/family/types";

type KioskPlayer = FamilySummaryResponse["members"][number];

// Player selector that starts Kiosk Mode (direct /kiosk visit; the profile-menu
// "Switch To" dialog offers the same flow). Any authenticated family member may
// use it; only player profiles are selectable, and multiple can be selected to
// approve a shared-tablet roster. Starting swaps the session into a player-level
// kiosk session via /api/kiosk/start.
export function KioskEntryClient() {
  const { t } = useLocale();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [inFamily, setInFamily] = useState(true);
  const [pinRequired, setPinRequired] = useState(false);
  const [players, setPlayers] = useState<KioskPlayer[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const [statusResponse, summaryResponse] = await Promise.all([
          fetch("/api/kiosk", { cache: "no-store" }),
          fetch("/api/family/summary", { cache: "no-store" }),
        ]);
        if (statusResponse.ok) {
          const status = (await statusResponse.json()) as {
            inFamily?: boolean;
            pinRequired?: boolean;
          };
          if (!cancelled) {
            setInFamily(status.inFamily !== false);
            setPinRequired(status.pinRequired === true);
          }
        }
        if (!summaryResponse.ok) {
          throw new Error(`FAMILY_SUMMARY_HTTP_${summaryResponse.status}`);
        }
        const summary = (await summaryResponse.json()) as FamilySummaryResponse;
        if (cancelled) {
          return;
        }
        if (summary.noFamily) {
          setInFamily(false);
        }
        const playerMembers = (Array.isArray(summary.members) ? summary.members : []).filter(
          (member) => member.role === "player" && member.status === "active",
        );
        setPlayers(playerMembers);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "kiosk_players_unavailable");
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
  }, []);

  function toggleSelection(memberId: string) {
    setSelectedIds((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId],
    );
  }

  function onStartClick() {
    if (selectedIds.length === 0) {
      return;
    }
    setPin("");
    setStartError("");
    if (pinRequired) {
      setPinModalOpen(true);
    } else {
      void startKiosk("");
    }
  }

  async function startKiosk(pinValue: string) {
    if (starting || selectedIds.length === 0) {
      return;
    }
    setStarting(true);
    setStartError("");
    try {
      const response = await fetch("/api/kiosk/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerIds: selectedIds, pin: pinValue }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `KIOSK_START_HTTP_${response.status}`);
      }
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "kiosk_start_failed");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="kiosk-entry">
      <header className="kiosk-entry-header">
        <span className="kiosk-badge">{t("kiosk.badge")}</span>
        <h1 className="kiosk-entry-title">{t("kiosk.selectPlayerTitle")}</h1>
        <p className="small kiosk-entry-subtitle">{t("kiosk.selectPlayerBody")}</p>
      </header>

      {loadError ? <Alert tone="warning">{t("kiosk.loadError", { error: loadError })}</Alert> : null}
      {!inFamily ? <Alert>{t("kiosk.noFamily")}</Alert> : null}
      {startError ? <Alert tone="warning">{t("kiosk.startError", { error: startError })}</Alert> : null}

      {loading ? (
        <p className="small">{t("kiosk.loadingPlayers")}</p>
      ) : inFamily && players.length === 0 ? (
        <p className="small">{t("kiosk.noPlayers")}</p>
      ) : (
        <div className="kiosk-player-grid">
          {players.map((player) => {
            const selected = selectedIds.includes(player.id);
            return (
              <Button
                key={player.id}
                type="button"
                className={`kiosk-player-option${selected ? " kiosk-player-option-selected" : ""}`}
                aria-pressed={selected}
                disabled={starting}
                onClick={() => toggleSelection(player.id)}>
                <Avatar
                  size={72}
                  name={player.name}
                  avatarId={player.avatarId}
                  photoUrl={player.avatarPhotoUrl}
                  primaryColor={player.dashboardPrimaryColor}
                  referrerPolicy="no-referrer"
                />
                <span className="kiosk-player-option-name">{player.name}</span>
                {selected ? (
                  <span className="kiosk-player-option-check" aria-hidden="true">✓</span>
                ) : null}
              </Button>
            );
          })}
        </div>
      )}

      {inFamily && players.length > 0 ? (
        <div className="kiosk-entry-actions">
          <Button
            type="button"
            className="btn btn-primary"
            disabled={selectedIds.length === 0 || starting}
            onClick={onStartClick}>
            {starting ? t("kiosk.checking") : t("kiosk.enterAction")}
          </Button>
        </div>
      ) : null}

      <KioskPinModal
        open={pinModalOpen}
        title={t("kiosk.enterAction")}
        body={t("kiosk.enterBody")}
        pin={pin}
        onPinChange={setPin}
        pending={starting}
        error={startError ? t("kiosk.startError", { error: startError }) : ""}
        confirmLabel={t("kiosk.enterAction")}
        pinRequired={pinRequired}
        onRequestClose={() => {
          setPinModalOpen(false);
          setStartError("");
        }}
        onConfirm={() => void startKiosk(pin)}
      />
    </div>
  );
}
