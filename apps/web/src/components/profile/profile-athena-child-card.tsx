"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";

type AthenaChildSummary = {
  childUuid: string;
  displayName: string;
  email: string | null;
  linkedPlayerId: string | null;
};

type ChildStatus = {
  playerId: string;
  enabled: boolean;
  familyConnected: boolean;
  athenaChildUuid: string;
};

/**
 * Per-child Athena enablement, shown on a child's profile (admins only). The
 * family-level Athena connection must already exist (set up from the parent's
 * profile); otherwise this renders nothing. Enabling links this child's Family
 * Chores player to an Athena child profile so the child's own questions ground
 * on their coins/chores.
 */
export function ProfileAthenaChildCard({
  playerId,
  displayName,
}: {
  playerId: string;
  displayName: string;
}) {
  const [status, setStatus] = useState<ChildStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState<AthenaChildSummary[] | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/profile/integrations/athena/children/${encodeURIComponent(playerId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setStatus(null);
        return;
      }
      setStatus((await response.json()) as ChildStatus);
    } catch {
      setStatus(null);
    } finally {
      setLoaded(true);
    }
  }, [playerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function enable(choice?: { childUuid?: string; createNew?: boolean }) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/profile/integrations/athena/children/${encodeURIComponent(playerId)}`,
        {
          method: "POST",
          headers: choice ? { "Content-Type": "application/json" } : {},
          body: choice ? JSON.stringify(choice) : undefined,
        },
      );
      const body = await response.json();
      if (response.status === 409 && body.needsSelection) {
        setPicker((body.athenaChildren as AthenaChildSummary[]) ?? []);
        return;
      }
      if (!response.ok) {
        throw new Error(body.message || "Couldn't enable Athena for this child.");
      }
      setPicker(null);
      await load();
    } catch (enableError) {
      setError(enableError instanceof Error ? enableError.message : "Couldn't enable Athena.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/profile/integrations/athena/children/${encodeURIComponent(playerId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Couldn't disable Athena for this child.");
      }
      await load();
    } catch (disableError) {
      setError(disableError instanceof Error ? disableError.message : "Couldn't disable Athena.");
    } finally {
      setBusy(false);
    }
  }

  // Self-hiding: render nothing until we know the family is connected and the
  // viewer is allowed to manage (the API returns non-OK otherwise).
  if (!loaded || !status || !status.familyConnected) {
    return null;
  }

  const enabled = status.enabled;

  return (
    <section aria-label="Athena Learning Companion" className="family-member-profile-card">
      <article className="profile-page-google-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 3v2M12 19v2M5 12H3M21 12h-2" />
              </svg>
            </span>
            <div>
              <h2>Athena Learning Companion</h2>
              <p className="small family-page-subhead !mb-0 max-w-prose">
                {enabled
                  ? `Athena is enabled for ${displayName}. When ${displayName} chats with Athena, it can answer about their own chores and coins.`
                  : `Enable Athena for ${displayName} so they can ask their AI companion about their chores and coins. Read-only — Athena never changes anything.`}
              </p>
            </div>
          </div>
          {enabled ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Enabled
            </span>
          ) : null}
        </div>

        {error ? <Alert>{error}</Alert> : null}

        <div className="mt-1">
          {enabled ? (
            <Button type="button" className="btn btn-secondary !text-red-600" disabled={busy} onClick={disable}>
              {busy ? "Disabling…" : "Disable for this child"}
            </Button>
          ) : (
            <Button type="button" className="btn btn-primary" disabled={busy} onClick={() => enable()}>
              {busy ? "Enabling…" : "Enable Athena"}
            </Button>
          )}
        </div>
      </article>

      {/* Picker: shown when the child can't be auto-matched to an Athena child. */}
      <ModalShell open={picker !== null} onRequestClose={() => (busy ? undefined : setPicker(null))}>
        <section className="flex flex-col gap-4 p-1" aria-label="Choose Athena child">
          <header className="modal-dialog-title-row">
            <h3 className="m-0">Link {displayName} to Athena</h3>
            <Button type="button" className="modal-close-button" onClick={() => setPicker(null)} disabled={busy} aria-label="Close dialog" title="Close dialog">
              X
            </Button>
          </header>
          <p className="small m-0 text-slate-600">
            We couldn&rsquo;t match {displayName} to an existing Athena child automatically. Pick the matching Athena
            child, or create a new one.
          </p>
          <div className="flex flex-col gap-2">
            {(picker ?? []).map((child) => (
              <button
                key={child.childUuid}
                type="button"
                disabled={busy || Boolean(child.linkedPlayerId)}
                onClick={() => void enable({ childUuid: child.childUuid })}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm transition hover:border-violet-300 disabled:opacity-50"
              >
                <span>
                  <span className="font-medium text-slate-800">{child.displayName || "Unnamed child"}</span>
                  {child.email ? <span className="ml-2 text-slate-400">{child.email}</span> : null}
                </span>
                {child.linkedPlayerId ? (
                  <span className="text-xs text-slate-400">already linked</span>
                ) : (
                  <span className="text-xs font-medium text-violet-600">Link</span>
                )}
              </button>
            ))}
            {(picker ?? []).length === 0 ? (
              <p className="small m-0 text-slate-500">No existing Athena children found.</p>
            ) : null}
          </div>
          <div className="modal-dialog-title-row mt-1 justify-end gap-2">
            <Button type="button" className="btn btn-secondary" onClick={() => setPicker(null)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" className="btn btn-primary" disabled={busy} onClick={() => void enable({ createNew: true })}>
              {busy ? "Working…" : "Create new Athena child"}
            </Button>
          </div>
        </section>
      </ModalShell>
    </section>
  );
}
