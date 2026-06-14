import {
  RESPONSIBILITY_PILLARS,
  RESPONSIBILITY_PILLAR_EMOJI,
  type ResponsibilityPillar,
} from "@/lib/responsibility/types";

// Client-safe label helpers. Localized pillar names live under the
// `responsibility.pillars.*` locale keys.
export function responsibilityPillarLabel(
  pillar: ResponsibilityPillar,
  t: (key: string) => string,
) {
  return `${RESPONSIBILITY_PILLAR_EMOJI[pillar]} ${t(`responsibility.pillars.${pillar}`)}`;
}

export function responsibilityPillarSelectOptions(t: (key: string) => string) {
  return [
    { value: "" as const, label: t("responsibility.noPillar") },
    ...RESPONSIBILITY_PILLARS.map((pillar) => ({
      value: pillar,
      label: responsibilityPillarLabel(pillar, t),
    })),
  ];
}
