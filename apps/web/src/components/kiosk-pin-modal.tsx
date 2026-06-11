"use client";

import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";
import { useLocale } from "@/components/locale-provider";

type KioskPinModalProps = {
  open: boolean;
  title: string;
  body: string;
  pin: string;
  onPinChange: (value: string) => void;
  pending: boolean;
  error: string;
  confirmLabel: string;
  pinRequired: boolean;
  onRequestClose: () => void;
  onConfirm: () => void;
};

function normalizePinInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

// Shared PIN prompt for the Kiosk Mode enter/switch/exit flows. Reuses the same
// 4-digit profile-switch PIN; when no PIN is configured the field is hidden and
// the action proceeds without one.
export function KioskPinModal({
  open,
  title,
  body,
  pin,
  onPinChange,
  pending,
  error,
  confirmLabel,
  pinRequired,
  onRequestClose,
  onConfirm,
}: KioskPinModalProps) {
  const { t } = useLocale();
  return (
    <ModalShell open={open} onRequestClose={onRequestClose}>
      <form
        className="family-modal-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) {
            onConfirm();
          }
        }}>
        <div className="modal-dialog-title-row family-modal-title-row">
          <h3 className="family-modal-title">{title}</h3>
          <Button
            type="button"
            className="modal-close-button"
            onClick={onRequestClose}
            aria-label={t("common.actions.close")}
            title={t("common.actions.close")}>
            X
          </Button>
        </div>
        <div className="flex w-full flex-col gap-3">
          <p className="small">{body}</p>
          {error ? <Alert tone="warning">{error}</Alert> : null}
          {pinRequired ? (
            <label className="flex w-full flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">{t("kiosk.pinLabel")}</span>
              <input
                type="password"
                name="kiosk-pin-code"
                autoFocus
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                autoComplete="new-password"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                value={pin}
                onChange={(event) => onPinChange(normalizePinInput(event.target.value))}
                className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
              />
            </label>
          ) : null}
          <div className="family-modal-actions">
            <Button type="button" className="btn btn-secondary" disabled={pending} onClick={onRequestClose}>
              {t("common.actions.cancel")}
            </Button>
            <Button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? t("kiosk.checking") : confirmLabel}
            </Button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}
