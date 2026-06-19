"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";

type ApiTokenSummary = {
  id: string;
  name: string;
  status: "active" | "disabled" | "deleted";
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  usage: {
    usedToday: number;
    remainingToday: number;
    limit: number;
    resetAt: string;
  };
};

type ApiAuditSummary = {
  id: string;
  eventType: string;
  endpoint: string;
  method: string;
  statusCode: number;
  requestId: string;
  createdAt: string;
};

type ApiAccessPayload = {
  scopes: string[];
  tokens: ApiTokenSummary[];
  usageTrend: Array<{ day: string; count: number }>;
  auditEvents: ApiAuditSummary[];
};

const DEFAULT_SCOPES = ["read:profile", "read:players", "read:coins"];

const SCOPE_LABELS: Record<string, string> = {
  "read:profile": "Profile",
  "read:players": "Players",
  "read:coins": "Coin balances",
  "read:chores": "Chores",
  "read:achievements": "Achievements",
};

function scopeLabel(scope: string) {
  return SCOPE_LABELS[scope] ?? scope;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Never";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

const STATUS_STYLES: Record<ApiTokenSummary["status"], string> = {
  active: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  disabled: "bg-amber-100 text-amber-700 ring-amber-600/20",
  deleted: "bg-slate-200 text-slate-500 ring-slate-500/20",
};

function StatusBadge({ status }: { status: ApiTokenSummary["status"] }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          status === "active" ? "bg-emerald-500" : status === "disabled" ? "bg-amber-500" : "bg-slate-400"
        }`}
      />
      {status}
    </span>
  );
}

function statusCodeTone(statusCode: number) {
  if (statusCode >= 500) {
    return "bg-red-100 text-red-700";
  }
  if (statusCode >= 400) {
    return "bg-amber-100 text-amber-700";
  }
  return "bg-emerald-100 text-emerald-700";
}

export function ProfileApiAccessCard() {
  const [payload, setPayload] = useState<ApiAccessPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState(DEFAULT_SCOPES);
  const [rawToken, setRawToken] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const loadApiAccess = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/profile/api-tokens", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || `API_TOKENS_HTTP_${response.status}`);
      }
      setPayload(body as ApiAccessPayload);
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : "api_access_unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadApiAccess();
  }, [loadApiAccess]);

  const sevenDayTrend = useMemo(() => {
    if (payload?.usageTrend?.length) {
      return payload.usageTrend;
    }
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      return { day: date.toISOString().slice(0, 10), count: 0 };
    });
  }, [payload?.usageTrend]);

  const trendMax = useMemo(
    () => Math.max(1, ...sevenDayTrend.map((entry) => entry.count)),
    [sevenDayTrend],
  );
  const trendTotal = useMemo(
    () => sevenDayTrend.reduce((sum, entry) => sum + entry.count, 0),
    [sevenDayTrend],
  );

  const availableScopes = payload?.scopes ?? DEFAULT_SCOPES;
  const hasTokens = (payload?.tokens.length ?? 0) > 0;

  function toggleScope(scope: string) {
    setSelectedScopes((current) =>
      current.includes(scope)
        ? current.filter((entry) => entry !== scope)
        : [...current, scope].sort(),
    );
  }

  async function createToken() {
    if (pendingAction) {
      return;
    }
    setPendingAction("create");
    setError("");
    setRawToken("");
    try {
      const response = await fetch("/api/profile/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tokenName, scopes: selectedScopes }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || `API_TOKEN_CREATE_HTTP_${response.status}`);
      }
      setRawToken(body.rawToken || "");
      setTokenName("");
      setCreateOpen(false);
      await loadApiAccess();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "api_token_create_failed");
    } finally {
      setPendingAction("");
    }
  }

  async function updateToken(tokenId: string, action: "disable" | "delete" | "regenerate") {
    if (pendingAction) {
      return;
    }
    setPendingAction(`${action}:${tokenId}`);
    setError("");
    setRawToken("");
    try {
      const response = await fetch(`/api/profile/api-tokens/${encodeURIComponent(tokenId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || `API_TOKEN_${action.toUpperCase()}_HTTP_${response.status}`);
      }
      if (body.rawToken) {
        setRawToken(body.rawToken);
      }
      await loadApiAccess();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "api_token_update_failed");
    } finally {
      setPendingAction("");
    }
  }

  async function copyRawToken() {
    if (!rawToken || typeof navigator === "undefined") {
      return;
    }
    await navigator.clipboard.writeText(rawToken);
    setCopyStatus("Copied!");
    window.setTimeout(() => setCopyStatus(""), 2000);
  }

  return (
    <section aria-label="Developer API access">
      <article className="profile-page-google-card">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-sm">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </span>
            <div>
              <h2>Developer API</h2>
              <p className="small family-page-subhead !mb-0 max-w-prose">
                Create scoped, read-only bearer tokens for assistants and automations. Each token is capped at 1,000
                requests per day.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a className="menu-action-link" href="/docs/api">
              <span className="menu-action-link-label">
                <svg className="menu-action-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                API docs
              </span>
            </a>
            <Button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setRawToken("");
                setCreateOpen(true);
              }}
            >
              New token
            </Button>
          </div>
        </div>

        {error ? <Alert>API access error: {error}</Alert> : null}

        {/* One-time token reveal */}
        {rawToken ? (
          <div className="rounded-xl border border-emerald-300 bg-gradient-to-b from-emerald-50 to-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-emerald-800">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <p className="m-0 text-sm font-semibold">Token created — copy it now</p>
            </div>
            <p className="small mt-1 mb-3 text-emerald-700/90">
              This is the only time the full token will be shown. Store it in your assistant or automation platform.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-slate-900 px-3 py-2.5 font-mono text-xs text-emerald-200">
                {rawToken}
              </code>
              <Button type="button" className="btn btn-primary" onClick={copyRawToken}>
                {copyStatus || "Copy token"}
              </Button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 py-2 text-slate-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-500" />
            <p className="small m-0">Loading API tokens…</p>
          </div>
        ) : null}

        {/* Empty state */}
        {!loading && !hasTokens ? (
          <Alert tone="info">
            <p className="m-0 font-semibold">No tokens yet</p>
            <p className="small mt-1">
              Tokens are read-only, limited by your existing family permissions, capped at 1,000 requests per day, and
              every request is audited and rate-limited.
            </p>
            <div className="mt-3 flex flex-col gap-3">
              <div className="rounded-lg bg-white/60 p-3">
                <p className="small m-0 font-semibold text-slate-700">“Hey Google, how many coins do I have?”</p>
                <p className="small m-0 mt-1 text-slate-600">
                  Create a token with <code>read:players</code> and <code>read:coins</code>, then call{" "}
                  <code>GET /api/v1/players</code> to find the player and{" "}
                  <code>GET /api/v1/players/{`{playerId}`}/coins</code> to read the balance.
                </p>
              </div>
              <div className="rounded-lg bg-white/60 p-3">
                <p className="small m-0 font-semibold text-slate-700">“What chore should I work on next?”</p>
                <p className="small m-0 mt-1 text-slate-600">
                  Add <code>read:chores</code> and call{" "}
                  <code>GET /api/v1/players/{`{playerId}`}/chores/today</code>, then let your assistant pick the next
                  open chore.
                </p>
              </div>
            </div>
            <div className="mt-4">
              <Button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setRawToken("");
                  setCreateOpen(true);
                }}
              >
                Create your first token
              </Button>
            </div>
          </Alert>
        ) : null}

        {/* Existing tokens */}
        {hasTokens ? (
          <div className="flex flex-col gap-3">
            <h3 className="m-0 text-sm font-semibold text-slate-800">
              Your tokens
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {payload?.tokens.length}
              </span>
            </h3>
            {(payload?.tokens ?? []).map((token) => {
              const usagePct = token.usage.limit
                ? Math.min(100, Math.round((token.usage.usedToday / token.usage.limit) * 100))
                : 0;
              const usageTone =
                usagePct >= 90 ? "bg-red-500" : usagePct >= 70 ? "bg-amber-500" : "bg-sky-500";
              return (
                <div
                  key={token.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="m-0 text-base font-semibold text-slate-900">{token.name}</h4>
                        <StatusBadge status={token.status} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-500">
                        <span className="small">created {formatDateTime(token.createdAt)}</span>
                      </div>

                      {token.scopes.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {token.scopes.map((scope) => (
                            <span
                              key={scope}
                              className="rounded-full bg-sky-50 px-2 py-0.5 font-mono text-[0.7rem] text-sky-700 ring-1 ring-inset ring-sky-600/10"
                            >
                              {scope}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {/* Usage meter */}
                      <div className="mt-3 max-w-xs">
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>Today’s usage</span>
                          <span className="font-medium text-slate-700">
                            {token.usage.usedToday.toLocaleString()} / {token.usage.limit.toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${usageTone} transition-all`} style={{ width: `${usagePct}%` }} />
                        </div>
                        <p className="small m-0 mt-1 text-slate-400">
                          {token.usage.remainingToday.toLocaleString()} remaining · resets {formatDateTime(token.usage.resetAt)}
                        </p>
                      </div>

                      <div className="mt-2 flex flex-col gap-0.5">
                        <p className="small m-0 text-slate-500">Last used: {formatDateTime(token.lastUsedAt)}</p>
                        {token.lastErrorCode ? (
                          <p className="small m-0 text-red-600">
                            Last error: {token.lastErrorCode} at {formatDateTime(token.lastErrorAt)}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-row flex-wrap gap-2 md:flex-col md:items-stretch">
                      <Button
                        type="button"
                        className="btn btn-secondary"
                        disabled={token.status !== "active" || Boolean(pendingAction)}
                        onClick={() => updateToken(token.id, "disable")}
                      >
                        {pendingAction === `disable:${token.id}` ? "Disabling…" : "Disable"}
                      </Button>
                      <Button
                        type="button"
                        className="btn btn-secondary"
                        disabled={token.status === "deleted" || Boolean(pendingAction)}
                        onClick={() => updateToken(token.id, "regenerate")}
                      >
                        {pendingAction === `regenerate:${token.id}` ? "Re-issuing…" : "Re-issue"}
                      </Button>
                      <Button
                        type="button"
                        className="btn btn-secondary !text-red-600"
                        disabled={token.status === "deleted" || Boolean(pendingAction)}
                        onClick={() => updateToken(token.id, "delete")}
                      >
                        {pendingAction === `delete:${token.id}` ? "Deleting…" : "Delete"}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Usage & audit */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="m-0 text-sm font-semibold text-slate-800">Usage &amp; audit trail</h3>
                <span className="small text-slate-500">{trendTotal.toLocaleString()} successful calls · last 7 days</span>
              </div>

              {/* Mini bar chart */}
              <div className="mt-4 flex items-end justify-between gap-2" style={{ height: "84px" }}>
                {sevenDayTrend.map((entry) => {
                  const heightPct = Math.round((entry.count / trendMax) * 100);
                  return (
                    <div key={entry.day} className="flex flex-1 flex-col items-center gap-1">
                      <div className="flex w-full flex-1 items-end">
                        <div
                          className="w-full rounded-t bg-gradient-to-t from-sky-500 to-indigo-400 transition-all"
                          style={{ height: `${Math.max(heightPct, entry.count > 0 ? 8 : 2)}%`, minHeight: "2px" }}
                          title={`${entry.day}: ${entry.count}`}
                        />
                      </div>
                      <span className="text-[0.65rem] tabular-nums text-slate-400">{entry.day.slice(5)}</span>
                    </div>
                  );
                })}
              </div>

              {/* Recent events */}
              <div className="mt-4 overflow-hidden rounded-lg border border-slate-100">
                {(payload?.auditEvents ?? []).length === 0 ? (
                  <p className="small m-0 px-3 py-4 text-center text-slate-400">No recent API activity.</p>
                ) : (
                  (payload?.auditEvents ?? []).slice(0, 10).map((event, index) => (
                    <div
                      key={event.id}
                      className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs ${
                        index % 2 ? "bg-slate-50/60" : "bg-white"
                      }`}
                    >
                      <span className={`rounded px-1.5 py-0.5 font-semibold tabular-nums ${statusCodeTone(event.statusCode)}`}>
                        {event.statusCode}
                      </span>
                      <span className="font-mono font-semibold text-slate-500">{event.method}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-slate-600">{event.endpoint}</span>
                      <span className="text-slate-400">{formatDateTime(event.createdAt)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}
      </article>

      {/* Create token modal */}
      <ModalShell open={createOpen} onRequestClose={() => (pendingAction ? undefined : setCreateOpen(false))}>
        <section className="flex flex-col gap-4 p-1" aria-label="Create API token">
          <header className="modal-dialog-title-row">
            <h3 className="m-0">Create a new token</h3>
            <Button
              type="button"
              className="modal-close-button"
              onClick={() => setCreateOpen(false)}
              disabled={Boolean(pendingAction)}
              aria-label="Close dialog"
              title="Close dialog"
            >
              X
            </Button>
          </header>

          <p className="small m-0 text-slate-600">
            Tokens are read-only, scoped to your family permissions, and capped at 1,000 requests per day. The full
            token is shown only once after creation.
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">Token label</span>
            <input
              value={tokenName}
              onChange={(event) => setTokenName(event.target.value)}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-slate-800 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200"
              placeholder="e.g. Home assistant"
              autoFocus
            />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-700">Scopes</span>
            <div className="flex flex-wrap gap-2">
              {availableScopes.map((scope) => {
                const checked = selectedScopes.includes(scope);
                return (
                  <button
                    key={scope}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggleScope(scope)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                      checked
                        ? "border-sky-500 bg-sky-50 text-sky-800 shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                        checked ? "border-sky-500 bg-sky-500 text-white" : "border-slate-300 bg-white"
                      }`}
                    >
                      {checked ? (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      ) : null}
                    </span>
                    {scopeLabel(scope)}
                    <code className="font-mono text-[0.7rem] text-slate-400">{scope}</code>
                  </button>
                );
              })}
            </div>
            {selectedScopes.length === 0 ? (
              <span className="small text-slate-500">Select at least one scope.</span>
            ) : null}
          </div>

          {error ? <Alert>Could not create token: {error}</Alert> : null}

          <div className="modal-dialog-title-row mt-1 justify-end gap-2">
            <Button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCreateOpen(false)}
              disabled={Boolean(pendingAction)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="btn btn-primary"
              disabled={pendingAction === "create" || !tokenName.trim() || selectedScopes.length === 0}
              onClick={createToken}
            >
              {pendingAction === "create" ? "Creating…" : "Create token"}
            </Button>
          </div>
        </section>
      </ModalShell>
    </section>
  );
}
