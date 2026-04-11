export const NAVIGATION_ROUTE_STACK_KEY = "family-chores:navigation:route-stack";

export function buildNavigationHref(pathname: string, search = "") {
  return `${pathname}${search}` || "/";
}

export function isNavigableAppRoute(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("/api/");
}

export function getNavigationPathname(route: string) {
  return route.split("?")[0] || "/";
}

export function readNavigationRouteStack() {
  if (typeof window === "undefined") {
    return [] as string[];
  }

  try {
    const rawValue = sessionStorage.getItem(NAVIGATION_ROUTE_STACK_KEY);
    if (!rawValue) {
      return [] as string[];
    }
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [] as string[];
    }
    return parsed.filter((entry): entry is string => isNavigableAppRoute(entry));
  } catch {
    return [] as string[];
  }
}

export function writeNavigationRouteStack(stack: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedStack = stack.filter((entry): entry is string => isNavigableAppRoute(entry));
  try {
    sessionStorage.setItem(NAVIGATION_ROUTE_STACK_KEY, JSON.stringify(normalizedStack));
  } catch {
    // Ignore storage access failures and fall back to page-specific root routes.
  }
}
