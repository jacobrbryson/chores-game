"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { connectFamilySocket } from "@/lib/ws";
import type { AchievementUnlockedEvent } from "@/lib/ws/achievement-unlocked-event";

type ToastItem = AchievementUnlockedEvent & {
  toastId: string;
  createdAtMs: number;
  expiresAtMs: number;
};

const TOAST_DURATION_MS = 5000;

export function AchievementUnlockListener() {
  const router = useRouter();
  const [socketState, setSocketState] = useState<{
    wsAuthToken: string;
    viewerUid: string;
    familyId: string;
  } | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const activeAchievementIds = useMemo(() => new Set(toasts.map((entry) => entry.achievementId)), [toasts]);

  useEffect(() => {
    let cancelled = false;
    async function loadSocketState() {
      try {
        const response = await fetch("/api/achievements?mode=listener", { cache: "no-store" });
        if (!response.ok || cancelled) {
          return;
        }
        const payload = (await response.json()) as {
          wsAuthToken?: string;
          viewerUid?: string;
          familyId?: string;
        };
        if (cancelled) {
          return;
        }
        if (!payload.wsAuthToken || !payload.viewerUid || !payload.familyId) {
          return;
        }
        setSocketState({
          wsAuthToken: payload.wsAuthToken,
          viewerUid: payload.viewerUid,
          familyId: payload.familyId,
        });
      } catch {
        // Ignore realtime listener bootstrap errors.
      }
    }
    void loadSocketState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) {
      return;
    }
    const nextExpiryMs = Math.min(...toasts.map((entry) => entry.expiresAtMs));
    const delayMs = Math.max(0, nextExpiryMs - Date.now());
    const timeout = window.setTimeout(() => {
      const currentNow = Date.now();
      setToasts((current) => current.filter((entry) => entry.expiresAtMs > currentNow));
    }, delayMs + 8);
    return () => window.clearTimeout(timeout);
  }, [toasts]);

  useEffect(() => {
    if (!socketState) {
      return;
    }
    const socket = connectFamilySocket({ authToken: socketState.wsAuthToken });
    if (!socket) {
      return;
    }
    const onUnlocked = (event: AchievementUnlockedEvent) => {
      if (event.userId !== socketState.viewerUid || event.familyId !== socketState.familyId) {
        return;
      }
      setToasts((current) => {
        if (current.some((entry) => entry.achievementId === event.achievementId)) {
          return current;
        }
        const createdAtMs = Date.now();
        const nextToast: ToastItem = {
          ...event,
          toastId: `${event.achievementId}_${event.completedAt}`,
          createdAtMs,
          expiresAtMs: createdAtMs + TOAST_DURATION_MS,
        };
        return [...current, nextToast];
      });
    };

    socket.on("achievement:unlocked", onUnlocked);
    return () => {
      socket.off("achievement:unlocked", onUnlocked);
    };
  }, [socketState]);

  if (!socketState || toasts.length === 0 || activeAchievementIds.size === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-[120] flex w-[calc(100vw-1.5rem)] max-w-sm flex-col gap-2 sm:w-96">
      {toasts.map((toast) => {
        const elapsed = Math.max(0, nowMs - toast.createdAtMs);
        const ratio = Math.max(0, Math.min(1, 1 - elapsed / TOAST_DURATION_MS));
        const countdownStyle = {
          background: `conic-gradient(#0ea5e9 ${Math.floor(ratio * 360)}deg, #cbd5e1 0deg)`,
        };
        return (
          <div
            key={toast.toastId}
            role="button"
            tabIndex={0}
            className="pointer-events-auto rounded-xl border border-sky-200 bg-white p-3 text-left shadow-lg"
            onClick={() => {
              router.push(`/achievements?highlight=${encodeURIComponent(toast.achievementId)}`);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                router.push(`/achievements?highlight=${encodeURIComponent(toast.achievementId)}`);
              }
            }}>
            <div className="flex items-start gap-3">
              <img
                src={toast.imageUrl}
                alt=""
                className="h-12 w-12 rounded-lg border object-cover"
                onError={(event) => {
                  (event.currentTarget as HTMLImageElement).src = "/store3/theme.png";
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{toast.wittyTitle}</p>
                <p className="mt-0.5 text-xs text-slate-700">{toast.description}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  aria-label="Dismiss achievement notification"
                  className="pointer-events-auto rounded p-1 text-slate-500 hover:bg-slate-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    setToasts((current) => current.filter((entry) => entry.toastId !== toast.toastId));
                  }}>
                  x
                </button>
                <span className="h-6 w-6 rounded-full p-0.5" style={countdownStyle}>
                  <span className="block h-full w-full rounded-full bg-white" />
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
