"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  buildNavigationHref,
  isNavigableAppRoute,
  readNavigationRouteStack,
  writeNavigationRouteStack,
} from "@/lib/navigation-history";

type BackLinkProps = {
  className?: string;
  ariaLabel?: string;
  fallbackHref?: string;
};

function resolveSafeBackTarget(fallbackHref: string) {
  if (typeof window === "undefined") {
    return {
      nextStack: [fallbackHref],
      target: fallbackHref,
    };
  }

  try {
    const currentRoute = buildNavigationHref(window.location.pathname, window.location.search);
    const stack = readNavigationRouteStack();
    if (stack.length > 1 && stack[stack.length - 1] === currentRoute) {
      const nextStack = stack.slice(0, -1);
      const target = nextStack[nextStack.length - 1];
      if (isNavigableAppRoute(target) && target !== currentRoute) {
        return { nextStack, target };
      }
    }
  } catch {
    return {
      nextStack: [fallbackHref],
      target: fallbackHref,
    };
  }

  return {
    nextStack: [fallbackHref],
    target: fallbackHref,
  };
}

export function BackLink({
  className = "family-back-link",
  ariaLabel = "Go back",
  fallbackHref = "/",
}: BackLinkProps) {
  const router = useRouter();

  return (
    <Link
      href={fallbackHref}
      className={className}
      aria-label={ariaLabel}
      title="Back"
      onClick={(event) => {
        event.preventDefault();
        const { nextStack, target } = resolveSafeBackTarget(fallbackHref);
        writeNavigationRouteStack(nextStack);
        router.replace(target);
      }}>
      <span className="back-link-icon" aria-hidden="true">&larr;</span>
    </Link>
  );
}
