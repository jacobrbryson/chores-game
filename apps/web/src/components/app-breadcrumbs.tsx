"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { humanizeEnum } from "@/components/enum-chip";
import { useLocale } from "@/components/locale-provider";
import { getWebBreadcrumbSubtitle, getWebBreadcrumbTrail } from "@/lib/ui/breadcrumbs";
import { useNotFound } from "@/lib/not-found-context";

type AppBreadcrumbsProps = {
  hideGuestHomepage?: boolean;
};

export function AppBreadcrumbs({ hideGuestHomepage = false }: AppBreadcrumbsProps) {
  const pathname = usePathname();
  const { t } = useLocale();
  const { isNotFound } = useNotFound();

  const [memberBreadcrumb, setMemberBreadcrumb] = useState<{
    name: string;
    status: "active" | "invited";
    lastSignInAt?: string;
  } | null>(null);

  function formatSignInDate(value?: string) {
    if (!value) {
      return "Never";
    }

    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return "Never";
    }

    return new Intl.DateTimeFormat(undefined, {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    }).format(new Date(parsed));
  }

  const familyMemberMatch = useMemo(() => pathname.match(/^\/family\/([^/]+)$/), [pathname]);
  const familyMemberId = familyMemberMatch?.[1] ?? "";

  useEffect(() => {
    if (!familyMemberId) {
      setMemberBreadcrumb(null);
      return;
    }

    setMemberBreadcrumb(null);
    const controller = new AbortController();

    async function loadMemberBreadcrumb() {
      try {
        const response = await fetch(`/api/family/members/${encodeURIComponent(familyMemberId)}/profile`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          setMemberBreadcrumb(null);
          return;
        }
        const payload = (await response.json()) as {
          member?: {
            name?: string;
            status?: "active" | "invited";
            lastSignInAt?: string;
          };
        };
        if (!controller.signal.aborted && payload.member?.name && payload.member?.status) {
          setMemberBreadcrumb({
            name: payload.member.name,
            status: payload.member.status,
            lastSignInAt: payload.member.lastSignInAt,
          });
        }
      } catch {
        if (!controller.signal.aborted) {
          setMemberBreadcrumb(null);
        }
      }
    }

    void loadMemberBreadcrumb();

    return () => controller.abort();
  }, [familyMemberId]);

  const items = useMemo(() => {
    const baseItems = getWebBreadcrumbTrail(pathname, t);
    if (!memberBreadcrumb || baseItems.length === 0) {
      return baseItems;
    }

    const nextItems = [...baseItems];
    nextItems[nextItems.length - 1] = {
      ...nextItems[nextItems.length - 1],
      label: memberBreadcrumb.name,
    };
    return nextItems;
  }, [memberBreadcrumb, pathname, t]);

  if (isNotFound) {
    return null;
  }

  if (hideGuestHomepage && pathname === "/") {
    return null;
  }

  const subtitle = getWebBreadcrumbSubtitle(pathname, t);
  const subtitleContent: ReactNode = memberBreadcrumb ? (
    <span className="app-breadcrumb-subtitle-detail">
      <span className="app-breadcrumb-subtitle-email">
        {t("family.lastSignIn")}: {formatSignInDate(memberBreadcrumb.lastSignInAt)} ({humanizeEnum(memberBreadcrumb.status)})
      </span>
    </span>
  ) : (
    subtitle
  );
  const disableRootLink = pathname === "/";

  return (
    <div className="app-breadcrumbs">
      <nav aria-label={t("breadcrumbs.rootAriaLabel")}>
        <ol className="app-breadcrumb-list">
          {items.map((item, index) => {
            const isCurrent = index === items.length - 1;
            const isRoot = index === 0;

            const content = (
              <>
                {isRoot ? (
                  <Image
                    src="/icons/web-app-manifest-192x192.png"
                    alt=""
                    width={22}
                    height={22}
                    className="app-breadcrumb-logo"
                  />
                ) : null}
                <span className="app-breadcrumb-text">{item.label}</span>
              </>
            );

            return (
              <li key={`${item.label}-${index}`} className="app-breadcrumb-item">
                {item.href && !isCurrent && !(isRoot && disableRootLink) ? (
                  <Link href={item.href} className={`app-breadcrumb-link${isRoot ? " app-breadcrumb-root" : ""}`}>
                    {content}
                  </Link>
                ) : (
                  <span
                    className={`app-breadcrumb-current${isRoot ? " app-breadcrumb-root" : ""}`}
                    aria-current={isCurrent ? "page" : undefined}>
                    {content}
                  </span>
                )}
                {!isCurrent ? (
                  <span className="app-breadcrumb-separator" aria-hidden="true">
                    &rarr;
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </nav>
      {subtitleContent ? <div className="app-breadcrumb-subtitle">{subtitleContent}</div> : null}
    </div>
  );
}
