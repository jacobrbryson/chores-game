import { familyChoresBrand } from "./brand";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

type Translate = (key: string) => string;

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

function buildFallbackWebTrail(segments: string[], t: Translate) {
  if (segments.length === 0) {
    return createBreadcrumbTrail([{ label: t("breadcrumbs.dashboard") }]);
  }

  const startIndex = Math.max(0, segments.length - 2);
  const items = segments.slice(startIndex).map((segment, index, source) => {
    const absoluteIndex = startIndex + index;
    const isCurrent = index === source.length - 1;

    return {
      label: humanizeSegment(segment) || t("breadcrumbs.page"),
      href: isCurrent ? undefined : `/${segments.slice(0, absoluteIndex + 1).join("/")}`,
    };
  });

  return createBreadcrumbTrail(items);
}

export function getWebBreadcrumbTrail(pathname: string, t: Translate): BreadcrumbItem[] {
  const pathOnly = pathname.split("?")[0] ?? pathname;
  const segments = pathOnly.split("/").filter(Boolean);

  if (segments.length === 0) {
    return createBreadcrumbTrail([{ label: t("breadcrumbs.dashboard") }]);
  }

  if (segments[0] === "chores") {
    return createBreadcrumbTrail([{ label: t("breadcrumbs.chores") }]);
  }

  if (segments[0] === "notifications") {
    return createBreadcrumbTrail([{ label: t("breadcrumbs.notifications") }]);
  }

  if (segments[0] === "profile") {
    return createBreadcrumbTrail([{ label: t("breadcrumbs.profile") }]);
  }

  if (segments[0] === "change-log") {
    if (segments.length > 1) {
      return createBreadcrumbTrail([
        { label: t("breadcrumbs.changeLog"), href: "/change-log" },
        { label: decodePathSegment(segments[1]) || t("breadcrumbs.page") },
      ]);
    }
    return createBreadcrumbTrail([{ label: t("breadcrumbs.changeLog") }]);
  }

  if (segments[0] === "store") {
    return createBreadcrumbTrail([{ label: t("breadcrumbs.store") }]);
  }

  if (segments[0] === "achievements") {
    return createBreadcrumbTrail([{ label: t("breadcrumbs.achievements") }]);
  }

  if (segments[0] === "quests") {
    if (segments.length === 1) {
      return createBreadcrumbTrail([{ label: t("breadcrumbs.quests") }]);
    }

    return createBreadcrumbTrail([
      { label: t("breadcrumbs.quests"), href: "/quests" },
      { label: t("breadcrumbs.quest") },
    ]);
  }

  if (segments[0] === "family") {
    if (segments.length === 1) {
      return createBreadcrumbTrail([{ label: t("breadcrumbs.family") }]);
    }

    if (segments[1] === "quests") {
      if (segments[2] === "new") {
        return createBreadcrumbTrail([
          { label: t("breadcrumbs.family"), href: "/family" },
          { label: t("breadcrumbs.newQuest") },
        ]);
      }

      return createBreadcrumbTrail([
        { label: t("breadcrumbs.family"), href: "/family" },
        { label: t("breadcrumbs.quest") },
      ]);
    }

    if (segments[2] === "items") {
      return createBreadcrumbTrail([
        { label: t("breadcrumbs.family"), href: "/family" },
        { label: t("breadcrumbs.items") },
      ]);
    }

    if (segments[2] === "awards") {
      return createBreadcrumbTrail([
        { label: t("breadcrumbs.family"), href: "/family" },
        { label: t("breadcrumbs.awards") },
      ]);
    }

    return createBreadcrumbTrail([
      { label: t("breadcrumbs.family"), href: "/family" },
      { label: t("breadcrumbs.member") },
    ]);
  }

  if (segments[0] === "docs" && segments[1] === "api") {
    return createBreadcrumbTrail([
      { label: t("breadcrumbs.docs"), href: "/docs/api" },
      { label: t("breadcrumbs.api") },
    ]);
  }

  if (segments[0] === "support") {
    return createBreadcrumbTrail([{ label: t("breadcrumbs.support") }]);
  }

  if (segments[0] === "privacy-policy") {
    return createBreadcrumbTrail([{ label: t("breadcrumbs.privacyPolicy") }]);
  }

  if (segments[0] === "terms-of-service") {
    return createBreadcrumbTrail([{ label: t("breadcrumbs.termsOfService") }]);
  }

  return buildFallbackWebTrail(segments, t);
}

export function getWebBreadcrumbSubtitle(pathname: string, t: Translate): string | undefined {
  const pathOnly = pathname.split("?")[0] ?? pathname;
  const segments = pathOnly.split("/").filter(Boolean);

  if (segments.length === 0) {
    return t("breadcrumbs.dashboardSubtitle");
  }

  if (segments[0] === "chores") {
    return t("breadcrumbs.choresSubtitle");
  }

  if (segments[0] === "profile") {
    return t("breadcrumbs.profileSubtitle");
  }

  if (segments[0] === "docs" && segments[1] === "api") {
    return t("breadcrumbs.apiSubtitle");
  }

  if (segments[0] === "change-log") {
    return t("breadcrumbs.changeLogSubtitle");
  }

  return undefined;
}
