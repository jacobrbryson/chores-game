"use client";

import type { ReactNode } from "react";
import { AppTabs, type AppTabItem } from "@/components/app-tabs";
import { SUPPORT_MODULES, type SupportModuleId } from "@/lib/support/modules";

export type { SupportModuleId } from "@/lib/support/modules";

export function SupportConsoleShell({
  activeModule,
  children,
}: {
  activeModule: SupportModuleId;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const tabs: AppTabItem<SupportModuleId>[] = SUPPORT_MODULES.map((module) => ({
    id: module.id,
    label: module.label,
    href: module.href,
  }));

  return (
    <main className="flex w-full flex-col gap-4 px-3 py-4 sm:px-5">
      <section className="app-tab-panel">
        <div className="app-tab-panel-header px-4 pt-3">
          <AppTabs
            ariaLabel="Support modules"
            tabs={tabs}
            activeTab={activeModule}
            variant="tabs"
          />
        </div>
        <div className="app-tab-panel-body flex min-w-0 flex-col gap-5 p-4 sm:p-5">
          {children}
        </div>
      </section>
    </main>
  );
}
