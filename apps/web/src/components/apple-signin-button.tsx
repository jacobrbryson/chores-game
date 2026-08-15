"use client";

import Script from "next/script";
import { useState } from "react";

declare global {
  interface Window {
    AppleID?: {
      auth: {
        init(config: Record<string, unknown>): void;
        signIn(): Promise<{
          authorization?: { id_token?: string };
          user?: { name?: { firstName?: string; lastName?: string } };
        }>;
      };
    };
  }
}

function randomNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function AppleSignInButton({
  clientId,
  redirectUri,
  label,
  pendingLabel,
  failedMessage,
  className = "",
}: {
  clientId: string;
  redirectUri: string;
  label: string;
  pendingLabel: string;
  failedMessage: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function signIn() {
    if (pending || !window.AppleID) return;
    setPending(true);
    setError("");
    try {
      const rawNonce = randomNonce();
      const hashedNonce = await sha256(rawNonce);
      window.AppleID.auth.init({
        clientId,
        scope: "name email",
        redirectURI: redirectUri,
        usePopup: true,
        nonce: hashedNonce,
        state: randomNonce(),
      });
      const credential = await window.AppleID.auth.signIn();
      const idToken = credential.authorization?.id_token?.trim() ?? "";
      if (!idToken) throw new Error("APPLE_ID_TOKEN_MISSING");
      const response = await fetch("/api/auth/apple", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken, rawNonce, user: credential.user?.name }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { redirect?: string };
      };
      if (!response.ok) throw new Error("APPLE_SESSION_FAILED");
      window.location.assign(payload.data?.redirect || "/");
    } catch (nextError) {
      const code = nextError && typeof nextError === "object" && "error" in nextError
        ? String((nextError as { error?: unknown }).error ?? "")
        : "";
      if (code !== "popup_closed_by_user") setError(failedMessage);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={`apple-signin-stack ${className}`.trim()}>
      <Script
        src="https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js"
        strategy="afterInteractive"
      />
      <button
        type="button"
        className="apple-signin-button"
        disabled={pending}
        title={pending ? pendingLabel : undefined}
        onClick={() => void signIn()}>
        <svg className="apple-signin-logo" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.34-.07 2.28.74 3.08.8 1.19-.24 2.33-.93 3.6-.84 1.5.12 2.63.71 3.38 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.08ZM12.03 7.25C11.88 5.02 13.69 3.18 15.77 3c.29 2.58-2.34 4.5-3.74 4.25Z" />
        </svg>
        <span>{pending ? pendingLabel : label}</span>
      </button>
      {error ? <span className="apple-signin-error" role="alert">{error}</span> : null}
    </div>
  );
}
