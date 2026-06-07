"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { mainNavigationItems, type MainNavigationItemId } from "@/lib/ui/main-navigation";
import { useLocale } from "@/components/locale-provider";
import { DiscoveryBadge } from "@/components/discovery-badge";
import { MainNavIcon } from "@/components/main-nav-icons";
import { ProfileMenu } from "@/components/profile-menu";
import { getSectionCount, useDiscoverySummary } from "@/lib/hooks/use-discovery";

// Maps each top-nav destination to the discovery section whose unseen count it
// surfaces. The Dashboard item carries the Chores count; the profile ("more")
// menu has no badge.
const NAV_DISCOVERY_SECTION: Partial<Record<MainNavigationItemId, string>> = {
  dashboard: "chores",
  store: "store",
  achievements: "achievements",
  quests: "quests",
};

type MainNavigationProps = {
  sessionUser: {
    name: string;
    email: string;
    picture?: string;
  };
  profileInitial: string;
  authenticatedName: string;
  isSwitched: boolean;
  showSupportLink: boolean;
};

function isActiveRoute(pathname: string, href?: string) {
  if (!href) {
    return false;
  }
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MainNavigation({
  sessionUser,
  profileInitial,
  authenticatedName,
  isSwitched,
  showSupportLink,
}: MainNavigationProps) {
  const pathname = usePathname();
  const { t } = useLocale();
  const { summary } = useDiscoverySummary();

  return (
    <nav className="main-nav" aria-label="Primary navigation">
      {mainNavigationItems.map((item) => {
        if (item.id === "more") {
          return (
            <ProfileMenu
              key={item.id}
              name={sessionUser.name || ""}
              email={sessionUser.email}
              picture={sessionUser.picture}
              initial={profileInitial}
              isSwitched={isSwitched}
              authenticatedName={authenticatedName}
              showSupportLink={showSupportLink}
              triggerVariant="main-nav"
              triggerLabel={t(`nav.${item.id}` as const)}
            />
          );
        }

        const active = isActiveRoute(pathname, item.href);
        const discoverySection = NAV_DISCOVERY_SECTION[item.id];
        const discoveryCount = discoverySection ? getSectionCount(summary, discoverySection) : 0;
        return (
          <Link
            key={item.id}
            href={item.href || "/"}
            className={`main-nav-button${active ? " main-nav-button-active" : ""}`}
            aria-current={active ? "page" : undefined}>
            <span className="main-nav-icon">
              <MainNavIcon icon={item.icon} />
            </span>
            <span className="main-nav-label">
              {t(`nav.${item.id}` as const)}
              <DiscoveryBadge count={discoveryCount} />
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
