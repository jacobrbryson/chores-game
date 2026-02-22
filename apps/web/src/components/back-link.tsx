"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type BackLinkProps = {
  className?: string;
  children?: string;
};

function hasSameOriginHistory() {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.history.length <= 1) {
    return false;
  }
  const referrer = document.referrer;
  if (!referrer) {
    return false;
  }
  try {
    const referrerUrl = new URL(referrer);
    return referrerUrl.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function BackLink({ className = "family-back-link", children = "Back" }: BackLinkProps) {
  const router = useRouter();

  return (
    <Link
      href="/"
      className={className}
      onClick={(event) => {
        event.preventDefault();
        if (hasSameOriginHistory()) {
          router.back();
          return;
        }
        router.push("/");
      }}>
      {children}
    </Link>
  );
}
