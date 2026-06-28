import { describe, expect, it } from "vitest";
import { renderEmailTemplate } from "@/lib/email/templates";

const props = {
  appName: "Family Chores",
  senderIdentity: "Family Chores",
  familyName: "Rivera",
  weekStartLabel: "Jun 2, 2026",
  weekEndLabel: "Jun 8, 2026",
  dashboardUrl: "https://example.com",
  managePreferencesUrl: "https://example.com/profile",
  changeLogUrl: "https://example.com/change-log",
  choresCompleted: 12,
  coinsEarned: 34,
  rewardsRedeemed: 2,
  familyAwardsClaimed: 1,
  questsCompleted: 3,
  achievementsUnlocked: 4,
  pendingApprovals: 5,
  mostActiveHelperName: "Ava",
  mostActiveHelperCount: 6,
  recentHighlights: [
    { title: "Chore approved", message: "Ava finished dishes.", createdAt: "2026-06-03T10:00:00.000Z" },
  ],
  proTip: "Keep praise specific.",
};

describe("renderEmailTemplate", () => {
  it("renders html and plain text", () => {
    const rendered = renderEmailTemplate({
      templateId: "weekly-family-highlights",
      locale: "en-US",
      props,
    });

    expect(rendered.subject).toContain("Family Chores");
    expect(rendered.html).toContain("Weekly Family Highlights");
    expect(rendered.text).toContain("Chores completed: 12");
  });

  it("localizes copy", () => {
    const rendered = renderEmailTemplate({
      templateId: "weekly-family-highlights",
      locale: "es-US",
      props,
    });

    expect(rendered.html).toContain("Resumen semanal familiar");
    expect(rendered.text).toContain("Consejo de la semana");
  });

  it("features recent product updates and links to the changelog", () => {
    const rendered = renderEmailTemplate({
      templateId: "weekly-family-highlights",
      locale: "en-US",
      props,
    });

    expect(rendered.html).toContain("See what’s new for your family");
    expect(rendered.html).toContain("Responsibility titles and progress celebrations");
    expect(rendered.html).toContain("https://example.com/change-log");
    expect(rendered.text).toContain("Explore all updates");
    expect(rendered.text).not.toContain("Athena");
  });

  it("supports fallback-safe empty data without crashing", () => {
    const rendered = renderEmailTemplate({
      templateId: "weekly-family-highlights",
      locale: "fr-FR",
      familyLocale: "en-US",
      props: {
        ...props,
        familyName: "",
        mostActiveHelperName: "",
        mostActiveHelperCount: 0,
        recentHighlights: [],
      },
    });

    expect(rendered.subject.length).toBeGreaterThan(0);
    expect(rendered.html).toContain("Ouvrir le tableau de bord");
    expect(rendered.text).toContain("Aucun moment recent");
  });
});
