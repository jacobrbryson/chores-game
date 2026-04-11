"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  buildNavigationHref,
  getNavigationPathname,
  isNavigableAppRoute,
  readNavigationRouteStack,
  writeNavigationRouteStack,
} from "@/lib/navigation-history";

function resolveReferrerRoute() {
  if (typeof window === "undefined") {
    return null;
  }
  const referrer = document.referrer;
  if (!referrer) {
    return null;
  }
  try {
    const url = new URL(referrer);
    if (url.origin !== window.location.origin) {
      return null;
    }
    const route = `${url.pathname}${url.search}`;
    return isNavigableAppRoute(route) ? route : null;
  } catch {
    return null;
  }
}

export function NavigationHistoryTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const didInitializeRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextPathname = pathname || "/";
    const search = searchParams?.toString();
    const nextRoute = buildNavigationHref(nextPathname, search ? `?${search}` : "");

    try {
      if (!didInitializeRef.current) {
        const referrerRoute = resolveReferrerRoute();
        const initialStack =
          referrerRoute && referrerRoute !== nextRoute ? [referrerRoute, nextRoute] : [nextRoute];
        writeNavigationRouteStack(initialStack);
        didInitializeRef.current = true;
        return;
      }

      const stack = readNavigationRouteStack();
      const currentRoute = stack[stack.length - 1];
      if (currentRoute === nextRoute) {
        return;
      }

      if (!isNavigableAppRoute(currentRoute)) {
        writeNavigationRouteStack([nextRoute]);
        return;
      }

      const nextStack = [...stack];
      if (getNavigationPathname(currentRoute) === nextPathname) {
        nextStack[nextStack.length - 1] = nextRoute;
      } else {
        nextStack.push(nextRoute);
      }
      writeNavigationRouteStack(nextStack);
    } catch {
      // Ignore storage access failures and fall back to page-specific root routes.
    }
  }, [pathname, searchParams]);

  return null;
}
