"use client";

import { useEffect } from "react";
import { installDiagnosticsCollectors } from "@/lib/support/diagnostics";

// Installs the recent-console-error / recent-API-failure ring buffers once, as
// early as possible, so bug reports can attach diagnostics captured before the
// user opened the report dialog. Renders nothing.
export function DiagnosticsBootstrap() {
  useEffect(() => {
    installDiagnosticsCollectors();
  }, []);
  return null;
}
