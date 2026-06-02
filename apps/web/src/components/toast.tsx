"use client";

import { useEffect, useState } from "react";

// Lightweight, app-wide toast built on the same window CustomEvent pattern used
// elsewhere (e.g. "wallet:refresh", "notifications:refresh"). Call showToast()
// from anywhere; <ToastViewport /> (mounted once in the root layout) renders.

export type ToastTone = "success" | "error" | "info";

export type ToastDetail = {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ActiveToast = ToastDetail & { id: number; tone: ToastTone };

const TOAST_EVENT = "app:toast";
const DEFAULT_DURATION_MS = 4000;

export function showToast(message: string, tone: ToastTone = "info", durationMs?: number) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { message, tone, durationMs } }),
  );
}

const TONE_CLASSES: Record<ToastTone, string> = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-800",
  error: "border-red-300 bg-red-50 text-red-700",
  info: "border-sky-300 bg-sky-50 text-sky-800",
};

export function ToastViewport() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);

  useEffect(() => {
    let counter = 0;
    function onToast(event: Event) {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      if (!detail || !detail.message) {
        return;
      }
      const id = ++counter;
      const tone = detail.tone ?? "info";
      const duration = detail.durationMs ?? DEFAULT_DURATION_MS;
      setToasts((current) => [...current, { id, tone, message: detail.message }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, duration);
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="app-toast-viewport" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`app-toast flex items-start gap-2 rounded-md border px-3 py-2 text-sm leading-5 shadow-lg ${TONE_CLASSES[toast.tone]}`}>
          <div className="min-w-0">{toast.message}</div>
        </div>
      ))}
    </div>
  );
}
