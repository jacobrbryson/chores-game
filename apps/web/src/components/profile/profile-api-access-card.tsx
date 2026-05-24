"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";

type ApiTokenSummary = {
  id: string;
  name: string;
  status: "active" | "disabled" | "deleted";
  tokenPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedEndpoint: string | null;
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
  auditEvents: ApiAuditSummary[];
};

const DEFAULT_SCOPES = ["read:profile", "read:players", "read:coins"];

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

export function ProfileApiAccessCard() {
  const [payload, setPayload] = useState<ApiAccessPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState(DEFAULT_SCOPES);
  const [rawToken, setRawToken] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

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
    const events = payload?.auditEvents ?? [];
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      return date.toISOString().slice(0, 10);
    });
    return days.map((day) => ({
      day,
      count: events.filter((event) => event.eventType === "token.used" && event.createdAt.slice(0, 10) === day).length,
    }));
  }, [payload?.auditEvents]);

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
    setCopyStatus("Copied.");
    window.setTimeout(() => setCopyStatus(""), 2000);
  }

  return (
    <section aria-label="Developer API access">
      <article className="profile-page-google-card">
        <div className="family-page-card-header">
          <div>
            <h2>Developer API</h2>
            <p className="small family-page-subhead">
              Create scoped bearer tokens for assistants and automations. Tokens are limited to 1,000 requests per day.
            </p>
          </div>
          <a className="menu-action-link" href="/docs/api">
            API docs
          </a>
        </div>

        {error ? <Alert>API access error: {error}</Alert> : null}
        {rawToken ? (
          <Alert>
            Copy this token now. It will not be shown again.
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-slate-900 px-3 py-2 text-xs text-white">
                {rawToken}
              </code>
              <Button type="button" className="btn btn-secondary" onClick={copyRawToken}>
                {copyStatus || "Copy"}
              </Button>
            </div>
          </Alert>
        ) : null}

        <div className="grid gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">Token label</span>
            <input
              value={tokenName}
              onChange={(event) => setTokenName(event.target.value)}
              className="h-10 rounded-md border border-slate-300 px-3 py-2 text-slate-800"
              placeholder="Home assistant"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {(payload?.scopes ?? DEFAULT_SCOPES).map((scope) => (
              <label key={scope} className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={selectedScopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                />
                {scope}
              </label>
            ))}
          </div>
          <div>
            <Button
              type="button"
              className="btn btn-primary"
              disabled={pendingAction === "create" || !tokenName.trim() || selectedScopes.length === 0}
              onClick={createToken}
            >
              {pendingAction === "create" ? "Creating..." : "Create token"}
            </Button>
          </div>
        </div>

        {loading ? <p className="small mt-6">Loading API tokens...</p> : null}

        {!loading && !hasTokens ? (
          <Alert tone="info" className="mt-6">
            This token can only read the scopes you select here, such as your profile, visible players, coin balances,
            today's chores, and recent achievements. Tokens are read-only, limited by your existing family permissions,
            capped at 1,000 requests per day, and every request is audited and rate-limited.
            <div className="mt-3 grid gap-2">
              <p className="small">
                To support prompts like "Hey Google, how many coins do I have?", create a token with at least
                `read:players` and `read:coins`, then have your assistant call `GET /api/v1/players` to find the visible
                player and `GET /api/v1/players/{`playerId`}/coins` to read the balance.
              </p>
              <p className="small">
                For "What chore should I work on next?", add `read:chores` and call
                `GET /api/v1/players/{`playerId`}/chores/today`, then let your assistant choose the next open chore from
                that list. The raw token is only shown once after creation, so you would store it in the assistant or
                automation platform that makes those API calls.
              </p>
            </div>
          </Alert>
        ) : null}

        {hasTokens ? (
          <>
            <div className="mt-6 grid gap-3">
              <h3>Existing tokens</h3>
              {(payload?.tokens ?? []).map((token) => (
                <div key={token.id} className="rounded-xl border border-slate-200 bg-white/80 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h4>{token.name}</h4>
                      <p className="small">
                        {token.tokenPrefix} · {token.status} · created {formatDateTime(token.createdAt)}
                      </p>
                      <p className="small">
                        Used today: {token.usage.usedToday}/{token.usage.limit} · remaining: {token.usage.remainingToday}
                      </p>
                      <p className="small">
                        Last used: {formatDateTime(token.lastUsedAt)}
                        {token.lastUsedEndpoint ? ` at ${token.lastUsedEndpoint}` : ""}
                      </p>
                      {token.lastErrorCode ? (
                        <p className="small">
                          Last error: {token.lastErrorCode} at {formatDateTime(token.lastErrorAt)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className="btn btn-secondary"
                        disabled={token.status !== "active" || Boolean(pendingAction)}
                        onClick={() => updateToken(token.id, "disable")}
                      >
                        Disable
                      </Button>
                      <Button
                        type="button"
                        className="btn btn-secondary"
                        disabled={token.status === "deleted" || Boolean(pendingAction)}
                        onClick={() => updateToken(token.id, "regenerate")}
                      >
                        Re-issue
                      </Button>
                      <Button
                        type="button"
                        className="btn btn-secondary"
                        disabled={token.status === "deleted" || Boolean(pendingAction)}
                        onClick={() => updateToken(token.id, "delete")}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-3">
              <h3>Usage and audit trail</h3>
              <p className="small">
                7-day successful request trend: {sevenDayTrend.map((entry) => `${entry.day.slice(5)}: ${entry.count}`).join(" · ")}
              </p>
              {(payload?.auditEvents ?? []).slice(0, 10).map((event) => (
                <p key={event.id} className="small">
                  {formatDateTime(event.createdAt)} · {event.eventType} · {event.method} {event.endpoint} · {event.statusCode}
                </p>
              ))}
            </div>
          </>
        ) : null}
      </article>
    </section>
  );
}
