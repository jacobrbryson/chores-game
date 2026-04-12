"use client";

import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";

type AccountSwitchModalProps = {
  open: boolean;
  onRequestClose: () => void;
  memberName: string;
  pin: string;
  onPinChange: (value: string) => void;
  confirmPin: string;
  onConfirmPinChange: (value: string) => void;
  pending: boolean;
  error: string;
  requiresPinSetup: boolean;
  onConfirm: () => void;
};

function normalizePinInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

export function AccountSwitchModal({
  open,
  onRequestClose,
  memberName,
  pin,
  onPinChange,
  confirmPin,
  onConfirmPinChange,
  pending,
  error,
  requiresPinSetup,
  onConfirm,
}: AccountSwitchModalProps) {
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
          <h3 className="family-modal-title">Switch to Child</h3>
          <Button
            type="button"
            className="modal-close-button"
            onClick={onRequestClose}
            aria-label="Close dialog"
            title="Close dialog">
            X
          </Button>
        </div>
        <div className="flex w-full flex-col gap-3">
          {requiresPinSetup ? (
            <>
              <p className="small">
                Set a 4-digit guardian PIN before switching into <strong>{memberName}</strong>.
              </p>
              <p className="small">
                This PIN is used when you switch into a child profile and again when you want to return to your
                guardian account. Logging out always resets the session back to the guardian.
              </p>
            </>
          ) : (
            <>
              <p className="small">
                Enter your 4-digit PIN to switch into <strong>{memberName}</strong>.
              </p>
              <p className="small">
                While switched, the app behaves like the child profile, but logging out still returns the next
                sign-in to the guardian account.
              </p>
            </>
          )}
          {error && error !== "pin_not_configured" ? <Alert tone="warning">Could not switch accounts: {error}</Alert> : null}
          <label className="flex w-full flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">PIN</span>
            <input
              type="password"
              name="guardian-switch-code"
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
          {requiresPinSetup ? (
            <label className="flex w-full flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Confirm PIN</span>
              <input
                type="password"
                name="guardian-switch-code-confirm"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                autoComplete="new-password"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                value={confirmPin}
                onChange={(event) => onConfirmPinChange(normalizePinInput(event.target.value))}
                className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
              />
            </label>
          ) : null}
          <div className="family-modal-actions">
            <Button type="button" className="btn btn-secondary" disabled={pending} onClick={onRequestClose}>
              Cancel
            </Button>
            <Button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Checking..." : requiresPinSetup ? "Save PIN and Switch" : "Switch To Child"}
            </Button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}
