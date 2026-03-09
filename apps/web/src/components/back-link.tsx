"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type BackLinkProps = {
  className?: string;
  ariaLabel?: string;
};

function resolveSafeBackTarget() {
  if (typeof window === "undefined") {
    return "/";
  }
  const referrer = document.referrer;
  if (!referrer) {
    return "/";
  }
  try {
    const referrerUrl = new URL(referrer);
    if (referrerUrl.origin !== window.location.origin) {
      return "/";
    }
    const nextPath = `${referrerUrl.pathname}${referrerUrl.search}${referrerUrl.hash}` || "/";
    if (nextPath.startsWith("/api/")) {
      return "/";
    }
    if (nextPath === window.location.pathname + window.location.search + window.location.hash) {
      return "/";
    }
    return nextPath;
  } catch {
    return "/";
  }
}

export function BackLink({ className = "family-back-link", ariaLabel = "Go back" }: BackLinkProps) {
  const router = useRouter();

  return (
    <Link
      href="/"
      className={className}
      aria-label={ariaLabel}
      title="Back"
      onClick={(event) => {
        event.preventDefault();
        router.push(resolveSafeBackTarget());
      }}>
      <span className="back-link-icon" aria-hidden="true">&larr;</span>
    </Link>
  );
}
