"use client";

import type { ReactNode } from "react";
import { AppTabs, type AppTabItem } from "@/components/app-tabs";
import { SUPPORT_MODULES, SUPPORT_PRIMARY_MODULE_IDS, type SupportModuleId } from "@/lib/support/modules";

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
  const toTabs = (modules: typeof SUPPORT_MODULES): AppTabItem<SupportModuleId>[] =>
    modules.map((module) => ({
      id: module.id,
      label: module.label,
      href: module.href,
    }));

  const primaryModules = SUPPORT_MODULES.filter((module) =>
    SUPPORT_PRIMARY_MODULE_IDS.includes(module.id),
  );
  const secondaryModules = SUPPORT_MODULES.filter(
    (module) => !SUPPORT_PRIMARY_MODULE_IDS.includes(module.id),
  );
  const isPrimaryActive = SUPPORT_PRIMARY_MODULE_IDS.includes(activeModule);

  return (
    <main className="flex w-full flex-col gap-4 py-4">
      <section className="app-tab-panel">
        <div className="app-tab-panel-header px-4 pt-3">
          <AppTabs
            ariaLabel="Support modules"
            tabs={toTabs(primaryModules)}
            activeTab={isPrimaryActive ? activeModule : ("" as SupportModuleId)}
            variant="tabs"
          />
        </div>
        {isPrimaryActive ? (
          <div className="app-tab-panel-body flex min-w-0 flex-col gap-5 p-4 sm:p-5">
            {children}
          </div>
        ) : null}
      </section>

      <section className="app-tab-panel">
        <div className="app-tab-panel-header px-4 pt-3">
          <AppTabs
            ariaLabel="More support modules"
            tabs={toTabs(secondaryModules)}
            activeTab={isPrimaryActive ? ("" as SupportModuleId) : activeModule}
            variant="tabs"
          />
        </div>
        {!isPrimaryActive ? (
          <div className="app-tab-panel-body flex min-w-0 flex-col gap-5 p-4 sm:p-5">
            {children}
          </div>
        ) : null}
      </section>
    </main>
  );
}
