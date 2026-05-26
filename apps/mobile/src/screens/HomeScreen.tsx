import React from "react";
import { AppScreen } from "@/components/ui";
import { MobileDashboardChoresPanel } from "@/components/MobileDashboardChoresPanel";

type Props = {
  right?: React.ReactNode;
};

export function HomeScreen({ right }: Props) {
  return (
    <AppScreen title="Dashboard" right={right}>
      <MobileDashboardChoresPanel />
    </AppScreen>
  );
}
