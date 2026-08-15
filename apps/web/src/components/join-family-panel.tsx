"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import {
  formatFamilyInviteCode,
  isValidFamilyInviteCodeShape,
  normalizeFamilyInviteCode,
} from "@/lib/family/invite-code-format";

type JoinFamilyLabels = {
  title: string;
  description: string;
  codeLabel: string;
  codePlaceholder: string;
  submit: string;
  submitting: string;
  success: string;
  successGeneric: string;
  alreadyMember: string;
  help: string;
  errors: Record<string, string>;
};

/** Maps the API's stable error codes onto localized copy. */
const ERROR_KEY_BY_CODE: Record<string, string> = {
  invalid_code: "invalidCode",
  invite_not_found: "inviteNotFound",
  invite_already_used: "inviteAlreadyUsed",
  invite_revoked: "inviteRevoked",
  invite_expired: "inviteExpired",
  invite_locked: "inviteLocked",
  already_in_another_family: "alreadyInAnotherFamily",
  family_member_limit_reached: "familyMemberLimitReached",
  unauthorized: "unauthorized",
};

/**
 * The redemption surface for a signed-in user who did not resolve to a family.
 * Deliberately code-based: it never asks which email the user was invited at,
 * which is what makes it work for Apple private-relay sign-ins and second
 * Google accounts alike.
 */
export function JoinFamilyPanel({
  labels,
  initialCode = "",
}: {
  labels: JoinFamilyLabels;
  initialCode?: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState(() =>
    initialCode ? formatFamilyInviteCode(initialCode) : "",
  );
  const [status, setStatus] = useState<"idle" | "submitting" | "joined">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const normalized = normalizeFamilyInviteCode(code);
  const canSubmit = isValidFamilyInviteCodeShape(normalized) && status !== "submitting";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setStatus("submitting");
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await fetch("/api/family/invitations/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalized }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        familyName?: string;
        alreadyMember?: boolean;
      };

      if (!response.ok) {
        const key = ERROR_KEY_BY_CODE[body.error ?? ""] ?? "failed";
        setErrorMessage(labels.errors[key] ?? labels.errors.failed);
        setStatus("idle");
        return;
      }

      setStatus("joined");
      setSuccessMessage(
        body.alreadyMember
          ? labels.alreadyMember
          : body.familyName
            ? labels.success.replace("{family}", body.familyName)
            : labels.successGeneric,
      );
      // The session cookie was reissued with the new role/member id, so a full
      // refresh is what puts the user into their family dashboard.
      router.refresh();
      window.setTimeout(() => {
        window.location.assign("/");
      }, 1200);
    } catch {
      setErrorMessage(labels.errors.failed);
      setStatus("idle");
    }
  }

  return (
    <section className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold text-slate-900">{labels.title}</h2>
      <p className="mt-2 text-sm text-slate-600">{labels.description}</p>

      {errorMessage ? (
        <div className="mt-4">
          <Alert tone="error">{errorMessage}</Alert>
        </div>
      ) : null}
      {successMessage ? (
        <div className="mt-4">
          <Alert tone="success">{successMessage}</Alert>
        </div>
      ) : null}

      <form className="mt-4 flex flex-col gap-3" onSubmit={onSubmit}>
        <label className="text-sm font-semibold text-slate-700" htmlFor="family-invite-code">
          {labels.codeLabel}
        </label>
        <input
          id="family-invite-code"
          name="code"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-lg tracking-[0.2em] uppercase"
          value={code}
          onChange={(event) => setCode(formatFamilyInviteCode(event.target.value))}
          placeholder={labels.codePlaceholder}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          maxLength={14}
          disabled={status === "joined"}
        />
        <div
          title={
            canSubmit || status !== "idle" ? undefined : labels.errors.invalidCode
          }
          className="inline-flex">
          <Button
            type="submit"
            className="btn btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canSubmit || status === "joined"}>
            {status === "submitting" ? labels.submitting : labels.submit}
          </Button>
        </div>
      </form>

      <p className="mt-4 text-xs text-slate-500">{labels.help}</p>
    </section>
  );
}
