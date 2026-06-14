import type { MetadataRoute } from "next";
import { getChangeLogEntryGroups } from "@/lib/change-log";
import choreIdeas from "@/data/chore-ideas.json";
import { SITE_URL as BASE_URL } from "@/lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const changeLogEntries = getChangeLogEntryGroups().map((group) => ({
    url: `${BASE_URL}/change-log/${group.slug}`,
    lastModified: new Date(`${group.endDate}T00:00:00Z`),
    changeFrequency: "never" as const,
    priority: 0.5,
  }));

  const choreIdeaEntries = choreIdeas.ageRanges.map((range) => ({
    url: `${BASE_URL}/chores/ideas/${range.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  return [
    {
      url: `${BASE_URL}/`,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/chores`,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/routines`,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/pillars-of-responsibility`,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    ...choreIdeaEntries,
    {
      url: `${BASE_URL}/privacy-policy`,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${BASE_URL}/terms-of-service`,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${BASE_URL}/change-log`,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    ...changeLogEntries,
  ];
}
