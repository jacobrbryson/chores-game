"use client";

import type { ReactNode } from "react";

type AlertTone = "error" | "warning" | "info" | "success";

type AlertProps = {
  children: ReactNode;
  tone?: AlertTone;
  className?: string;
  role?: "alert" | "status";
  align?: "start" | "center";
  showIcon?: boolean;
};

const TONE_CLASSES: Record<AlertTone, string> = {
  error: "border-red-300 bg-red-50 text-red-700",
  warning: "border-amber-300 bg-amber-50 text-amber-800",
  info: "border-sky-300 bg-sky-50 text-sky-800",
  success: "border-emerald-300 bg-emerald-50 text-emerald-800",
};

function joinClassNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

function AlertIcon({ tone }: { tone: AlertTone }) {
  if (tone === "success") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 shrink-0">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.03-9.28a.75.75 0 0 0-1.06-1.06L8.75 10.88 7.53 9.66a.75.75 0 0 0-1.06 1.06l1.75 1.75a.75.75 0 0 0 1.06 0l3.75-3.75Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  if (tone === "info") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 shrink-0">
        <path
          fillRule="evenodd"
          d="M18 10A8 8 0 1 1 2 10a8 8 0 0 1 16 0ZM9 8.75A.75.75 0 0 1 9.75 8h.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1-.75-.75v-4.5ZM10 6.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 shrink-0">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-.75-11a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0V7Zm.75 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function Alert({
  children,
  tone = "error",
  className,
  role = "alert",
  align = "start",
  showIcon = true,
}: AlertProps) {
  return (
    <div
      role={role}
      className={joinClassNames(
        "flex gap-2 rounded-md border px-3 py-2 text-sm leading-5",
        align === "center" ? "items-center" : "items-start",
        TONE_CLASSES[tone],
        className,
      )}>
      {showIcon ? <AlertIcon tone={tone} /> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
