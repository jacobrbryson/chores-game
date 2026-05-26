"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getWebBreadcrumbTrail } from "@packages/core/src/breadcrumbs";

export function AppBreadcrumbs() {
  const pathname = usePathname();
  const items = getWebBreadcrumbTrail(pathname);

  return (
    <nav className="app-breadcrumbs" aria-label="Breadcrumb">
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
              {item.href && !isCurrent ? (
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
  );
}
