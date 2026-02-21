"use client";

import { ReactNode, useEffect, useState } from "react";

type ModalShellProps = {
  open: boolean;
  children: ReactNode;
};

const EXIT_MS = 140;

export function ModalShell({ open, children }: ModalShellProps) {
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

  if (!mounted) {
    return null;
  }

  return (
    <div className={`modal-backdrop${closing ? " is-closing" : ""}`}>
      <div className={`modal-panel${closing ? " is-closing" : ""}`}>{children}</div>
    </div>
  );
}

