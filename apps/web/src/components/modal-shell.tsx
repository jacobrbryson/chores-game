"use client";

import { ReactNode, useEffect, useState } from "react";

type ModalShellProps = {
  open: boolean;
  children: ReactNode;
  onRequestClose?: () => void;
};

const EXIT_MS = 140;

export function ModalShell({ open, children, onRequestClose }: ModalShellProps) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) {
      return;
    }
    setClosing(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [mounted, open]);

  useEffect(() => {
    if (!mounted || !onRequestClose) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onRequestClose?.();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mounted, onRequestClose]);

  if (!mounted) {
    return null;
  }

  return (
    <div
      className={`modal-backdrop${closing ? " is-closing" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onRequestClose?.();
        }
      }}>
      <div className={`modal-panel${closing ? " is-closing" : ""}`}>{children}</div>
    </div>
  );
}
