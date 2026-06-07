"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/locale-provider";
import { DiscoveryBadge } from "@/components/discovery-badge";
import {
  markDiscoverySeen,
  useDiscoverySummary,
  type DiscoverySectionSummary,
} from "@/lib/hooks/use-discovery";

// Maps a discovery section to where "View" should navigate. Children store
// categories deep-link into the store with the category query the store page
// already understands.
function sectionHref(sectionKey: string): string {
  if (sectionKey === "chores") {
    return "/?tab=chores";
  }
  if (sectionKey === "store") {
    return "/store";
  }
  if (sectionKey.startsWith("store:")) {
    return `/store?category=${sectionKey.slice("store:".length)}`;
  }
  if (sectionKey === "quests") {
    return "/quests";
  }
  if (sectionKey === "achievements") {
    return "/achievements";
  }
  if (sectionKey === "changelog") {
    return "/change-log";
  }
  if (sectionKey === "community_awards") {
    return "/community-awards";
  }
  return "/";
}

function sectionLabelKey(sectionKey: string): string {
  const map: Record<string, string> = {
    chores: "discovery.sections.chores",
    store: "discovery.sections.store",
    "store:customize_colors": "discovery.sections.storeCustomizeColors",
    "store:customize_avatar": "discovery.sections.storeCustomizeAvatar",
    "store:victory_confetti": "discovery.sections.storeVictoryConfetti",
    "store:family_awards": "discovery.sections.storeFamilyAwards",
    "store:quest_items": "discovery.sections.storeQuestItems",
    quests: "discovery.sections.quests",
    achievements: "discovery.sections.achievements",
    changelog: "discovery.sections.changelog",
    community_awards: "discovery.sections.communityAwards",
  };
  return map[sectionKey] ?? "discovery.sections.chores";
}

// Compact "What's new" guidance card. Lists top-level sections that have unseen
// items with a count and a link. A row only marks its section seen AFTER the
// user clicks through (actual view), never just because the card rendered.
export function DiscoveryWhatsNewCard() {
  const { t } = useLocale();
  const router = useRouter();
  const { summary } = useDiscoverySummary();

  const rows = useMemo(() => {
    return Object.values(summary.sections)
      .filter((section): section is DiscoverySectionSummary => section.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [summary]);

  if (rows.length === 0) {
    return null;
  }

  function handleNavigate(section: DiscoverySectionSummary) {
    // Mark seen on actual navigation/view, then route.
    void markDiscoverySeen([section.sectionKey]);
    router.push(sectionHref(section.sectionKey));
  }

  return (
    <section className="discovery-whats-new" aria-label={t("discovery.whatsNewTitle")}>
      <div className="discovery-whats-new-header">
        <h3 className="discovery-whats-new-title">{t("discovery.whatsNewTitle")}</h3>
        <p className="discovery-whats-new-subtitle small">{t("discovery.whatsNewDescription")}</p>
      </div>
      <ul className="discovery-whats-new-list">
        {rows.map((section) => (
          <li key={section.sectionKey} className="discovery-whats-new-row">
            <button
              type="button"
              className="discovery-whats-new-link"
              onClick={() => handleNavigate(section)}>
              <span className="discovery-whats-new-label">{t(sectionLabelKey(section.sectionKey))}</span>
              <span className="discovery-whats-new-meta">
                <DiscoveryBadge count={section.count} />
                <span className="discovery-whats-new-cta">{t("discovery.actions.view")}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
