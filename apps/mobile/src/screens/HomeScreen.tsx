import React from "react";
import { AppScreen } from "@/components/ui";
import { MobileDashboardChoresPanel } from "@/components/MobileDashboardChoresPanel";

type Props = {
  right?: React.ReactNode;
  onGoDashboard?: () => void;
  onOpenAllChores?: () => void;
};

export function HomeScreen({ right, onOpenAllChores }: Props) {
  return (
    <AppScreen title="Dashboard" right={right}>
      <MobileDashboardChoresPanel onOpenAllChores={onOpenAllChores} />
    </AppScreen>
  );
}
