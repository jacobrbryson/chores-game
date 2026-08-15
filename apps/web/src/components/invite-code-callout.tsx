"use client";

import { useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";

export type InviteCodeDetails = {
  code: string;
  formattedCode: string;
  url: string;
  expiresAt: string;
};

export type InviteCodeLabels = {
  codeTitle: string;
  codeHelp: string;
  linkLabel: string;
  copyCode: string;
  copyLink: string;
  copied: string;
};

/**
 * Shows a freshly minted invite code to the inviting parent. The raw code is
 * only ever available at this moment — Firestore stores the hash — so the
 * parent has to copy it now or re-invite to mint a new one.
 */
export function InviteCodeCallout({
  invite,
  memberName,
  labels,
}: {
  invite: InviteCodeDetails;
  memberName: string;
  labels: InviteCodeLabels;
}) {
  const [copied, setCopied] = useState<"code" | "link" | "">("");

  async function copy(value: string, which: "code" | "link") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      // Clipboard access can be blocked; the code stays selectable on screen.
    }
  }

  return (
    <Alert tone="success" align="start">
      <div className="flex w-full flex-col gap-2">
        <span className="font-semibold">{labels.codeTitle}</span>
        <code className="select-all font-mono text-xl tracking-[0.2em]">
          {invite.formattedCode}
        </code>
        <span className="text-xs">{labels.codeHelp.replace("{name}", memberName)}</span>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="btn btn-secondary"
            onClick={() => void copy(invite.formattedCode, "code")}>
            {copied === "code" ? labels.copied : labels.copyCode}
          </Button>
          <Button
            type="button"
            className="btn btn-secondary"
            title={labels.linkLabel}
            onClick={() => void copy(invite.url, "link")}>
            {copied === "link" ? labels.copied : labels.copyLink}
          </Button>
        </div>
      </div>
    </Alert>
  );
}
