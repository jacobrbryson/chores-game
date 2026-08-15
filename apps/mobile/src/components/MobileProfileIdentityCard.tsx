import React from "react";
import { hasEarnedIdentity } from "@packages/core";
import { useResponsibilityIdentities } from "@/lib/responsibility-identity";
import { useMobileLocale } from "@/lib/locale";
import { MobileIdentitySummaryStrip } from "@/components/MobileIdentitySummaryStrip";
import { Card, SectionHeader } from "@/components/ui";

// "Who they are" identity card for a profile: the child's earned pillar titles.
// The mobile counterpart of web's ProfileIdentityCard — self-fetching, and it
// renders nothing until at least one title is earned so it never shows an empty
// shell for a brand-new member.
export function MobileProfileIdentityCard({ memberId }: { memberId?: string }) {
  const { t } = useMobileLocale();
  const identities = useResponsibilityIdentities(memberId);

  if (!identities || identities.every((entry) => !hasEarnedIdentity(entry))) {
    return null;
  }

  return (
    <Card>
      <SectionHeader title={t("responsibility.identity.earnedIdentities")} />
      <MobileIdentitySummaryStrip identities={identities} limit={3} variant="rows" />
    </Card>
  );
}
