"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";

type AthenaStatus = {
  provider: "athena";
  connected: boolean;
  configured: boolean;
  canManage: boolean;
  email: string;
  displayName: string;
  playerId: string;
  familyName: string;
  createdAccount: boolean;
  connectedAt: string;
};

const BENEFITS = [
  "AI-powered chore suggestions tailored to each child.",
  "Lets Athena (powered by Gemini) securely read your chores, coin balance, and progress so it can answer questions and give helpful nudges.",
  "Read-only: Athena can view your Family Chores data but never change it.",
];

function AthenaGlyph() {
  return (
    <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-sm">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3v2" />
        <path d="M12 19v2" />
        <path d="M5 12H3" />
        <path d="M21 12h-2" />
        <circle cx="12" cy="12" r="4" />
        <path d="m6.3 6.3 1.4 1.4" />
        <path d="m16.3 16.3 1.4 1.4" />
      </svg>
    </span>
  );
}

/**
 * Integrations card that connects a family to "Athena Learning Companion AI".
 * Connecting is a one-click, parent/admin-only action: our backend mints a
 * scoped read-only token and hands it to Athena server-to-server. The token and
 * partner secret never touch the browser.
 */
export function ProfileAthenaCard() {
  const [status, setStatus] = useState<AthenaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/profile/integrations/athena", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.message || body.error || `ATHENA_STATUS_HTTP_${response.status}`);
      }
      setStatus(body as AthenaStatus);
    } catch (loadError) {
      setStatus(null);
      setError(loadError instanceof Error ? loadError.message : "Couldn't load Athena status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/profile/integrations/athena", { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.message || "Connection failed, please try again later.");
      }
      setStatus(body as AthenaStatus);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Connection failed, please try again later.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/profile/integrations/athena", { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.message || "Couldn't disconnect, please try again.");
      }
      await load();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Couldn't disconnect, please try again.");
    } finally {
      setBusy(false);
    }
  }

  const connected = Boolean(status?.connected);
  const canManage = Boolean(status?.canManage);

  return (
    <section aria-label="Athena Learning Companion AI" className="relative">
      {/* Coming Soon overlay — Athena integration is temporarily disabled */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/70 p-6 text-center backdrop-blur-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/avatars/default/avatar-02.png"
          alt=""
          width={72}
          height={72}
          className="h-[72px] w-[72px] rounded-full shadow-md ring-2 ring-white"
        />
        <div>
          <p className="m-0 text-base font-semibold text-slate-800">Coming Soon</p>
          <p className="small m-0 mt-1 max-w-xs text-slate-600">
            Athena Learning Companion AI isn&rsquo;t available just yet — check back soon!
          </p>
        </div>
      </div>
      <article aria-hidden="true" className="profile-page-google-card pointer-events-none select-none opacity-50">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AthenaGlyph />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2>Athena Learning Companion AI</h2>
                {connected ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Connected
                  </span>
                ) : null}
              </div>
              <p className="small family-page-subhead !mb-0 max-w-prose">
                Connect Family Chores to Athena, the kids&rsquo; AI learning companion powered by Gemini. Once
                connected, your child can just ask Athena things like &ldquo;What chores do I have today?&rdquo; or
                &ldquo;How many coins do I have?&rdquo; — and Athena can suggest age-appropriate chores tailored to your
                family.
              </p>
            </div>
          </div>
        </div>

        {/* Benefits */}
        <ul className="mt-1 flex flex-col gap-2">
          {BENEFITS.map((benefit) => (
            <li key={benefit} className="flex items-start gap-2 text-sm text-slate-600">
              <svg
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-violet-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <span>{benefit}</span>
            </li>
          ))}
        </ul>

        {error ? <Alert>{error}</Alert> : null}

        {loading ? (
          <div className="flex items-center gap-2 py-2 text-slate-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-violet-500" />
            <p className="small m-0">Checking connection…</p>
          </div>
        ) : null}

        {!loading && connected ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="m-0 text-sm font-semibold text-emerald-800">
              Family Chores is connected to Athena
              {status?.displayName ? ` · ${status.displayName}` : ""}
            </p>
            {status?.email ? <p className="small m-0 mt-0.5 text-emerald-700/90">{status.email}</p> : null}
            <p className="small m-0 mt-2 text-slate-600">
              Your child can now ask Athena &ldquo;What chores do I have today?&rdquo; or &ldquo;How many coins do I
              have?&rdquo;
            </p>
            {canManage ? (
              <div className="mt-3">
                <Button type="button" className="btn btn-secondary !text-red-600" disabled={busy} onClick={disconnect}>
                  {busy ? "Disconnecting…" : "Disconnect"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {!loading && !connected ? (
          <div className="flex flex-col gap-3">
            {canManage ? (
              <>
                <div>
                  <Button type="button" className="btn btn-primary" disabled={busy || status?.configured === false} onClick={connect}>
                    {busy ? "Connecting…" : "Connect Athena"}
                  </Button>
                </div>
                {status?.configured === false ? (
                  <p className="small m-0 text-amber-600">
                    Athena isn&rsquo;t configured on this server yet. Set the Athena partner credentials to enable
                    connecting.
                  </p>
                ) : (
                  <p className="small m-0 text-slate-500">
                    Connecting is a parent action. We&rsquo;ll securely link your account — your child never handles any
                    keys.
                  </p>
                )}
              </>
            ) : (
              <Alert tone="info">Only a parent or admin can connect Athena.</Alert>
            )}
          </div>
        ) : null}
      </article>
    </section>
  );
}
