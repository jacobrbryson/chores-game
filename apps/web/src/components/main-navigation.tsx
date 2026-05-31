"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { mainNavigationItems } from "@/lib/ui/main-navigation";
import { useLocale } from "@/components/locale-provider";
import { MainNavIcon } from "@/components/main-nav-icons";
import { ProfileMenu } from "@/components/profile-menu";

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
        return (
          <Link
            key={item.id}
            href={item.href || "/"}
            className={`main-nav-button${active ? " main-nav-button-active" : ""}`}
            aria-current={active ? "page" : undefined}>
            <span className="main-nav-icon">
              <MainNavIcon icon={item.icon} />
            </span>
            <span className="main-nav-label">{t(`nav.${item.id}` as const)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
