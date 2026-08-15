// Responsibility Pillars: a first-class domain concept describing which life
// skill a chore or routine develops. Pillars are intentionally separate from
// user-defined chore Categories — Categories answer "where does this chore
// belong?", pillars answer "what life skill does this chore develop?".
//
// This lives in @packages/core because both the web dialog and the mobile chore
// editor render the same pillar picker; the list, ordering, and emoji must not
// drift between the two apps.
export const RESPONSIBILITY_PILLARS = [
  "home_care",
  "self_care",
  "organization",
  "family_contribution",
  "life_skills",
] as const;

export type ResponsibilityPillar = (typeof RESPONSIBILITY_PILLARS)[number];

export const RESPONSIBILITY_PILLAR_EMOJI: Record<ResponsibilityPillar, string> = {
  home_care: "🏠",
  self_care: "🌱",
  organization: "📋",
  family_contribution: "🤝",
  life_skills: "🛠️",
};

// Pillar assignment is always optional. Unknown or empty values normalize to
// "" so existing chores (and any malformed data) keep working untouched.
export function normalizeResponsibilityPillar(value: unknown): ResponsibilityPillar | "" {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return (RESPONSIBILITY_PILLARS as readonly string[]).includes(trimmed)
    ? (trimmed as ResponsibilityPillar)
    : "";
}

// Localized pillar names live under the `responsibility.pillars.*` locale keys,
// which are present in every locale file both apps load.
export function responsibilityPillarLabel(
  pillar: ResponsibilityPillar,
  t: (key: string) => string,
) {
  return `${RESPONSIBILITY_PILLAR_EMOJI[pillar]} ${t(`responsibility.pillars.${pillar}`)}`;
}

// Options for the chore editor's pillar picker, with the "no pillar" choice
// first. Shared so web's <TailwindSelect> and mobile's chip row stay in sync.
export function responsibilityPillarSelectOptions(t: (key: string) => string) {
  return [
    { value: "" as const, label: t("responsibility.noPillar") },
    ...RESPONSIBILITY_PILLARS.map((pillar) => ({
      value: pillar,
      label: responsibilityPillarLabel(pillar, t),
    })),
  ];
}
