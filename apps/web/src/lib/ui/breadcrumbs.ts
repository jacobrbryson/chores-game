import { familyChoresBrand } from "./brand";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function createBreadcrumbTrail(items: BreadcrumbItem[]): BreadcrumbItem[] {
  return [{ label: familyChoresBrand.title, href: "/" }, ...items];
}

function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function humanizeSegment(segment: string) {
  const normalized = decodePathSegment(segment)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildFallbackWebTrail(segments: string[]) {
  if (segments.length === 0) {
    return createBreadcrumbTrail([{ label: "Dashboard" }]);
  }

  const startIndex = Math.max(0, segments.length - 2);
  const items = segments.slice(startIndex).map((segment, index, source) => {
    const absoluteIndex = startIndex + index;
    const isCurrent = index === source.length - 1;

    return {
      label: humanizeSegment(segment) || "Page",
      href: isCurrent ? undefined : `/${segments.slice(0, absoluteIndex + 1).join("/")}`,
    };
  });

  return createBreadcrumbTrail(items);
}

export function getWebBreadcrumbTrail(pathname: string): BreadcrumbItem[] {
  const pathOnly = pathname.split("?")[0] ?? pathname;
  const segments = pathOnly.split("/").filter(Boolean);

  if (segments.length === 0) {
    return createBreadcrumbTrail([{ label: "Dashboard" }]);
  }

  if (segments[0] === "chores") {
    return createBreadcrumbTrail([{ label: "Chores" }]);
  }

  if (segments[0] === "notifications") {
    return createBreadcrumbTrail([{ label: "Notifications" }]);
  }

  if (segments[0] === "profile") {
    return createBreadcrumbTrail([{ label: "Profile" }]);
  }

  if (segments[0] === "store") {
    return createBreadcrumbTrail([{ label: "Store" }]);
  }

  if (segments[0] === "achievements") {
    return createBreadcrumbTrail([{ label: "Achievements" }]);
  }

  if (segments[0] === "quests") {
    if (segments.length === 1) {
      return createBreadcrumbTrail([{ label: "Quests" }]);
    }

    return createBreadcrumbTrail([
      { label: "Quests", href: "/quests" },
      { label: "Quest" },
    ]);
  }

  if (segments[0] === "family") {
    if (segments.length === 1) {
      return createBreadcrumbTrail([{ label: "Family" }]);
    }

    if (segments[1] === "quests") {
      if (segments[2] === "new") {
        return createBreadcrumbTrail([
          { label: "Family", href: "/family" },
          { label: "New Quest" },
        ]);
      }

      return createBreadcrumbTrail([
        { label: "Family", href: "/family" },
        { label: "Quest" },
      ]);
    }

    if (segments[2] === "items") {
      return createBreadcrumbTrail([
        { label: "Family", href: "/family" },
        { label: "Items" },
      ]);
    }

    if (segments[2] === "awards") {
      return createBreadcrumbTrail([
        { label: "Family", href: "/family" },
        { label: "Awards" },
      ]);
    }

    return createBreadcrumbTrail([
      { label: "Family", href: "/family" },
      { label: "Member" },
    ]);
  }

  if (segments[0] === "docs" && segments[1] === "api") {
    return createBreadcrumbTrail([
      { label: "Docs", href: "/docs/api" },
      { label: "API" },
    ]);
  }

  if (segments[0] === "support") {
    return createBreadcrumbTrail([{ label: "Support" }]);
  }

  if (segments[0] === "privacy-policy") {
    return createBreadcrumbTrail([{ label: "Privacy Policy" }]);
  }

  if (segments[0] === "terms-of-service") {
    return createBreadcrumbTrail([{ label: "Terms of Service" }]);
  }

  return buildFallbackWebTrail(segments);
}

export function getWebBreadcrumbSubtitle(pathname: string): string | undefined {
  const pathOnly = pathname.split("?")[0] ?? pathname;
  const segments = pathOnly.split("/").filter(Boolean);

  if (segments.length === 0) {
    return "View, create, and manage active chores";
  }

  if (segments[0] === "chores") {
    return "Sort, filter, and approve chores";
  }

  if (segments[0] === "profile") {
    return "Your account details and personalization settings.";
  }

  return undefined;
}
