import { describe, expect, it } from "vitest";
import enUS from "./en-US.json";
import esUS from "./es-US.json";
import frFR from "./fr-FR.json";

describe("change log locale keys", () => {
  it("defines the page shell keys in every supported locale", () => {
    for (const locale of [enUS, frFR, esUS]) {
      expect(locale.changeLog.title).toBeTruthy();
      expect(locale.changeLog.subtitle).toBeTruthy();
      expect(locale.changeLog.daySubtitle).toBeTruthy();
      expect(locale.changeLog.daySubtitleMissing).toBeTruthy();
      expect(locale.changeLog.empty).toBeTruthy();
      expect(locale.changeLog.imageAlt).toBeTruthy();
      expect(locale.changeLog.sections.features).toBeTruthy();
      expect(locale.changeLog.sections.bugFixes).toBeTruthy();
      expect(locale.changeLog.sections.emptyFeatures).toBeTruthy();
      expect(locale.changeLog.sections.emptyBugFixes).toBeTruthy();
      expect(locale.changeLog.types.feature).toBeTruthy();
      expect(locale.changeLog.types.bugFix).toBeTruthy();
      expect(locale.changeLog.tabs.recent).toBeTruthy();
      expect(locale.changeLog.tabs.requested).toBeTruthy();
      expect(locale.changeLog.requested.empty).toBeTruthy();
      expect(locale.changeLog.requested.upvote).toBeTruthy();
      expect(locale.changeLog.requested.status.under_review).toBeTruthy();
      expect(locale.nav.changeLog).toBeTruthy();
      expect(locale.footer.changeLog).toBeTruthy();
      expect(locale.breadcrumbs.changeLog).toBeTruthy();
      expect(locale.breadcrumbs.changeLogSubtitle).toBeTruthy();
    }
  });
});
