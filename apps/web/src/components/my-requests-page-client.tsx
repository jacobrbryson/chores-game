"use client";

import { BackLink } from "@/components/back-link";
import { MyRequestsList } from "@/components/my-requests-list";
import { useLocale } from "@/components/locale-provider";

export function MyRequestsPageClient() {
  const { t } = useLocale();
  return (
    <main className="panel family-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link" fallbackHref="/profile" />
          <h1>{t("myRequests.pageTitle")}</h1>
        </div>
      </div>
      <MyRequestsList />
    </main>
  );
}
